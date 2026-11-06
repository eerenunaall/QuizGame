import { sql } from 'kysely';
import type { Database } from '@quizparty/db';
import {
  DEFAULT_HEURISTIC_CONFIG,
  HashNgramEmbedder,
  MemorySimilarityIndex,
  arbitrate,
  buildEntry,
  decodeVector,
  duplicateFindings,
  hashNgramVector,
  heuristicPass,
  isWaivable,
  parseImportRow,
  runHeuristics,
  toImportRow,
  HASH_NGRAM_PROVIDER,
  type ArbiterDecision,
  type AuditPassResult,
  type Difficulty,
  type EmbeddingProvider,
  type Finding,
  type HeuristicConfig,
  type NormalizedQuestion,
  type Pool,
  type QuestionLanguage,
  type QuestionStatus,
} from '@quizparty/question-schema';
import { LifecycleError, isEditor, transitionTx, type Actor } from './lifecycle';
import {
  appendAudit,
  contentHash,
  correctText,
  fingerprintsFor,
  latestOfPass,
  listAudits,
  loadQuestion,
  replaceContent,
  toSubject,
  type StoredQuestion,
} from './repository';

export interface ReviewContext {
  now: Date;
  config?: Partial<HeuristicConfig>;
  /** Vector source for the duplicate proxy; the feature-hash proxy when absent. */
  embeddings?: EmbeddingProvider;
}

const providerId = (context: ReviewContext): string =>
  context.embeddings?.id ?? HASH_NGRAM_PROVIDER;

/**
 * The stored questions that could be duplicates of this one: same fingerprint, similar wording
 * (pg_trgm), or the same correct answer in the same category. A small index built from them
 * answers "is this a copy?" without loading the whole bank.
 */
export async function loadNeighbours(
  db: Database,
  stored: StoredQuestion,
  context: ReviewContext,
): Promise<MemorySimilarityIndex> {
  const { question } = stored;
  const correct = correctText(question);
  const rows = await db
    .selectFrom('questions')
    .leftJoin('question_options', (join) =>
      join
        .onRef('question_options.question_id', '=', 'questions.id')
        .on('question_options.is_correct', '=', true),
    )
    .select([
      'questions.id as id',
      'questions.language as language',
      'questions.text as text',
      'questions.lexical_fingerprint as lexical',
      'questions.minhash as minhash',
      'questions.semantic_fingerprint as semantic',
      'questions.semantic_provider as semantic_provider',
      'question_options.text as correct_text',
    ])
    .where('questions.id', '!=', stored.id)
    .where('questions.language', '=', question.language)
    .where((eb) =>
      eb.or([
        eb('questions.lexical_fingerprint', '=', stored.lexical),
        sql<boolean>`questions.text % ${question.text}`,
        eb.and([
          eb('questions.category_id', '=', question.category),
          sql<boolean>`lower(question_options.text) = ${correct.toLowerCase()}`,
        ]),
      ]),
    )
    .orderBy(sql`similarity(questions.text, ${question.text})`, 'desc')
    .limit(100)
    .execute();
  const index = new MemorySimilarityIndex();
  const provider = providerId(context);
  for (const row of rows) {
    index.add(
      buildEntry({
        id: row.id,
        language: row.language as QuestionLanguage,
        stem: row.text,
        correctAnswer: row.correct_text ?? '',
        lexical: row.lexical,
        ...(row.minhash && row.minhash.length > 0 ? { minhash: row.minhash } : {}),
        vector:
          row.semantic && row.semantic_provider === provider ? decodeVector(row.semantic) : null,
      }),
    );
  }
  return index;
}

export interface FindingsResult {
  findings: Finding[];
  neighbours: MemorySimilarityIndex;
}

