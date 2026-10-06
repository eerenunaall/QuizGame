import type { Database } from '@quizparty/db';
import {
  PassResultSchema,
  summarize,
  type ArbiterDecision,
  type AuditPassName,
  type AuditPassResult,
  type BatchSummary,
  type HeuristicConfig,
  type EmbeddingProvider,
  type QuestionStatus,
} from '@quizparty/question-schema';
import { SYSTEM_ACTOR, type Actor } from './lifecycle';
import { appendAudit, listAudits, loadQuestion, type StoredQuestion } from './repository';
import { auditQuestionTx, type ReviewContext } from './review';

/** What a model or other external auditor is shown about one question. */
export interface AuditProviderInput {
  question: {
    id: string;
    language: string;
    category: string;
    difficulty: string;
    pool: string;
    text: string;
    options: { text: string; correct: boolean }[];
    explanation: string | null;
    sources: { url: string; title: string | null }[];
    expiresAt: string | null;
    lastVerifiedAt: string | null;
  };
  /** Today's date (ISO), so freshness is judged against the right day. */
  today: string;
}

export interface ProviderResult {
  result: AuditPassResult;
  usage?: { inputTokens: number; outputTokens: number };
}

/** A pluggable audit pass (ADR-0014). Without a configured provider the pass stays NOT_RUN. */
export interface AuditProvider {
  /** Stored as the pass's provider; one stored pass per (id, revision) is enough. */
  readonly id: string;
  readonly pass: AuditPassName;
  audit(input: AuditProviderInput): Promise<ProviderResult>;
}

export function toProviderInput(stored: StoredQuestion, now: Date): AuditProviderInput {
  const { question } = stored;
  return {
    question: {
      id: stored.id,
      language: question.language,
      category: question.category,
      difficulty: question.difficulty,
      pool: question.pool,
      text: question.text,
      options: question.options,
      explanation: question.explanation,
      sources: question.sources.map((source) => ({ url: source.url, title: source.title })),
      expiresAt: question.expiresAt?.toISOString() ?? null,
      lastVerifiedAt: question.lastVerifiedAt?.toISOString() ?? null,
    },
    today: now.toISOString().slice(0, 10),
  };
}

export interface AuditRunOptions {
  now: Date;
  providers?: readonly AuditProvider[];
  /** Compute and report verdicts without writing anything or calling a provider. */
  dryRun?: boolean;
  actor?: Actor;
  /** Operator policy: approve-and-activate on an arbiter PASS (sampling by humans is the control). */
  autoActivate?: boolean;
  /** Stop calling providers once this many tokens (input + output) have been spent. */
  tokenBudget?: number;
  concurrency?: number;
  config?: Partial<HeuristicConfig>;
  embeddings?: EmbeddingProvider;
  onProgress?: (done: number, total: number) => void;
}

export interface AuditRunItem {
  id: string;
  from: QuestionStatus;
  to: QuestionStatus;
  verdict: ArbiterDecision['status'];
  blockers: string[];
  newPasses: string[];
}

export interface AuditRunReport {
  total: number;
  processed: number;
  dryRun: boolean;
  /** "500 → 420 PASS / 58 REVIEW / 22 REJECT": the arbiter's verdicts. */
  summary: BatchSummary;
  statusChanges: Record<string, number>;
  tokens: { input: number; output: number };
  budgetExhausted: boolean;
  errors: { id: string; message: string }[];
  items: AuditRunItem[];
}

class Rollback extends Error {
  readonly payload: unknown;
  constructor(payload: unknown) {
    super('rollback');
    this.payload = payload;
  }
}

/** Runs the transaction body and discards its writes, returning the body's result (dry runs). */
async function dryTransaction<T>(db: Database, body: (trx: Database) => Promise<T>): Promise<T> {
  try {
    await db.transaction().execute(async (trx) => {
      throw new Rollback(await body(trx));
    });
  } catch (error) {
    if (error instanceof Rollback) return error.payload as T;
    throw error;
  }
  throw new Error('unreachable');
}

/**
 * Audits the given questions: provider passes first (network, outside any transaction, resumable
 * because a stored pass for the current revision is never repeated), then one transaction per
 * question that arbitrates and applies the verdict. A failing provider or question is reported and
 * the run goes on.
 */
