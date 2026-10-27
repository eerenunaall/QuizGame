import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '@quizparty/db';
import { sanitizeUserText } from '@quizparty/validation';
import {
  HashNgramEmbedder,
  VENUE_LIMITS,
  auditBatch,
  buildEntry,
  categorySlug,
  cleanText,
  decodeVenueFile,
  describeImportIssues,
  detectVenueFormat,
  foldKey,
  heuristicPass,
  lexicalFingerprint,
  parseImportRow,
  parseVenueText,
  prepareVenueRow,
  statusOf,
  toCsv,
  type BatchFinding,
  type BatchItem,
  type EmbeddingProvider,
  type Finding,
  type HeuristicConfig,
  type NormalizedQuestion,
  type VenueFormat,
  type VenueIssue,
} from '@quizparty/question-schema';
import { setLogContext } from './context';
import { correctText, fingerprintsFor, appendAudit, insertQuestion, loadIndex } from './repository';

/**
 * A venue's question upload (ADR-0025): the same file is analysed for the dry-run and again, from the
 * bytes, for the import. Questions with no objection become ACTIVE in the venue's own set; questions
 * with a REVIEW or REJECT finding, invalid rows and duplicates are reported and never stored.
 */
export type VenueRowStatus = 'OK' | 'REVIEW' | 'REJECT' | 'INVALID' | 'DUPLICATE' | 'FULL';

export interface VenueRowReport {
  line: number;
  status: VenueRowStatus;
  /** The start of the question, enough to recognise the row; never more. */
  preview: string;
  /** Label of the category the row would go to (null when it could not be decided). */
  category: string | null;
  issues: VenueIssue[];
}

export interface VenueCategoryCount {
  id: string;
  label: string;
  /** A category this upload creates for the venue. */
  isNew: boolean;
  count: number;
}

export interface VenueCounts {
  total: number;
  ok: number;
  review: number;
  reject: number;
  invalid: number;
  duplicate: number;
  full: number;
}

export interface VenueAnalysis {
  ok: true;
  fileName: string;
  fileHash: string;
  format: VenueFormat;
  bytes: number;
  warnings: VenueIssue[];
  /** The same bytes are a live upload already: nothing would change. */
  alreadyImported: { uploadId: string; uploadedAt: string; imported: number } | null;
  counts: VenueCounts;
  /** Rows that would be imported, per category. */
  categories: VenueCategoryCount[];
  /** Every row that would not be imported, in file order (capped; see `rowsOmitted`). */
  rows: VenueRowReport[];
  rowsOmitted: number;
  /** The first rows that would be imported, to show what the owner is about to publish. */
  sample: VenueRowReport[];
  batch: BatchFinding[];
  capacity: { used: number; max: number };
}

export interface VenueAnalysisFailure {
  ok: false;
  issue: VenueIssue;
}

export type VenueAnalysisResult = VenueAnalysis | VenueAnalysisFailure;

export interface VenueAnalysisOptions {
  now: Date;
  embeddings?: EmbeddingProvider;
  config?: Partial<HeuristicConfig>;
}

export const REPORTED_ROWS_CAP = 400;
const SAMPLE_ROWS = 12;
const PREVIEW_CHARS = 90;
const ISSUE_PARAM = (value: unknown): string | number | null =>
  typeof value === 'string' || typeof value === 'number' ? value : null;

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `v` + the first 8 hex digits of the venue id: venue categories can never collide with a global id. */
export const venueCategoryPrefix = (venueId: string): string =>
  `v${venueId.replace(/-/gu, '').slice(0, 8)}-`;

interface ReadyRow {
  line: number;
  question: NormalizedQuestion;
  findings: Finding[];
  category: { id: string; label: string; isNew: boolean };
  vector: Float32Array | null;
}

interface Plan {
  analysis: VenueAnalysis;
  ready: ReadyRow[];
  newCategories: { id: string; label: string }[];
  embedderId: string;
}

const emptyCounts = (): VenueCounts => ({
  total: 0,
  ok: 0,
  review: 0,
  reject: 0,
  invalid: 0,
  duplicate: 0,
  full: 0,
});