/** Heuristic findings plus duplicate findings for one stored question, right now. */
export async function computeFindings(
  db: Database,
  stored: StoredQuestion,
  context: ReviewContext,
): Promise<FindingsResult> {
  const config = { ...DEFAULT_HEURISTIC_CONFIG, ...context.config };
  const neighbours = await loadNeighbours(db, stored, context);
  const subject = toSubject(stored);
  const findings = runHeuristics(subject, {
    now: context.now,
    sourceRequired: stored.sourceRequired,
    config,
  });
  const entry = buildEntry({
    id: stored.id,
    language: stored.question.language,
    stem: stored.question.text,
    correctAnswer: correctText(stored.question),
    lexical: stored.lexical,
    vector: storedVector(stored, context),
  });
  findings.push(...duplicateFindings(entry, neighbours, config.duplicate));
  return { findings, neighbours };
}

/** The question's own vector: the stored one when it came from the active provider, else the proxy. */
function storedVector(stored: StoredQuestion, context: ReviewContext): Float32Array | null {
  const provider = providerId(context);
  if (stored.semantic && stored.semanticProvider === provider) return decodeVector(stored.semantic);
  return provider === HASH_NGRAM_PROVIDER
    ? hashNgramVector(
        `${stored.question.text} ${correctText(stored.question)}`,
        stored.question.language,
      )
    : null;
}

/**
 * A stable text for comparing two verdicts. Stored passes come back from `jsonb` with their keys
 * in the database's order and lists in whatever order they were written; every list in a verdict
 * is a set of codes, so neither order may matter.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

const sameVerdict = (a: AuditPassResult, b: AuditPassResult): boolean => {
  const key = (pass: AuditPassResult): string =>
    canonical({
      status: pass.status,
      dimensions: pass.dimensions,
      scores: pass.scores,
      reasonCodes: pass.reasonCodes,
      hardRejectReasons: pass.hardRejectReasons,
      reviewReasons: pass.reviewReasons,
      waived: pass.detail?.waived ?? [],
    });
  return key(a) === key(b);
};

export interface Arbitration {
  decision: ArbiterDecision;
  findings: Finding[];
  heuristic: AuditPassResult;
}

/**
 * Recomputes the verdict for the question's current revision: the stored model and human passes,
 * plus a fresh heuristic pass (so a question that has since expired or been duplicated is caught).
 * Changed passes are appended to the audit trail; unchanged ones are not repeated.
 */
export async function arbitrateQuestion(
  trx: Database,
  stored: StoredQuestion,
  context: ReviewContext,
  actor: string | null,
): Promise<Arbitration> {
  const passes = (await listAudits(trx, stored.id, stored.revision)).filter(
    (pass) => pass.result.pass !== 'HEURISTIC' && pass.result.pass !== 'ARBITER',
  );
  const approval = [...passes]
    .reverse()
    .find(
      (pass) =>
        pass.result.pass === 'MANUAL' &&
        pass.result.status === 'PASS' &&
        pass.result.dimensions.factCheck === 'PASS',
    );
  const waivedValue = approval?.result.detail?.waivedCodes;
  const waived = Array.isArray(waivedValue) ? waivedValue.map(String) : [];

  const { findings } = await computeFindings(trx, stored, context);
  const heuristic = heuristicPass(findings, { duplicatesChecked: true, waived });
  const decision = arbitrate([...passes.map((pass) => pass.result), heuristic]);

  const lastHeuristic = await latestOfPass(trx, stored.id, stored.revision, 'HEURISTIC');
  if (!lastHeuristic || !sameVerdict(lastHeuristic.result, heuristic))
    await appendAudit(trx, stored.id, stored.revision, heuristic, actor);

  const verdict: AuditPassResult = {
    pass: 'ARBITER',
    provider: 'arbiter@1',
    status: decision.status,
    dimensions: decision.dimensions,
    scores: decision.scores ?? {},
    reasonCodes: decision.reasonCodes,
    hardRejectReasons: decision.hardRejectReasons,
    reviewReasons: decision.reviewReasons,
    suggestedRewrite: decision.suggestedRewrite,
    detail: { humanApproved: decision.humanApproved },
  };
  const lastVerdict = await latestOfPass(trx, stored.id, stored.revision, 'ARBITER');
  if (!lastVerdict || !sameVerdict(lastVerdict.result, verdict))
    await appendAudit(trx, stored.id, stored.revision, verdict, actor);
  return { decision, findings, heuristic };
}

