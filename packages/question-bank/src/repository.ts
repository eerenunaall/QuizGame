import type { Database } from '@quizparty/db';
import {
  PassResultSchema,
  buildEntry,
  decodeVector,
  encodeVector,
  lexicalFingerprint,
  MemorySimilarityIndex,
  minhash,
  similarityKey,
  sha256Hex,
  FINGERPRINT_VERSION,
  type AuditPassResult,
  type AuditSubject,
  type NormalizedQuestion,
  type QuestionStatus,
} from '@quizparty/question-schema';

/** Row shapes the rest of the package works with: plain data, no Kysely types leaking out. */
export interface StoredOption {
  id: string;
  position: number;
  text: string;
  correct: boolean;
}

export interface StoredQuestion {
  id: string;
  externalId: string | null;
  revision: number;
  status: QuestionStatus;
  isDevSeed: boolean;
  verificationStatus: string;
  lexical: string;
  semantic: string | null;
  semanticProvider: string | null;
  sourceRequired: boolean;
  options: StoredOption[];
  question: NormalizedQuestion;
}

export function correctText(question: NormalizedQuestion): string {
  return question.options.find((option) => option.correct)?.text ?? '';
}

export interface Fingerprints {
  lexical: string;
  minhash: number[];
  semantic: string | null;
  semanticProvider: string | null;
}

export function fingerprintsFor(
  question: NormalizedQuestion,
  vector: Float32Array | null,
  provider: string | null,
): Fingerprints {
  return {
    lexical: lexicalFingerprint(question.language, question.text),
    minhash: minhash(similarityKey(question.language, question.text, correctText(question))),
    semantic: vector ? encodeVector(vector) : null,
    semanticProvider: vector ? provider : null,
  };
}

/** Hash of the content that readers see; metadata (sources, dates) is compared separately. */
export function contentHash(question: NormalizedQuestion): string {
  return sha256Hex(
    JSON.stringify([
      question.language,
      question.category,
      question.difficulty,
      question.text,
      question.explanation,
      question.pool,
      question.options.map((option) => [option.text, option.correct]),
    ]),
  );
}

export function metadataHash(question: NormalizedQuestion): string {
  return sha256Hex(
    JSON.stringify([
      question.subcategory,
      question.topic,
      question.expiresAt?.toISOString() ?? null,
      question.lastVerifiedAt?.toISOString() ?? null,
      question.sources.map((source) => [source.url, source.title]),
    ]),
  );
}

export function toSubject(stored: StoredQuestion): AuditSubject {
  const { question } = stored;
  return {
    id: stored.id,
    language: question.language,
    category: question.category,
    difficulty: question.difficulty,
    text: question.text,
    explanation: question.explanation,
    options: question.options,
    pool: question.pool,
    expiresAt: question.expiresAt,
    lastVerifiedAt: question.lastVerifiedAt,
    sourceCount: question.sources.length,
    authorType: question.authorType,
  };
}

export async function loadQuestion(db: Database, id: string): Promise<StoredQuestion | null> {
  const row = await db
    .selectFrom('questions')
    .innerJoin('categories', 'categories.id', 'questions.category_id')
    .selectAll('questions')
    .select('categories.source_required as source_required')
    .where('questions.id', '=', id)
    .executeTakeFirst();
  if (!row) return null;
  return hydrate(db, row);
}

export async function loadQuestionByExternalId(
  db: Database,
  externalId: string,
): Promise<StoredQuestion | null> {
  const row = await db
    .selectFrom('questions')
    .innerJoin('categories', 'categories.id', 'questions.category_id')
    .selectAll('questions')
    .select('categories.source_required as source_required')
    .where('questions.external_id', '=', externalId)
    .executeTakeFirst();
  if (!row) return null;
  return hydrate(db, row);
}

