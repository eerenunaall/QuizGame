import type { Database } from '@quizparty/db';
import {
  HashNgramEmbedder,
  arbitrate,
  auditBatch,
  buildEntry,
  csvToImportRows,
  foldKey,
  heuristicPass,
  lexicalFingerprint,
  parseCsv,
  parseImportRow,
  parseJsonl,
  summarizeFindings,
  type BatchFinding,
  type BatchItem,
  type BatchRules,
  type BatchSummary,
  type EmbeddingProvider,
  type Finding,
  type HeuristicConfig,
  type ImportIssue,
  type NormalizedQuestion,
  type QuestionStatus,
} from '@quizparty/question-schema';
import { loadCategories } from './categories';
import { setLogContext } from './context';
import { isEditor, type Actor } from './lifecycle';
import {
  appendAudit,
  contentHash,
  correctText,
  fingerprintsFor,
  insertQuestion,
  loadIndex,
  loadManyByExternalId,
  metadataHash,
} from './repository';
import { editQuestion, nextStatus } from './review';

/** One row of an import file, before validation. */
export interface ImportRowInput {
  /** Line number in the file (1-based; CSV: the record's line, header is line 1). */
  line: number;
  raw?: unknown;
  /** The row could not even be turned into an object. */
  preError?: string;
}

export type ImportFormat = 'jsonl' | 'csv';

export function parseImportText(text: string, format: ImportFormat): ImportRowInput[] {
  if (format === 'jsonl')
    return parseJsonl(text).map((line) =>
      line.error ? { line: line.line, preError: line.error } : { line: line.line, raw: line.value },
    );
  return csvToImportRows(parseCsv(text)).map((row) =>
    row.error ? { line: row.line, preError: row.error } : { line: row.line, raw: row.row },
  );
}

export type ImportOutcome =
  | 'CREATED'
  | 'UPDATED'
  | 'UNCHANGED'
  | 'CHANGED'
  | 'DUPLICATE'
  | 'CONFLICT'
  | 'INVALID'
  | 'UNKNOWN_CATEGORY'
  | 'FORBIDDEN_AUTHOR';

export interface ImportItem {
  line: number;
  /** External id when the row has one, else `line:<n>`. */
  key: string;
  outcome: ImportOutcome;
  questionId?: string;
  status?: QuestionStatus;
  issues?: ImportIssue[];
  /** Non-INFO finding codes of a created question. */
  reasons?: string[];
  /** The stored question an exact or near duplicate points at. */
  otherId?: string;
  changed?: 'content' | 'metadata';
}

export interface ImportOptions {
  now: Date;
  dryRun?: boolean;
  /** Apply differences to questions that already exist under the same external id. */
  updateExisting?: boolean;
  /** Accept rows with authorType DEV_SEED (development and test content, never production). */
  allowDevSeed?: boolean;
  /** With `allowDevSeed`: let clean DEV_SEED rows be ACTIVE straight away. */
  devActivate?: boolean;
  /** Rows per transaction (default 200). */
  batchSize?: number;
  actor?: Actor;
  embeddings?: EmbeddingProvider;
  config?: Partial<HeuristicConfig>;
  rules?: Partial<BatchRules>;
  /** Free text kept in the audit detail (file name, batch id). */
  source?: string;
}

export interface ImportReport {
  dryRun: boolean;
  total: number;
  counts: Record<ImportOutcome, number>;
  /** Statuses the created questions got. */
  created: Partial<Record<QuestionStatus, number>>;
  /** Heuristic verdicts over the new questions: PASS means "no automatic objection". */
  summary: BatchSummary;
  batchFindings: BatchFinding[];
  items: ImportItem[];
  durationMs: number;
}

export class ImportBatchError extends Error {
  readonly batchStart: number;
  readonly committedBatches: number;
  constructor(message: string, batchStart: number, committedBatches: number, cause?: unknown) {
    super(message, { cause });
    this.name = 'ImportBatchError';
    this.batchStart = batchStart;
    this.committedBatches = committedBatches;
  }
}

const emptyCounts = (): Record<ImportOutcome, number> => ({
  CREATED: 0,
  UPDATED: 0,
  UNCHANGED: 0,
  CHANGED: 0,
  DUPLICATE: 0,
  CONFLICT: 0,
  INVALID: 0,
  UNKNOWN_CATEGORY: 0,
  FORBIDDEN_AUTHOR: 0,
});

interface Candidate {
  itemIndex: number;
  question: NormalizedQuestion;
  vector: Float32Array | null;
}

const CLI_ACTOR: Actor = { accountId: null, roles: ['ADMIN'] };

/**
 * Imports validated questions (ADR-0014): validation → Turkish-aware normalisation → fingerprints →
 * duplicate search against the bank and the file itself → heuristic audit → insert as DRAFT, REVIEW
 * or REJECTED, never ACTIVE (dev-seed rows excepted, and only on request). Re-importing the same
 * file changes nothing. Writes happen in batches, one transaction each.
 */