/** Reasons that only mean "the model and scoring passes have not run yet". */
const WAITING = new Set(['FACT_CHECK_NOT_RUN', 'SCORES_MISSING']);

/**
 * What the verdict means for the status (ADR-0014). REJECT → REJECTED; PASS → APPROVED; REVIEW with
 * only "passes pending" reasons leaves a DRAFT where it is; any other REVIEW asks a person. A
 * question already in play that stops passing is pulled out of play, never rejected silently.
 */
export function nextStatus(
  current: QuestionStatus,
  decision: { status: ArbiterDecision['status']; blockers: readonly string[] },
): QuestionStatus | null {
  if (current === 'RETIRED' || current === 'REJECTED') return null;
  const inPlay = current === 'ACTIVE' || current === 'APPROVED';
  if (decision.status === 'PASS') return inPlay ? null : 'APPROVED';
  if (inPlay) return 'REVIEW';
  if (decision.status === 'REJECT') return 'REJECTED';
  if (current === 'REVIEW') return null;
  return decision.blockers.some((blocker) => !WAITING.has(blocker)) ? 'REVIEW' : null;
}

export interface AuditOutcome {
  decision: ArbiterDecision;
  findings: Finding[];
  from: QuestionStatus;
  to: QuestionStatus;
}

/** Arbitrates and applies the verdict to the status, in one transaction. */
export async function auditQuestionTx(
  trx: Database,
  stored: StoredQuestion,
  context: ReviewContext,
  options: { actor: Actor; autoActivate?: boolean; reason?: string },
): Promise<AuditOutcome> {
  const { decision, findings } = await arbitrateQuestion(
    trx,
    stored,
    context,
    options.actor.accountId,
  );
  let to = stored.status;
  if (!stored.isDevSeed) {
    const target = nextStatus(stored.status, decision);
    if (target && target !== stored.status) {
      await transitionTx(trx, stored.id, target, {
        actor: options.actor,
        reason: options.reason ?? 'AUDIT_VERDICT',
        detail: { verdict: decision.status, reasons: decision.reasonCodes.slice(0, 12) },
      });
      to = target;
    }
    if (to === 'APPROVED' && options.autoActivate) {
      await transitionTx(trx, stored.id, 'ACTIVE', {
        actor: options.actor,
        reason: 'AUTO_ACTIVATE',
      });
      to = 'ACTIVE';
    }
  }
  return { decision, findings, from: stored.status, to };
}

// ───────────── human decisions ─────────────

export interface ApproveRequest {
  actor: Actor;
  /** REVIEW codes the editor has looked at and accepts; `'ALL'` accepts every waivable one. */
  waive: readonly string[] | 'ALL';
  note?: string;
}

/**
 * An editor's approval: it attests the fact check, acknowledges named REVIEW findings and, if the
 * arbiter agrees, moves the question to APPROVED. It never overrides REJECT findings, missing
 * sources, expiry or verification dates.
 */