export async function runAudit(
  db: Database,
  ids: readonly string[],
  options: AuditRunOptions,
): Promise<AuditRunReport> {
  const actor = options.actor ?? SYSTEM_ACTOR;
  const providers = options.dryRun ? [] : (options.providers ?? []);
  const context: ReviewContext = {
    now: options.now,
    ...(options.config ? { config: options.config } : {}),
    ...(options.embeddings ? { embeddings: options.embeddings } : {}),
  };
  const report: AuditRunReport = {
    total: ids.length,
    processed: 0,
    dryRun: options.dryRun ?? false,
    summary: summarize([]),
    statusChanges: {},
    tokens: { input: 0, output: 0 },
    budgetExhausted: false,
    errors: [],
    items: [],
  };
  const outcomes: { key: string; status: ArbiterDecision['status']; reasons: string[] }[] = [];
  const queue = [...ids];
  const workers = Math.max(1, Math.min(options.concurrency ?? 4, queue.length || 1));

  const handle = async (id: string): Promise<void> => {
    try {
      let stored = await loadQuestion(db, id);
      if (!stored) throw new Error('not found');
      const newPasses: string[] = [];
      if (providers.length > 0) {
        const existing = await listAudits(db, id, stored.revision);
        for (const provider of providers) {
          if (
            existing.some(
              (pass) => pass.result.pass === provider.pass && pass.result.provider === provider.id,
            )
          )
            continue;
          if (
            options.tokenBudget !== undefined &&
            report.tokens.input + report.tokens.output >= options.tokenBudget
          ) {
            report.budgetExhausted = true;
            break;
          }
          const { result, usage } = await provider.audit(toProviderInput(stored, options.now));
          const checked = PassResultSchema.parse({
            ...result,
            pass: provider.pass,
            provider: provider.id,
          });
          report.tokens.input += usage?.inputTokens ?? 0;
          report.tokens.output += usage?.outputTokens ?? 0;
          // Only keep the pass if the question was not edited while the model was thinking; if it
          // was, the remaining passes would judge wording that no longer exists, so stop here and
          // let the next run start from the new revision.
          const revision = stored.revision;
          const kept = await db.transaction().execute(async (trx) => {
            const current = await loadQuestion(trx, id);
            if (!current || current.revision !== revision) return false;
            await appendAudit(trx, id, revision, checked, actor.accountId);
            return true;
          });
          if (!kept) break;
          newPasses.push(`${provider.pass}:${provider.id}`);
          // A rejection is final whatever the other passes say: do not pay for them.
          if (checked.status === 'REJECT') break;
        }
        stored = (await loadQuestion(db, id)) ?? stored;
      }
      const apply = (trx: Database) =>
        auditQuestionTx(trx, stored, context, {
          actor,
          ...(options.autoActivate ? { autoActivate: true } : {}),
        });
      const outcome = options.dryRun
        ? await dryTransaction(db, apply)
        : await db.transaction().execute(apply);
      const key = `${outcome.from}→${outcome.to}`;
      if (outcome.from !== outcome.to)
        report.statusChanges[key] = (report.statusChanges[key] ?? 0) + 1;
      report.items.push({
        id,
        from: outcome.from,
        to: outcome.to,
        verdict: outcome.decision.status,
        blockers: outcome.decision.blockers,
        newPasses,
      });
      outcomes.push({
        key: id,
        status: outcome.decision.status,
        reasons: [...outcome.decision.blockers, ...outcome.decision.hardRejectReasons],
      });
    } catch (error) {
      report.errors.push({ id, message: error instanceof Error ? error.message : String(error) });
    } finally {
      report.processed++;
      options.onProgress?.(report.processed, report.total);
    }
  };

  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) await handle(id);
    }),
  );
  report.summary = summarize(outcomes);
  return report;
}

export interface AuditSelection {
  ids?: readonly string[];
  statuses?: readonly QuestionStatus[];
  category?: string;
  language?: string;
  /**
   * Only questions that no model or person has judged yet for their current revision. The
   * automatic review done at import does not count: it is the heuristics, not an audit pass.
   */
  unaudited?: boolean;
  limit?: number;
}

export async function selectQuestionIds(
  db: Database,
  selection: AuditSelection,
): Promise<string[]> {
  if (selection.ids) return [...selection.ids];
  let query = db.selectFrom('questions').select('questions.id as id');
  if (selection.statuses && selection.statuses.length > 0)
    query = query.where('questions.status', 'in', [...selection.statuses]);
  if (selection.category) query = query.where('questions.category_id', '=', selection.category);
  if (selection.language) query = query.where('questions.language', '=', selection.language);
  if (selection.unaudited)
    query = query.where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('question_audits')
            .select('question_audits.id')
            .whereRef('question_audits.question_id', '=', 'questions.id')
            .whereRef('question_audits.question_revision', '=', 'questions.revision')
            .where('question_audits.pass', 'not in', ['HEURISTIC', 'ARBITER']),
        ),
      ),
    );
  const rows = await query
    .orderBy('questions.created_at')
    .orderBy('questions.id')
    .limit(selection.limit ?? 100_000)
    .execute();
  return rows.map((row) => row.id);
}