const previewOf = (text: unknown): string => {
  if (typeof text !== 'string') return '';
  const cleaned = cleanText(text);
  const chars = [...cleaned];
  return chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS).join('')}…` : cleaned;
};

const paramsOf = (detail: Finding['detail']): VenueIssue['params'] | undefined => {
  if (!detail) return undefined;
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(detail)) {
    const clean = ISSUE_PARAM(value);
    if (clean !== null && key !== 'otherId') params[key] = clean;
  }
  return Object.keys(params).length > 0 ? params : undefined;
};

/** What a stored finding means for the owner: duplicates are skipped, everything else needs a person. */
const DUPLICATE_CODES: Readonly<Record<string, string>> = {
  DUPLICATE_LEXICAL: 'duplicate',
  CONFLICTING_DUPLICATE: 'conflicting_duplicate',
  NEAR_DUPLICATE: 'near_duplicate',
};

async function activeCount(db: Database, venueId: string): Promise<number> {
  const row = await db
    .selectFrom('questions')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('owner_venue_id', '=', venueId)
    .where('status', '!=', 'RETIRED')
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/**
 * Reads the file, validates every row and audits what is valid, without writing anything. The result is
 * what the dry-run shows; `importVenueUpload` runs it again on the same bytes and stores the OK rows.
 */
export async function analyzeVenueUpload(
  db: Database,
  input: { venueId: string; fileName: string; bytes: Uint8Array },
  options: VenueAnalysisOptions,
): Promise<VenueAnalysisResult> {
  return (await plan(db, input, options)).result;
}

async function plan(
  db: Database,
  input: { venueId: string; fileName: string; bytes: Uint8Array },
  options: VenueAnalysisOptions,
): Promise<{ result: VenueAnalysisResult; plan: Plan | null }> {
  const fail = (issue: VenueIssue): { result: VenueAnalysisFailure; plan: null } => ({
    result: { ok: false, issue },
    plan: null,
  });
  const decoded = decodeVenueFile(input.bytes);
  if (!decoded.ok) return fail(decoded.issue);
  const fileName = cleanText(input.fileName).slice(0, 120) || 'yukleme';
  const format = detectVenueFormat(fileName, decoded.text);
  const parsed = parseVenueText(decoded.text, format);
  if (!parsed.ok) return fail(parsed.issue);

  const fileHash = hashBytes(input.bytes);
  const used = await activeCount(db, input.venueId);
  const base = {
    ok: true as const,
    fileName,
    fileHash,
    format: parsed.format,
    bytes: input.bytes.length,
    warnings: decoded.warnings,
    capacity: { used, max: VENUE_LIMITS.maxQuestionsPerVenue },
  };

  const previous = await db
    .selectFrom('venue_question_uploads')
    .select(['id', 'uploaded_at', 'rows_imported'])
    .where('venue_id', '=', input.venueId)
    .where('file_hash', '=', fileHash)
    .where('state', '=', 'ACTIVE')
    .executeTakeFirst();
  if (previous) {
    const analysis: VenueAnalysis = {
      ...base,
      alreadyImported: {
        uploadId: previous.id,
        uploadedAt: previous.uploaded_at.toISOString(),
        imported: previous.rows_imported,
      },
      counts: { ...emptyCounts(), total: parsed.rows.length },
      categories: [],
      rows: [],
      rowsOmitted: 0,
      sample: [],
      batch: [],
    };
    return { result: analysis, plan: null };
  }

  // Categories this venue may use: the enabled global ones and its own.
  const categoryRows = await db
    .selectFrom('categories')
    .select(['id', 'label_tr', 'label_en', 'enabled', 'owner_venue_id'])
    .where((eb) =>
      eb.or([eb('owner_venue_id', 'is', null), eb('owner_venue_id', '=', input.venueId)]),
    )
    .execute();
  const globalByKey = new Map<string, { id: string; label: string }>();
  const venueCategories = new Map<string, string>();
  for (const row of categoryRows) {
    if (row.owner_venue_id === null) {
      if (!row.enabled) continue;
      for (const key of [
        foldKey(row.id, 'tr'),
        foldKey(row.label_tr, 'tr'),
        foldKey(row.label_en, 'tr'),
      ])
        globalByKey.set(key, { id: row.id, label: row.label_tr });
    } else venueCategories.set(row.id, row.label_tr);
  }
  const prefix = venueCategoryPrefix(input.venueId);
  const newCategories = new Map<string, string>();

  const resolveCategory = (
    value: unknown,
  ): { id: string; label: string; isNew: boolean } | VenueIssue => {
    if (typeof value !== 'string' || value.trim() === '')
      return { field: 'category', code: 'category_missing' };
    const label = cleanText(value);
    const global = globalByKey.get(foldKey(label, 'tr'));
    if (global) return { ...global, isNew: false };
    const slug = categorySlug(label);
    const id = `${prefix}${slug}`;
    const screened = sanitizeUserText(label, { maxLength: 200, allowLinks: false });
    if (slug === '' || !screened.ok || [...label].length > VENUE_LIMITS.maxCategoryLabel)
      return {
        field: 'category',
        code: 'category_invalid',
        params: { max: VENUE_LIMITS.maxCategoryLabel },
      };
    const existing = venueCategories.get(id) ?? newCategories.get(id);
    if (existing !== undefined) return { id, label: existing, isNew: !venueCategories.has(id) };
    if (venueCategories.size + newCategories.size >= VENUE_LIMITS.maxCategoriesPerVenue)
      return {
        field: 'category',
        code: 'category_limit',
        params: { max: VENUE_LIMITS.maxCategoriesPerVenue },
      };
    return { id, label, isNew: true };
  };

  const embedder = options.embeddings ?? new HashNgramEmbedder();
  const index = await loadIndex(db, embedder.id, input.venueId);
  const reports: VenueRowReport[] = [];
  const counts = emptyCounts();
  counts.total = parsed.rows.length;
  const candidates: ReadyRow[] = [];
  const seenLexical = new Map<string, number>();

  const reject = (
    line: number,
    status: VenueRowStatus,
    preview: string,
    category: string | null,
    issues: VenueIssue[],
  ): void => {
    reports.push({ line, status, preview, category, issues });
    if (status === 'INVALID') counts.invalid++;
    else if (status === 'REJECT') counts.reject++;
    else if (status === 'REVIEW') counts.review++;
    else if (status === 'DUPLICATE') counts.duplicate++;
    else if (status === 'FULL') counts.full++;
  };

  for (const row of parsed.rows) {
    if (row.issue || !row.raw) {
      reject(row.line, 'INVALID', '', null, [row.issue ?? { field: '', code: 'row_not_object' }]);
      continue;
    }
    const prepared = prepareVenueRow(row.raw);
    const preview = previewOf(prepared.raw.question);
    const problems: VenueIssue[] = [...prepared.issues];
    const category = resolveCategory(prepared.raw.category);
    const resolved = 'id' in category ? category : null;
    if (!resolved) problems.push(category as VenueIssue);
    const result = parseImportRow({ ...prepared.raw, category: resolved?.id ?? 'general' });
    if (!result.ok)
      problems.push(
        ...describeImportIssues(result.issues, prepared.raw).filter(
          (item) => item.field !== 'category',
        ),
      );
    if (problems.length > 0 || !result.ok || !resolved) {
      reject(row.line, 'INVALID', preview, resolved?.label ?? null, problems);
      continue;
    }
    const question = result.question;
    if (question.authorType === 'DEV_SEED') {
      reject(row.line, 'INVALID', preview, resolved.label, [
        { field: 'authorType', code: 'author_invalid' },
      ]);
      continue;
    }
    // Unicode tricks and profanity hidden from the audit's word lists: the player-text gate of ADR-0018.
    const gate = textGate(question);
    if (gate) {
      reject(row.line, 'REJECT', preview, resolved.label, [gate]);
      continue;
    }
    const lexical = lexicalFingerprint(question.language, question.text);
    const twin = seenLexical.get(`${question.language}:${lexical}`);
    if (twin !== undefined) {
      reject(row.line, 'DUPLICATE', preview, resolved.label, [
        { field: '', code: 'duplicate_in_file', params: { line: twin } },
      ]);
      continue;
    }
    const stored = index.findLexical(question.language, lexical);
    if (stored) {
      const same = stored.correctKey === foldKey(correctText(question), question.language);
      reject(row.line, 'DUPLICATE', preview, resolved.label, [
        { field: '', code: same ? 'duplicate' : 'conflicting_duplicate' },
      ]);
      continue;
    }
    seenLexical.set(`${question.language}:${lexical}`, row.line);
    if (resolved.isNew) newCategories.set(resolved.id, resolved.label);
    candidates.push({ line: row.line, question, findings: [], category: resolved, vector: null });
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

  const items: BatchItem[] = candidates.map((candidate) => ({
    key: String(candidate.line),
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
      id: String(candidate.line),
      language: candidate.question.language,
      stem: candidate.question.text,
      correctAnswer: correctText(candidate.question),
      vector: candidate.vector,
    }),
  }));
  const never = Number.MAX_SAFE_INTEGER;
  const audited = auditBatch(items, {
    now: options.now,
    // A café's own questions need no sources (the owner is the publisher, ADR-0025 §4), and a file of
    // forty "which of these..." questions is style, not safety: the two repetition rules stay off.
    sourceRequired: () => false,
    ...(options.config ? { config: options.config } : {}),
    rules: { openerMinBatch: never, templateMinBatch: never },
    index,
  });

  const ready: ReadyRow[] = [];
  const room = Math.max(0, VENUE_LIMITS.maxQuestionsPerVenue - used);
  candidates.forEach((candidate, i) => {
    const findings = audited.items[i]!.findings;
    const duplicate = findings.find((item) => DUPLICATE_CODES[item.code]);
    if (duplicate) {
      reject(
        candidate.line,
        'DUPLICATE',
        previewOf(candidate.question.text),
        candidate.category.label,
        [{ field: '', code: DUPLICATE_CODES[duplicate.code]! }],
      );
      return;
    }
    const status = statusOf(findings);
    if (status !== 'PASS') {
      const issues = findings
        .filter((item) => item.severity !== 'INFO')
        .map((item): VenueIssue => {
          const params = paramsOf(item.detail);
          return { field: '', code: item.code, ...(params ? { params } : {}) };
        });
      reject(
        candidate.line,
        status,
        previewOf(candidate.question.text),
        candidate.category.label,
        issues,
      );
      return;
    }
    if (ready.length >= room) {
      reject(candidate.line, 'FULL', previewOf(candidate.question.text), candidate.category.label, [
        { field: '', code: 'venue_full', params: { max: VENUE_LIMITS.maxQuestionsPerVenue } },
      ]);
      return;
    }
    ready.push({ ...candidate, findings });
  });
  counts.ok = ready.length;

  const byCategory = new Map<string, VenueCategoryCount>();
  for (const row of ready) {
    const entry = byCategory.get(row.category.id) ?? {
      id: row.category.id,
      label: row.category.label,
      isNew: row.category.isNew,
      count: 0,
    };
    entry.count++;
    byCategory.set(row.category.id, entry);
  }
  const reportedNew = [...newCategories].filter(([id]) => byCategory.has(id));
  reports.sort((a, b) => a.line - b.line);
  const sample = ready.slice(0, SAMPLE_ROWS).map((row): VenueRowReport => ({
    line: row.line,
    status: 'OK',
    preview: previewOf(row.question.text),
    category: row.category.label,
    issues: [],
  }));
  const analysis: VenueAnalysis = {
    ...base,
    alreadyImported: null,
    counts,
    categories: [...byCategory.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'tr'),
    ),
    rows: reports.slice(0, REPORTED_ROWS_CAP),
    rowsOmitted: Math.max(0, reports.length - REPORTED_ROWS_CAP),
    sample,
    batch: audited.batchFindings,
    capacity: { used, max: VENUE_LIMITS.maxQuestionsPerVenue },
  };
  return {
    result: analysis,
    plan: {
      analysis,
      ready,
      newCategories: reportedNew.map(([id, label]) => ({ id, label })),
      embedderId: embedder.id,
    },
  };
}

/** The player-text gate (invisible/format characters, hidden profanity) over everything a player will read. */
function textGate(question: NormalizedQuestion): VenueIssue | null {
  const fields: [string, string | null][] = [
    ['question', question.text],
    ...question.options.map((option, i): [string, string] => [`options.${i}`, option.text]),
    ['explanation', question.explanation],
    ['subcategory', question.subcategory],
    ['topic', question.topic],
  ];
  for (const [field, value] of fields) {
    if (value === null) continue;
    const checked = sanitizeUserText(value, { maxLength: 1000, allowLinks: true });
    if (checked.ok) continue;
    if (checked.reason === 'PROFANITY') return { field, code: 'text_profanity' };
    if (checked.reason === 'FORBIDDEN_CHARACTER')
      return { field, code: 'text_forbidden_characters' };
  }
  return null;
}

// ───────────── import ─────────────

export class VenueContentError extends Error {
  constructor(readonly code: 'VENUE_FULL' | 'NOT_FOUND' | 'ALREADY_RETIRED') {
    super(code);
  }
}

export interface VenueImportResult {
  analysis: VenueAnalysis;
  /** The upload this call created, or the live one with the same bytes. */
  uploadId: string | null;
  imported: number;
}

export async function importVenueUpload(
  db: Database,
  input: { venueId: string; accountId: string; fileName: string; bytes: Uint8Array },
  options: VenueAnalysisOptions,
): Promise<VenueAnalysisFailure | VenueImportResult> {
  const { result, plan: planned } = await plan(db, input, options);
  if (!result.ok) return result;
  if (result.alreadyImported)
    return { analysis: result, uploadId: result.alreadyImported.uploadId, imported: 0 };
  const { ready, newCategories, embedderId } = planned!;
  const analysis = result;
  const byCategory: Record<string, number> = {};
  for (const row of ready) byCategory[row.category.id] = (byCategory[row.category.id] ?? 0) + 1;

  const uploadId: string | null = await db.transaction().execute(async (trx) => {
    // One import per venue at a time: the cap and the live-hash rule are checked under this lock.
    await trx
      .selectFrom('venues')
      .select('id')
      .where('id', '=', input.venueId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const live = await trx
      .selectFrom('venue_question_uploads')
      .select('id')
      .where('venue_id', '=', input.venueId)
      .where('file_hash', '=', analysis.fileHash)
      .where('state', '=', 'ACTIVE')
      .executeTakeFirst();
    if (live) return live.id;
    const used = await activeCount(trx, input.venueId);
    if (used + ready.length > VENUE_LIMITS.maxQuestionsPerVenue)
      throw new VenueContentError('VENUE_FULL');
    if (ready.length === 0) {
      // Nothing to publish (all duplicates, or nothing valid): no upload to remove later, only the trace.
      await trx
        .insertInto('venue_content_events')
        .values({
          venue_id: input.venueId,
          kind: 'IMPORT',
          actor_account_id: input.accountId,
          at: options.now,
          detail: JSON.stringify({
            fileHash: analysis.fileHash,
            imported: 0,
            counts: analysis.counts,
          }),
        })
        .execute();
      return null;
    }

    const upload = await trx
      .insertInto('venue_question_uploads')
      .values({
        venue_id: input.venueId,
        uploaded_by: input.accountId,
        uploaded_at: options.now,
        file_name: analysis.fileName,
        file_hash: analysis.fileHash,
        format: analysis.format,
        bytes: analysis.bytes,
        rows_total: analysis.counts.total,
        rows_imported: ready.length,
        rows_review: analysis.counts.review,
        rows_rejected: analysis.counts.reject,
        rows_invalid: analysis.counts.invalid,
        rows_duplicate: analysis.counts.duplicate,
        by_category: JSON.stringify(byCategory),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (newCategories.length > 0)
      await trx
        .insertInto('categories')
        .values(
          newCategories.map((category, position) => ({
            id: category.id,
            label_tr: category.label,
            label_en: category.label,
            sort_order: 200 + position,
            free_rotation: false,
            source_required: false,
            owner_venue_id: input.venueId,
          })),
        )
        .onConflict((conflict) => conflict.doNothing())
        .execute();

    await setLogContext(trx, {
      actor: input.accountId,
      reason: 'VENUE_IMPORT',
      detail: { venueId: input.venueId, uploadId: upload.id },
    });
    for (const row of ready) {
      const fingerprints = fingerprintsFor(row.question, row.vector, embedderId);
      const inserted = await insertQuestion(trx, {
        question: row.question,
        fingerprints,
        status: 'DRAFT',
        isDevSeed: false,
        venue: { venueId: input.venueId, uploadId: upload.id },
      });
      const pass = heuristicPass(row.findings, { duplicatesChecked: true });
      // The venue owner attests the facts (ADR-0025 §4): the guard accepts a PASS heuristic audit for
      // an owner-venue row, and the record says plainly that no fact check exists.
      await appendAudit(
        trx,
        inserted.id,
        inserted.revision,
        {
          ...pass,
          detail: {
            ...pass.detail,
            ownerAttested: true,
            factCheck: 'NOT_RUN',
            venueId: input.venueId,
            uploadId: upload.id,
          },
        },
        input.accountId,
      );
      await trx
        .updateTable('questions')
        .set({ status: 'ACTIVE' })
        .where('id', '=', inserted.id)
        .execute();
    }
    await trx
      .insertInto('venue_content_events')
      .values({
        venue_id: input.venueId,
        upload_id: upload.id,
        kind: 'IMPORT',
        actor_account_id: input.accountId,
        at: options.now,
        detail: JSON.stringify({
          fileHash: analysis.fileHash,
          imported: ready.length,
          counts: analysis.counts,
        }),
      })
      .execute();
    return upload.id;
  });
  return { analysis, uploadId, imported: ready.length };
}

// ───────────── the set: list, retire, export ─────────────

export interface VenueUploadSummary {
  id: string;
  fileName: string;
  uploadedAt: string;
  format: string;
  rowsTotal: number;
  rowsImported: number;
  rowsReview: number;
  rowsRejected: number;
  rowsInvalid: number;
  rowsDuplicate: number;
  state: 'ACTIVE' | 'RETIRED';
  /** Questions of this upload that are still ACTIVE. */
  active: number;
  fileHash: string;
}

export interface VenueSetSummary {
  uploads: VenueUploadSummary[];
  totals: { active: number; review: number; retired: number; max: number };
  categories: { id: string; label: string; active: number }[];
  venueCategories: number;
  maxVenueCategories: number;
}

export async function venueSetSummary(db: Database, venueId: string): Promise<VenueSetSummary> {
  const [uploads, perUpload, perStatus, perCategory, categories] = await Promise.all([
    db
      .selectFrom('venue_question_uploads')
      .selectAll()
      .where('venue_id', '=', venueId)
      .orderBy('uploaded_at', 'desc')
      .limit(100)
      .execute(),
    db
      .selectFrom('questions')
      .select(['venue_upload_id', (eb) => eb.fn.countAll<number>().as('n')])
      .where('owner_venue_id', '=', venueId)
      .where('status', '=', 'ACTIVE')
      .groupBy('venue_upload_id')
      .execute(),
    db
      .selectFrom('questions')
      .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
      .where('owner_venue_id', '=', venueId)
      .groupBy('status')
      .execute(),
    db
      .selectFrom('questions')
      .innerJoin('categories', 'categories.id', 'questions.category_id')
      .select([
        'categories.id as id',
        'categories.label_tr as label',
        (eb) => eb.fn.countAll<number>().as('n'),
      ])
      .where('questions.owner_venue_id', '=', venueId)
      .where('questions.status', '=', 'ACTIVE')
      .groupBy(['categories.id', 'categories.label_tr'])
      .orderBy('n', 'desc')
      .execute(),
    db
      .selectFrom('categories')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('owner_venue_id', '=', venueId)
      .executeTakeFirstOrThrow(),
  ]);
  const activeBy = new Map(perUpload.map((row) => [row.venue_upload_id, Number(row.n)]));
  const status = new Map(perStatus.map((row) => [row.status, Number(row.n)]));
  return {
    uploads: uploads.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      uploadedAt: row.uploaded_at.toISOString(),
      format: row.format,
      rowsTotal: row.rows_total,
      rowsImported: row.rows_imported,
      rowsReview: row.rows_review,
      rowsRejected: row.rows_rejected,
      rowsInvalid: row.rows_invalid,
      rowsDuplicate: row.rows_duplicate,
      state: row.state as 'ACTIVE' | 'RETIRED',
      active: activeBy.get(row.id) ?? 0,
      fileHash: row.file_hash,
    })),
    totals: {
      active: status.get('ACTIVE') ?? 0,
      review: status.get('REVIEW') ?? 0,
      retired: status.get('RETIRED') ?? 0,
      max: VENUE_LIMITS.maxQuestionsPerVenue,
    },
    categories: perCategory.map((row) => ({ id: row.id, label: row.label, active: Number(row.n) })),
    venueCategories: Number(categories.n),
    maxVenueCategories: VENUE_LIMITS.maxCategoriesPerVenue,
  };
}

/** Every venue's sets at a glance, for the admin console. */
export async function allVenueSets(db: Database): Promise<
  {
    venueId: string;
    name: string;
    active: number;
    review: number;
    retired: number;
    uploads: number;
    lastUploadAt: string | null;
  }[]
> {
  const rows = await db
    .selectFrom('venues')
    .select([
      'venues.id as id',
      'venues.name as name',
      sql<number>`(select count(*)::int from questions q where q.owner_venue_id = venues.id and q.status = 'ACTIVE')`.as(
        'active',
      ),
      sql<number>`(select count(*)::int from questions q where q.owner_venue_id = venues.id and q.status = 'REVIEW')`.as(
        'review',
      ),
      sql<number>`(select count(*)::int from questions q where q.owner_venue_id = venues.id and q.status = 'RETIRED')`.as(
        'retired',
      ),
      sql<number>`(select count(*)::int from venue_question_uploads u where u.venue_id = venues.id)`.as(
        'uploads',
      ),
      sql<Date | null>`(select max(u.uploaded_at) from venue_question_uploads u where u.venue_id = venues.id)`.as(
        'last_upload',
      ),
    ])
    .orderBy('venues.name')
    .execute();
  return rows.map((row) => ({
    venueId: row.id,
    name: row.name,
    active: row.active,
    review: row.review,
    retired: row.retired,
    uploads: row.uploads,
    lastUploadAt: row.last_upload ? new Date(row.last_upload).toISOString() : null,
  }));
}

export type RetireActor = { accountId: string; admin: boolean };

/**
 * "Bu yüklemeyi kaldır": every question of the upload leaves play (RETIRED, logged by the status trigger),
 * the upload is marked RETIRED. Nothing is deleted; the same file can be uploaded again afterwards.
 */
export async function retireVenueUpload(
  db: Database,
  venueId: string,
  uploadId: string,
  actor: RetireActor,
  now: Date,
): Promise<{ retired: number }> {
  return db.transaction().execute(async (trx) => {
    const upload = await trx
      .selectFrom('venue_question_uploads')
      .select(['id', 'state'])
      .where('id', '=', uploadId)
      .where('venue_id', '=', venueId)
      .forUpdate()
      .executeTakeFirst();
    if (!upload) throw new VenueContentError('NOT_FOUND');
    if (upload.state === 'RETIRED') throw new VenueContentError('ALREADY_RETIRED');
    await setLogContext(trx, {
      actor: actor.accountId,
      reason: actor.admin ? 'VENUE_ADMIN_RETIRE_UPLOAD' : 'VENUE_RETIRE_UPLOAD',
      detail: { venueId, uploadId },
    });
    const result = await trx
      .updateTable('questions')
      .set({
        status: 'RETIRED',
        retired_at: now,
        retire_reason: actor.admin
          ? 'venue upload removed by an administrator'
          : 'venue upload removed',
      })
      .where('venue_upload_id', '=', uploadId)
      .where('owner_venue_id', '=', venueId)
      .where('status', '!=', 'RETIRED')
      .executeTakeFirst();
    await trx
      .updateTable('venue_question_uploads')
      .set({ state: 'RETIRED', retired_at: now, retired_by: actor.accountId })
      .where('id', '=', uploadId)
      .execute();
    const retired = Number(result.numUpdatedRows);
    await trx
      .insertInto('venue_content_events')
      .values({
        venue_id: venueId,
        upload_id: uploadId,
        kind: actor.admin ? 'ADMIN_RETIRE_UPLOAD' : 'RETIRE_UPLOAD',
        actor_account_id: actor.accountId,
        at: now,
        detail: JSON.stringify({ retired }),
      })
      .execute();
    return { retired };
  });
}

/** One question of the venue leaves play (an owner or an administrator acting on a report). */
export async function retireVenueQuestion(
  db: Database,
  venueId: string,
  questionId: string,
  actor: RetireActor,
  now: Date,
  reason = 'venue question removed',
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const question = await trx
      .selectFrom('questions')
      .select(['id', 'status', 'venue_upload_id'])
      .where('id', '=', questionId)
      .where('owner_venue_id', '=', venueId)
      .forUpdate()
      .executeTakeFirst();
    if (!question) throw new VenueContentError('NOT_FOUND');
    if (question.status === 'RETIRED') return;
    await setLogContext(trx, {
      actor: actor.accountId,
      reason: actor.admin ? 'VENUE_ADMIN_RETIRE_QUESTION' : 'VENUE_RETIRE_QUESTION',
      detail: { venueId },
    });
    await trx
      .updateTable('questions')
      .set({ status: 'RETIRED', retired_at: now, retire_reason: reason })
      .where('id', '=', questionId)
      .execute();
    await trx
      .insertInto('venue_content_events')
      .values({
        venue_id: venueId,
        upload_id: question.venue_upload_id,
        kind: actor.admin ? 'ADMIN_RETIRE_QUESTION' : 'RETIRE_QUESTION',
        actor_account_id: actor.accountId,
        at: now,
        detail: JSON.stringify({ questionId }),
      })
      .execute();
  });
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const VENUE_EXPORT_HEADER = [
  'category',
  'difficulty',
  'question',
  ...LETTERS.map((letter) => `option${letter}`),
  'correct',
  'explanation',
  'sourceUrl',
  'sourceTitle',
] as const;

/** The venue's live questions in the upload format, every cell guarded against spreadsheet formulas. */
export async function exportVenueSet(db: Database, venueId: string): Promise<string> {
  const questions = await db
    .selectFrom('questions')
    .innerJoin('categories', 'categories.id', 'questions.category_id')
    .select([
      'questions.id as id',
      'categories.label_tr as category',
      'questions.difficulty as difficulty',
      'questions.text as text',
      'questions.explanation as explanation',
    ])
    .where('questions.owner_venue_id', '=', venueId)
    .where('questions.status', '!=', 'RETIRED')
    .orderBy('questions.created_at')
    .orderBy('questions.id')
    .limit(VENUE_LIMITS.maxQuestionsPerVenue)
    .execute();
  const ids = questions.map((question) => question.id);
  const [options, sources] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .selectFrom('question_options')
            .select(['question_id', 'position', 'text', 'is_correct'])
            .where('question_id', 'in', ids)
            .orderBy('position')
            .execute(),
          db
            .selectFrom('question_sources')
            .select(['question_id', 'url', 'title'])
            .where('question_id', 'in', ids)
            .orderBy('url')
            .execute(),
        ]);
  const optionsOf = new Map<string, typeof options>();
  for (const option of options) {
    const list = optionsOf.get(option.question_id) ?? [];
    list.push(option);
    optionsOf.set(option.question_id, list);
  }
  const sourceOf = new Map<string, (typeof sources)[number]>();
  for (const source of sources)
    if (!sourceOf.has(source.question_id)) sourceOf.set(source.question_id, source);
  const body = questions.map((question) => {
    const list = optionsOf.get(question.id) ?? [];
    const correct = list.findIndex((option) => option.is_correct);
    const source = sourceOf.get(question.id);
    return [
      question.category,
      question.difficulty,
      question.text,
      ...LETTERS.map((_, i) => list[i]?.text ?? ''),
      LETTERS[correct] ?? '',
      question.explanation ?? '',
      source?.url ?? '',
      source?.title ?? '',
    ];
  });
  return toCsv([[...VENUE_EXPORT_HEADER], ...body]);
}

// ───────────── reports on the venue's own questions ─────────────

export interface VenueReportItem {
  id: string;
  questionId: string;
  reason: string;
  createdAt: string;
  questionText: string;
  questionStatus: string;
}

/** Open player reports about this venue's questions: reason and text only, never who reported. */
export async function venueOpenReports(db: Database, venueId: string): Promise<VenueReportItem[]> {
  const rows = await db
    .selectFrom('question_reports')
    .innerJoin('questions', 'questions.id', 'question_reports.question_id')
    .select([
      'question_reports.id as id',
      'question_reports.question_id as question_id',
      'question_reports.reason as reason',
      'question_reports.created_at as created_at',
      'questions.text as text',
      'questions.status as status',
    ])
    .where('questions.owner_venue_id', '=', venueId)
    .where('question_reports.status', '=', 'OPEN')
    .orderBy('question_reports.created_at', 'desc')
    .limit(100)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    questionId: row.question_id,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
    questionText: row.text,
    questionStatus: row.status,
  }));
}

/** The owner's decision on a report about their own question: dismiss it, or take the question out of play. */
export async function resolveVenueReport(
  db: Database,
  venueId: string,
  reportId: string,
  action: 'DISMISS' | 'RETIRE',
  actor: RetireActor,
  now: Date,
): Promise<void> {
  const report = await db
    .selectFrom('question_reports')
    .innerJoin('questions', 'questions.id', 'question_reports.question_id')
    .select([
      'question_reports.id as id',
      'question_reports.question_id as question_id',
      'question_reports.status as status',
    ])
    .where('question_reports.id', '=', reportId)
    .where('questions.owner_venue_id', '=', venueId)
    .executeTakeFirst();
  if (!report) throw new VenueContentError('NOT_FOUND');
  if (action === 'RETIRE')
    await retireVenueQuestion(
      db,
      venueId,
      report.question_id,
      actor,
      now,
      'venue owner acted on a report',
    );
  await db
    .updateTable('question_reports')
    .set({
      status: action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED',
      resolved_at: now,
      resolved_by: actor.accountId,
      resolution:
        action === 'DISMISS' ? 'venue owner dismissed' : 'venue owner retired the question',
    })
    .where((eb) =>
      action === 'DISMISS' ? eb('id', '=', reportId) : eb('question_id', '=', report.question_id),
    )
    .where('status', '=', 'OPEN')
    .execute();
}