export async function approveQuestion(
  db: Database,
  id: string,
  request: ApproveRequest,
  context: ReviewContext,
): Promise<AuditOutcome> {
  if (!isEditor(request.actor)) throw new LifecycleError('FORBIDDEN');
  return db.transaction().execute(async (trx) => {
    const locked = await trx
      .selectFrom('questions')
      .select('status')
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!locked) throw new LifecycleError('NOT_FOUND');
    const stored = await loadQuestion(trx, id);
    if (!stored) throw new LifecycleError('NOT_FOUND');
    if (stored.status === 'APPROVED' || stored.status === 'ACTIVE')
      throw new LifecycleError('INVALID_TRANSITION', { from: stored.status, to: 'APPROVED' });
    if (stored.status === 'RETIRED' || stored.status === 'REJECTED')
      throw new LifecycleError('INVALID_TRANSITION', { from: stored.status, to: 'APPROVED' });

    const { findings } = await computeFindings(trx, stored, context);
    const rejects = findings.filter((item) => item.severity === 'REJECT').map((item) => item.code);
    if (rejects.length > 0) throw new LifecycleError('REJECT_FINDINGS', { codes: rejects });
    const review = findings.filter((item) => item.severity === 'REVIEW');
    const fixed = review.filter((item) => !isWaivable(item.code)).map((item) => item.code);
    if (fixed.length > 0) throw new LifecycleError('BLOCKED', { codes: fixed, waivable: false });
    const waivable = review.map((item) => item.code);
    const accepted =
      request.waive === 'ALL' ? waivable : waivable.filter((code) => request.waive.includes(code));
    const open = waivable.filter((code) => !accepted.includes(code));
    if (open.length > 0) throw new LifecycleError('BLOCKED', { codes: open, waivable: true });

    await appendAudit(
      trx,
      id,
      stored.revision,
      {
        pass: 'MANUAL',
        provider: 'editor',
        status: 'PASS',
        dimensions: { factCheck: 'PASS' },
        scores: {},
        reasonCodes: [],
        hardRejectReasons: [],
        reviewReasons: [],
        suggestedRewrite: null,
        detail: {
          waivedCodes: [...new Set(accepted)],
          ...(request.note ? { note: request.note } : {}),
        },
      },
      request.actor.accountId,
    );
    const { decision } = await arbitrateQuestion(trx, stored, context, request.actor.accountId);
    if (decision.status !== 'PASS')
      throw new LifecycleError('BLOCKED', {
        codes: decision.reasonCodes,
        verdict: decision.status,
      });
    await trx
      .updateTable('questions')
      .set({ last_verified_at: context.now })
      .where('id', '=', id)
      .execute();
    await transitionTx(trx, id, 'APPROVED', {
      actor: request.actor,
      reason: 'EDITOR_APPROVED',
      detail: { waived: accepted },
      ...(request.note ? { note: request.note } : {}),
    });
    return { decision, findings, from: stored.status, to: 'APPROVED' as const };
  });
}

/** An editor's rejection, recorded as an audit pass so the history shows who and why. */
export async function rejectQuestion(
  db: Database,
  id: string,
  request: { actor: Actor; reason: string; note?: string },
): Promise<void> {
  if (!isEditor(request.actor)) throw new LifecycleError('FORBIDDEN');
  await db.transaction().execute(async (trx) => {
    const stored = await loadQuestion(trx, id);
    if (!stored) throw new LifecycleError('NOT_FOUND');
    await appendAudit(
      trx,
      id,
      stored.revision,
      {
        pass: 'MANUAL',
        provider: 'editor',
        status: 'REJECT',
        dimensions: {},
        scores: {},
        reasonCodes: [],
        hardRejectReasons: [request.reason],
        reviewReasons: [],
        suggestedRewrite: null,
        detail: request.note ? { note: request.note } : {},
      },
      request.actor.accountId,
    );
    await transitionTx(trx, id, 'REJECTED', {
      actor: request.actor,
      reason: 'EDITOR_REJECTED',
      detail: { code: request.reason },
      ...(request.note ? { note: request.note } : {}),
    });
  });
}

// ───────────── editing ─────────────

export interface EditPatch {
  text?: string;
  explanation?: string | null;
  difficulty?: Difficulty;
  category?: string;
  language?: QuestionLanguage;
  pool?: Pool;
  options?: { text: string; correct: boolean }[];
  subcategory?: string | null;
  topic?: string | null;
  expiresAt?: Date | null;
  lastVerifiedAt?: Date | null;
  sources?: { url: string; title?: string | null }[];
}

export interface EditResult {
  revision: number;
  status: QuestionStatus;
  contentChanged: boolean;
  demoted: boolean;
}