type QuestionRowShape = {
  id: string;
  external_id: string | null;
  revision: number;
  status: string;
  is_dev_seed: boolean;
  verification_status: string;
  lexical_fingerprint: string;
  semantic_fingerprint: string | null;
  semantic_provider: string | null;
  language: string;
  category_id: string;
  subcategory: string | null;
  topic: string | null;
  difficulty: string;
  text: string;
  explanation: string | null;
  pool: string;
  expires_at: Date | null;
  last_verified_at: Date | null;
  author_type: string;
  source_required: boolean;
};

async function hydrate(db: Database, row: QuestionRowShape): Promise<StoredQuestion> {
  const [options, sources] = await Promise.all([
    db
      .selectFrom('question_options')
      .select(['id', 'position', 'text', 'is_correct'])
      .where('question_id', '=', row.id)
      .orderBy('position')
      .execute(),
    db
      .selectFrom('question_sources')
      .select(['url', 'title', 'retrieved_at'])
      .where('question_id', '=', row.id)
      .orderBy('url')
      .execute(),
  ]);
  return assemble(row, options, sources);
}

function assemble(
  row: QuestionRowShape,
  options: { id: string; position: number; text: string; is_correct: boolean }[],
  sources: { url: string; title: string | null; retrieved_at: Date | null }[],
): StoredQuestion {
  return {
    id: row.id,
    externalId: row.external_id,
    revision: row.revision,
    status: row.status as QuestionStatus,
    isDevSeed: row.is_dev_seed,
    verificationStatus: row.verification_status,
    lexical: row.lexical_fingerprint,
    semantic: row.semantic_fingerprint,
    semanticProvider: row.semantic_provider,
    sourceRequired: row.source_required,
    options: options.map((option) => ({
      id: option.id,
      position: option.position,
      text: option.text,
      correct: option.is_correct,
    })),
    question: {
      externalId: row.external_id,
      language: row.language as 'tr' | 'en',
      category: row.category_id,
      subcategory: row.subcategory,
      topic: row.topic,
      difficulty: row.difficulty as NormalizedQuestion['difficulty'],
      text: row.text,
      explanation: row.explanation,
      options: options.map((option) => ({ text: option.text, correct: option.is_correct })),
      sources: sources.map((source) => ({
        url: source.url,
        title: source.title,
        retrievedAt: source.retrieved_at,
      })),
      pool: row.pool as NormalizedQuestion['pool'],
      expiresAt: row.expires_at,
      lastVerifiedAt: row.last_verified_at,
      authorType: row.author_type as NormalizedQuestion['authorType'],
    },
  };
}

async function loadChunk(
  db: Database,
  column: 'questions.external_id' | 'questions.id',
  values: readonly string[],
): Promise<StoredQuestion[]> {
  const rows = await db
    .selectFrom('questions')
    .innerJoin('categories', 'categories.id', 'questions.category_id')
    .selectAll('questions')
    .select('categories.source_required as source_required')
    .where(column, 'in', [...values])
    .execute();
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [options, sources] = await Promise.all([
    db
      .selectFrom('question_options')
      .select(['id', 'question_id', 'position', 'text', 'is_correct'])
      .where('question_id', 'in', ids)
      .orderBy('position')
      .execute(),
    db
      .selectFrom('question_sources')
      .select(['question_id', 'url', 'title', 'retrieved_at'])
      .where('question_id', 'in', ids)
      .orderBy('url')
      .execute(),
  ]);
  return rows.map((row) =>
    assemble(
      row,
      options.filter((option) => option.question_id === row.id),
      sources.filter((source) => source.question_id === row.id),
    ),
  );
}

/** Loads many questions by external id with three queries per chunk (importer idempotency check). */
export async function loadManyByExternalId(
  db: Database,
  externalIds: readonly string[],
): Promise<Map<string, StoredQuestion>> {
  const out = new Map<string, StoredQuestion>();
  for (let start = 0; start < externalIds.length; start += 500)
    for (const stored of await loadChunk(
      db,
      'questions.external_id',
      externalIds.slice(start, start + 500),
    ))
      if (stored.externalId) out.set(stored.externalId, stored);
  return out;
}