export async function importQuestions(
  db: Database,
  inputs: readonly ImportRowInput[],
  options: ImportOptions,
): Promise<ImportReport> {
  const started = Date.now();
  const categories = await loadCategories(db);
  const embedder = options.embeddings ?? new HashNgramEmbedder();
  const index = await loadIndex(db, embedder.id);
  const items: ImportItem[] = [];
  const parsed = inputs.map((input) =>
    input.preError
      ? { ok: false as const, issues: [{ path: '', code: input.preError }] }
      : parseImportRow(input.raw),
  );
  const externalIds = parsed.flatMap((row) =>
    row.ok && row.question.externalId ? [row.question.externalId] : [],
  );
  const existing = await loadManyByExternalId(db, externalIds);

  const candidates: Candidate[] = [];
  const updates: {
    itemIndex: number;
    id: string;
    question: NormalizedQuestion;
    revision: number;
  }[] = [];
  const seenExternal = new Set<string>();
  const seenLexical = new Map<string, number>();

  for (const [position, input] of inputs.entries()) {
    const row = parsed[position]!;
    const key = row.ok && row.question.externalId ? row.question.externalId : `line:${input.line}`;
    const item: ImportItem = { line: input.line, key, outcome: 'INVALID' };
    items.push(item);
    if (!row.ok) {
      item.issues = row.issues;
      continue;
    }
    const question = row.question;
    if (!categories.has(question.category)) {
      item.outcome = 'UNKNOWN_CATEGORY';
      item.issues = [{ path: 'category', code: 'unknown_category' }];
      continue;
    }
    if (question.authorType === 'DEV_SEED' && !options.allowDevSeed) {
      item.outcome = 'FORBIDDEN_AUTHOR';
      item.issues = [{ path: 'authorType', code: 'dev_seed_not_allowed' }];
      continue;
    }
    if (question.externalId) {
      if (seenExternal.has(question.externalId)) {
        item.issues = [{ path: 'externalId', code: 'duplicate_external_id' }];
        continue;
      }
      seenExternal.add(question.externalId);
      const stored = existing.get(question.externalId);
      if (stored) {
        item.questionId = stored.id;
        item.status = stored.status;
        const contentSame = contentHash(question) === contentHash(stored.question);
        const metadataSame = metadataHash(question) === metadataHash(stored.question);
        if (contentSame && metadataSame) {
          item.outcome = 'UNCHANGED';
        } else {
          item.changed = contentSame ? 'metadata' : 'content';
          if (options.updateExisting)
            updates.push({
              itemIndex: position,
              id: stored.id,
              question,
              revision: stored.revision,
            });
          else item.outcome = 'CHANGED';
        }
        continue;
      }
    }
    const lexical = lexicalFingerprint(question.language, question.text);
    const fileTwin = seenLexical.get(`${question.language}:${lexical}`);
    const stored = index.findLexical(question.language, lexical);
    if (stored || fileTwin !== undefined) {
      const mine = foldKey(correctText(question), question.language);
      const twin =
        fileTwin === undefined ? undefined : candidates.find((c) => c.itemIndex === fileTwin);
      const theirs = stored
        ? stored.correctKey
        : twin
          ? foldKey(correctText(twin.question), twin.question.language)
          : mine;
      item.outcome = theirs === mine ? 'DUPLICATE' : 'CONFLICT';
      const otherId = stored?.id ?? (fileTwin === undefined ? undefined : items[fileTwin]?.key);
      if (otherId) item.otherId = otherId;
      continue;
    }
    seenLexical.set(`${question.language}:${lexical}`, position);
    candidates.push({ itemIndex: position, question, vector: null });
  }

  // Vectors for the duplicate proxy, in chunks (a provider may be a remote service).
  for (const language of ['tr', 'en'] as const) {
    const group = candidates.filter((candidate) => candidate.question.language === language);
    for (let start = 0; start < group.length; start += 64) {
      const chunk = group.slice(start, start + 64);
      const vectors = await embedder.embed(
        chunk.map((candidate) => `${candidate.question.text} ${correctText(candidate.question)}`),
        language,
      );
      chunk.forEach((candidate, i) => {
        candidate.vector = vectors[i] ?? null;
      });
    }
  }

  const batchItems: BatchItem[] = candidates.map((candidate) => ({
    key: String(candidate.itemIndex),
    subject: {
      language: candidate.question.language,
      category: candidate.question.category,
      difficulty: candidate.question.difficulty,
      text: candidate.question.text,
      explanation: candidate.question.explanation,
      options: candidate.question.options,
      pool: candidate.question.pool,
      expiresAt: candidate.question.expiresAt,
      lastVerifiedAt: candidate.question.lastVerifiedAt,
      sourceCount: candidate.question.sources.length,
      authorType: candidate.question.authorType,
    },
    entry: buildEntry({
      id: String(candidate.itemIndex),
      language: candidate.question.language,
      stem: candidate.question.text,
      correctAnswer: correctText(candidate.question),
      vector: candidate.vector,
    }),
  }));
  const audited = auditBatch(batchItems, {
    now: options.now,
    sourceRequired: (category) => categories.get(category)?.sourceRequired ?? true,
    ...(options.config ? { config: options.config } : {}),
    ...(options.rules ? { rules: options.rules } : {}),
    index,
  });

  // Decide the initial status of every new question.
  interface Planned {
    candidate: Candidate;
    findings: Finding[];
    status: QuestionStatus;
  }
  const planned: Planned[] = candidates.map((candidate, i) => {
    const findings = audited.items[i]!.findings;
    const pass = heuristicPass(findings, { duplicatesChecked: true });
    const decision = arbitrate([pass]);
    const dev = candidate.question.authorType === 'DEV_SEED';
    let status: QuestionStatus = nextStatus('DRAFT', decision) ?? 'DRAFT';
    if (dev && options.allowDevSeed && options.devActivate && pass.status !== 'REJECT')
      status = 'ACTIVE';
    return { candidate, findings, status };
  });

  const actor = options.actor ?? CLI_ACTOR;
  const editor: Actor = isEditor(actor) ? actor : { ...actor, roles: [...actor.roles, 'EDITOR'] };
  let committed = 0;
  if (!options.dryRun) {
    const batchSize = Math.max(1, options.batchSize ?? 200);
    for (let start = 0; start < planned.length; start += batchSize) {
      const batch = planned.slice(start, start + batchSize);
      try {
        await db.transaction().execute(async (trx) => {
          for (const plan of batch) {
            const { question } = plan.candidate;
            await setLogContext(trx, {
              actor: actor.accountId,
              reason: 'IMPORT',
              detail: options.source ? { source: options.source } : {},
            });
            const fingerprints = fingerprintsFor(question, plan.candidate.vector, embedder.id);
            const inserted = await insertQuestion(trx, {
              question,
              fingerprints,
              status: plan.status,
              isDevSeed: question.authorType === 'DEV_SEED',
            });
            const pass = heuristicPass(plan.findings, { duplicatesChecked: true });
            await appendAudit(trx, inserted.id, inserted.revision, pass, actor.accountId);
            const decision = arbitrate([pass]);
            await appendAudit(
              trx,
              inserted.id,
              inserted.revision,
              {
                pass: 'ARBITER',
                provider: 'arbiter@1',
                status: decision.status,
                dimensions: decision.dimensions,
                scores: {},
                reasonCodes: decision.reasonCodes,
                hardRejectReasons: decision.hardRejectReasons,
                reviewReasons: decision.reviewReasons,
                suggestedRewrite: null,
                detail: { humanApproved: false },
              },
              actor.accountId,
            );
            const item = items[plan.candidate.itemIndex]!;
            item.questionId = inserted.id;
          }
        });
        committed++;
      } catch (error) {
        throw new ImportBatchError(
          `import batch starting at row ${start} failed`,
          start,
          committed,
          error,
        );
      }
    }
    for (const update of updates) {
      const item = items[update.itemIndex]!;
      const result = await editQuestion(
        db,
        update.id,
        {
          text: update.question.text,
          explanation: update.question.explanation,
          difficulty: update.question.difficulty,
          category: update.question.category,
          language: update.question.language,
          pool: update.question.pool,
          options: update.question.options,
          subcategory: update.question.subcategory,
          topic: update.question.topic,
          expiresAt: update.question.expiresAt,
          lastVerifiedAt: update.question.lastVerifiedAt,
          sources: update.question.sources,
        },
        { actor: editor, expectedRevision: update.revision },
        {
          now: options.now,
          ...(options.config ? { config: options.config } : {}),
          embeddings: embedder,
        },
      );
      item.status = result.status;
    }
  }

  const counts = emptyCounts();
  const created: Partial<Record<QuestionStatus, number>> = {};
  for (const plan of planned) {
    const item = items[plan.candidate.itemIndex]!;
    item.outcome = 'CREATED';
    item.status = plan.status;
    const reasons = plan.findings
      .filter((finding) => finding.severity !== 'INFO')
      .map((finding) => finding.code);
    if (reasons.length > 0) item.reasons = [...new Set(reasons)];
    created[plan.status] = (created[plan.status] ?? 0) + 1;
  }
  for (const update of updates) items[update.itemIndex]!.outcome = 'UPDATED';
  for (const item of items) counts[item.outcome]++;

  const summary = summarizeFindings(
    planned.map((plan) => ({
      key: items[plan.candidate.itemIndex]!.key,
      findings: plan.findings,
      category: plan.candidate.question.category,
    })),
  );
  return {
    dryRun: options.dryRun ?? false,
    total: inputs.length,
    counts,
    created,
    summary,
    batchFindings: audited.batchFindings,
    items,
    durationMs: Date.now() - started,
  };
}