function merge(stored: StoredQuestion, patch: EditPatch): NormalizedQuestion {
  const { question } = stored;
  return {
    ...question,
    ...(patch.text !== undefined ? { text: patch.text } : {}),
    ...(patch.explanation !== undefined ? { explanation: patch.explanation } : {}),
    ...(patch.difficulty ? { difficulty: patch.difficulty } : {}),
    ...(patch.category ? { category: patch.category } : {}),
    ...(patch.language ? { language: patch.language } : {}),
    ...(patch.pool ? { pool: patch.pool } : {}),
    ...(patch.options ? { options: patch.options } : {}),
    ...(patch.subcategory !== undefined ? { subcategory: patch.subcategory } : {}),
    ...(patch.topic !== undefined ? { topic: patch.topic } : {}),
    ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
    ...(patch.lastVerifiedAt !== undefined ? { lastVerifiedAt: patch.lastVerifiedAt } : {}),
    ...(patch.sources
      ? {
          sources: patch.sources.map((source) => ({
            url: source.url,
            title: source.title ?? null,
            retrievedAt: null,
          })),
        }
      : {}),
  };
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

/**
 * Edits a question. Content changes (wording, options, difficulty, category, language, pool) bump
 * the revision, so an APPROVED or ACTIVE question is first moved to REVIEW and its old audit stops
 * counting; metadata (sources, dates, topic) can change in place. Optimistic: the caller states
 * the revision it saw.
 */
export async function editQuestion(
  db: Database,
  id: string,
  patch: EditPatch,
  request: { actor: Actor; expectedRevision: number },
  context: ReviewContext,
): Promise<EditResult> {
  if (!isEditor(request.actor)) throw new LifecycleError('FORBIDDEN');
  const before = await loadQuestion(db, id);
  if (!before) throw new LifecycleError('NOT_FOUND');
  if (before.revision !== request.expectedRevision)
    throw new LifecycleError('CONFLICT', { revision: before.revision });
  if (before.status === 'RETIRED' || before.status === 'REJECTED')
    throw new LifecycleError('INVALID_TRANSITION', { from: before.status, reopen: true });

  const merged = merge(before, patch);
  const parsed = parseImportRow(toImportRow(merged));
  if (!parsed.ok) throw new LifecycleError('INVALID_CONTENT', { issues: parsed.issues });
  const next = {
    ...parsed.question,
    externalId: before.externalId,
    authorType: before.question.authorType,
  };
  const contentChanged = contentHash(next) !== contentHash(before.question);

  let vector: Float32Array | null = null;
  if (contentChanged) {
    const embedder = context.embeddings ?? new HashNgramEmbedder();
    const vectors = await embedder.embed([`${next.text} ${correctText(next)}`], next.language);
    vector = vectors[0] ?? null;
  }
  const fingerprints = fingerprintsFor(next, vector, vector ? providerId(context) : null);

  return db.transaction().execute(async (trx) => {
    const locked = await trx
      .selectFrom('questions')
      .select(['status', 'revision'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!locked) throw new LifecycleError('NOT_FOUND');
    if (locked.revision !== request.expectedRevision)
      throw new LifecycleError('CONFLICT', { revision: locked.revision });
    let demoted = false;
    if (contentChanged && (locked.status === 'APPROVED' || locked.status === 'ACTIVE')) {
      await transitionTx(trx, id, 'REVIEW', {
        actor: request.actor,
        reason: 'EDIT',
        detail: { from: locked.status },
      });
      demoted = true;
    }
    try {
      if (contentChanged) await replaceContent(trx, id, next, fingerprints);
      else {
        await trx
          .updateTable('questions')
          .set({
            subcategory: next.subcategory,
            topic: next.topic,
            expires_at: next.expiresAt,
            last_verified_at: next.lastVerifiedAt,
          })
          .where('id', '=', id)
          .execute();
        if (patch.sources) {
          await trx.deleteFrom('question_sources').where('question_id', '=', id).execute();
          if (next.sources.length > 0)
            await trx
              .insertInto('question_sources')
              .values(
                next.sources.map((source) => ({
                  question_id: id,
                  url: source.url,
                  title: source.title,
                  retrieved_at: source.retrievedAt,
                })),
              )
              .onConflict((conflict) => conflict.doNothing())
              .execute();
        }
      }
    } catch (error) {
      if (isUniqueViolation(error)) throw new LifecycleError('DUPLICATE');
      throw error;
    }
    const after = await loadQuestion(trx, id);
    if (!after) throw new LifecycleError('NOT_FOUND');
    await arbitrateQuestion(trx, after, context, request.actor.accountId);
    return { revision: after.revision, status: after.status, contentChanged, demoted };
  });
}