/** Loads many questions by id, in the order given (missing ids are skipped). */
export async function loadManyByIds(
  db: Database,
  ids: readonly string[],
): Promise<StoredQuestion[]> {
  const found = new Map<string, StoredQuestion>();
  for (let start = 0; start < ids.length; start += 500)
    for (const stored of await loadChunk(db, 'questions.id', ids.slice(start, start + 500)))
      found.set(stored.id, stored);
  return ids.flatMap((id) => (found.has(id) ? [found.get(id)!] : []));
}

/**
 * Loads every stored question into a duplicate index (one query). Vectors from another provider
 * than `provider` are left out: cosines across embedding models mean nothing.
 */
export async function loadIndex(
  db: Database,
  provider: string | null,
): Promise<MemorySimilarityIndex> {
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
    .execute();
  const index = new MemorySimilarityIndex();
  for (const row of rows) {
    const usable = row.semantic !== null && row.semantic_provider === provider;
    index.add(
      buildEntry({
        id: row.id,
        language: row.language as 'tr' | 'en',
        stem: row.text,
        correctAnswer: row.correct_text ?? '',
        lexical: row.lexical,
        ...(row.minhash && row.minhash.length > 0 ? { minhash: row.minhash } : {}),
        vector: usable && row.semantic ? decodeVector(row.semantic) : null,
      }),
    );
  }
  return index;
}

export interface NewQuestionRow {
  question: NormalizedQuestion;
  fingerprints: Fingerprints;
  status: QuestionStatus;
  isDevSeed: boolean;
}

/** Inserts a question with its options and sources inside the caller's transaction. */
export async function insertQuestion(
  trx: Database,
  input: NewQuestionRow,
): Promise<{ id: string; revision: number; optionIds: string[] }> {
  const { question, fingerprints } = input;
  const inserted = await trx
    .insertInto('questions')
    .values({
      external_id: question.externalId,
      language: question.language,
      category_id: question.category,
      subcategory: question.subcategory,
      topic: question.topic,
      difficulty: question.difficulty,
      text: question.text,
      explanation: question.explanation,
      pool: question.pool,
      expires_at: question.expiresAt,
      last_verified_at: question.lastVerifiedAt,
      status: input.status,
      author_type: question.authorType,
      is_dev_seed: input.isDevSeed,
      lexical_fingerprint: fingerprints.lexical,
      minhash: fingerprints.minhash,
      semantic_fingerprint: fingerprints.semantic,
      semantic_provider: fingerprints.semanticProvider,
      fingerprint_version: FINGERPRINT_VERSION,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const options = await trx
    .insertInto('question_options')
    .values(
      question.options.map((option, position) => ({
        question_id: inserted.id,
        position,
        text: option.text,
        is_correct: option.correct,
      })),
    )
    .returning(['id', 'position'])
    .execute();
  if (question.sources.length > 0) {
    await trx
      .insertInto('question_sources')
      .values(
        question.sources.map((source) => ({
          question_id: inserted.id,
          url: source.url,
          title: source.title,
          retrieved_at: source.retrievedAt,
        })),
      )
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  }
  const { revision } = await trx
    .selectFrom('questions')
    .select('revision')
    .where('id', '=', inserted.id)
    .executeTakeFirstOrThrow();
  return {
    id: inserted.id,
    revision,
    optionIds: options.sort((a, b) => a.position - b.position).map((option) => option.id),
  };
}

/** Replaces options and sources of a question (the caller has already moved it out of APPROVED/ACTIVE). */
export async function replaceContent(
  trx: Database,
  id: string,
  question: NormalizedQuestion,
  fingerprints: Fingerprints,
): Promise<void> {
  await trx
    .updateTable('questions')
    .set({
      category_id: question.category,
      subcategory: question.subcategory,
      topic: question.topic,
      difficulty: question.difficulty,
      text: question.text,
      explanation: question.explanation,
      pool: question.pool,
      expires_at: question.expiresAt,
      last_verified_at: question.lastVerifiedAt,
      lexical_fingerprint: fingerprints.lexical,
      minhash: fingerprints.minhash,
      semantic_fingerprint: fingerprints.semantic,
      semantic_provider: fingerprints.semanticProvider,
      fingerprint_version: FINGERPRINT_VERSION,
    })
    .where('id', '=', id)
    .execute();
  await trx.deleteFrom('question_options').where('question_id', '=', id).execute();
  await trx
    .insertInto('question_options')
    .values(
      question.options.map((option, position) => ({
        question_id: id,
        position,
        text: option.text,
        is_correct: option.correct,
      })),
    )
    .execute();
  await trx.deleteFrom('question_sources').where('question_id', '=', id).execute();
  if (question.sources.length > 0) {
    await trx
      .insertInto('question_sources')
      .values(
        question.sources.map((source) => ({
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

// ───────────── audits ─────────────

export async function appendAudit(
  trx: Database,
  questionId: string,
  revision: number,
  pass: AuditPassResult,
  actor: string | null,
): Promise<number> {
  const row = await trx
    .insertInto('question_audits')
    .values({
      question_id: questionId,
      question_revision: revision,
      pass: pass.pass,
      provider: pass.provider,
      status: pass.status,
      dimensions: JSON.stringify(pass.dimensions),
      scores: JSON.stringify(pass.scores),
      reason_codes: pass.reasonCodes,
      hard_reject_reasons: pass.hardRejectReasons,
      review_reasons: pass.reviewReasons,
      suggested_rewrite: pass.suggestedRewrite,
      detail: JSON.stringify(pass.detail ?? {}),
      actor_account_id: actor,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface StoredPass {
  id: number;
  createdAt: Date;
  revision: number;
  actor: string | null;
  result: AuditPassResult;
}

function toPass(row: {
  id: number;
  created_at: Date;
  question_revision: number;
  actor_account_id: string | null;
  pass: string;
  provider: string;
  status: string;
  dimensions: unknown;
  scores: unknown;
  reason_codes: string[];
  hard_reject_reasons: string[];
  review_reasons: string[];
  suggested_rewrite: string | null;
  detail: unknown;
}): StoredPass {
  return {
    id: row.id,
    createdAt: row.created_at,
    revision: row.question_revision,
    actor: row.actor_account_id,
    result: PassResultSchema.parse({
      pass: row.pass,
      provider: row.provider,
      status: row.status,
      dimensions: row.dimensions,
      scores: row.scores,
      reasonCodes: row.reason_codes,
      hardRejectReasons: row.hard_reject_reasons,
      reviewReasons: row.review_reasons,
      suggestedRewrite: row.suggested_rewrite,
      detail: row.detail,
    }),
  };
}

const AUDIT_COLUMNS = [
  'id',
  'created_at',
  'question_revision',
  'actor_account_id',
  'pass',
  'provider',
  'status',
  'dimensions',
  'scores',
  'reason_codes',
  'hard_reject_reasons',
  'review_reasons',
  'suggested_rewrite',
  'detail',
] as const;

/** Every stored pass for a question, oldest first (all revisions unless one is given). */
export async function listAudits(
  db: Database,
  questionId: string,
  revision?: number,
): Promise<StoredPass[]> {
  let query = db
    .selectFrom('question_audits')
    .select([...AUDIT_COLUMNS])
    .where('question_id', '=', questionId);
  if (revision !== undefined) query = query.where('question_revision', '=', revision);
  const rows = await query.orderBy('id').execute();
  return rows.map(toPass);
}

export async function latestOfPass(
  db: Database,
  questionId: string,
  revision: number,
  pass: string,
): Promise<StoredPass | null> {
  const row = await db
    .selectFrom('question_audits')
    .select([...AUDIT_COLUMNS])
    .where('question_id', '=', questionId)
    .where('question_revision', '=', revision)
    .where('pass', '=', pass)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? toPass(row) : null;
}
