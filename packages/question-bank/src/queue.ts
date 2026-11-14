import { sql } from 'kysely';
import type { Database } from '@quizparty/db';
import type { QuestionStatus } from '@quizparty/question-schema';

/**
 * The human review queue (docs/QUESTION_QUALITY.md §10). Priority tiers, highest first:
 *  1 multiple answer disputes · 2 reported · 3 current events / expired · 4 duplicate suspicion ·
 *  5 answer-distribution anomaly · 6 low AI-slop score · 7 questionable source · 8 category mismatch.
 * Inside a tier: more open reports first, then the oldest waiting.
 */
export interface QueueFilter {
  statuses?: readonly QuestionStatus[];
  category?: string;
  /** Only questions whose latest verdict names this reason code. */
  reason?: string;
  limit?: number;
  offset?: number;
}

export interface QueueEntry {
  id: string;
  externalId: string | null;
  category: string;
  difficulty: string;
  language: string;
  text: string;
  status: string;
  pool: string;
  revision: number;
  updatedAt: Date;
  expiresAt: Date | null;
  priority: number;
  openReports: number;
  disputes: number;
  reasons: string[];
}

export interface QueuePage {
  total: number;
  entries: QueueEntry[];
}

export const PRIORITY_NAMES = [
  'DISPUTES',
  'REPORTED',
  'CURRENT_EVENTS',
  'DUPLICATE_SUSPECT',
  'ANSWER_ANOMALY',
  'LOW_SLOP_SCORE',
  'QUESTIONABLE_SOURCE',
  'CATEGORY_MISMATCH',
  'OTHER',
] as const;

export async function reviewQueue(db: Database, filter: QueueFilter = {}): Promise<QueuePage> {
  const statuses = [...(filter.statuses ?? ['REVIEW'])];
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const category = filter.category ?? null;
  const reason = filter.reason ?? null;

  const base = sql`
    WITH scope AS (
      SELECT q.* FROM questions q
      WHERE q.status = ANY(${statuses}::text[])
        AND (${category}::text IS NULL OR q.category_id = ${category})
    ),
    latest AS (
      SELECT DISTINCT ON (a.question_id) a.question_id, a.reason_codes, a.scores
      FROM question_audits a
      JOIN scope s ON s.id = a.question_id AND a.question_revision = s.revision
      WHERE a.pass = 'ARBITER'
      ORDER BY a.question_id, a.id DESC
    ),
    rep AS (
      SELECT r.question_id,
        count(*) FILTER (WHERE r.status = 'OPEN')::int AS open_reports,
        count(*) FILTER (WHERE r.status = 'OPEN' AND r.reason IN ('WRONG_ANSWER', 'MULTIPLE_CORRECT'))::int AS disputes
      FROM question_reports r JOIN scope s ON s.id = r.question_id
      GROUP BY r.question_id
    ),
    ranked AS (
      SELECT s.id, s.external_id, s.category_id, s.difficulty, s.language, s.text, s.status, s.pool,
        s.revision, s.updated_at, s.expires_at,
        COALESCE(rep.open_reports, 0) AS open_reports,
        COALESCE(rep.disputes, 0) AS disputes,
        COALESCE(latest.reason_codes, '{}') AS reasons,
        CASE
          WHEN COALESCE(rep.disputes, 0) >= 2 THEN 1
          WHEN COALESCE(rep.open_reports, 0) >= 1 THEN 2
          WHEN s.pool = 'CURRENT' OR (s.expires_at IS NOT NULL AND s.expires_at <= now()) THEN 3
          WHEN latest.reason_codes && ARRAY['NEAR_DUPLICATE', 'SIMILAR_QUESTION', 'POSSIBLE_SEMANTIC_DUPLICATE', 'CONFLICTING_DUPLICATE'] THEN 4
          WHEN s.answer_count >= 60 AND (s.correct_answer_count::float / s.answer_count < 0.10
               OR s.correct_answer_count::float / s.answer_count > 0.98) THEN 5
          WHEN latest.reason_codes && ARRAY['LLM_STYLE_PHRASES']
               OR COALESCE((latest.scores ->> 'aiSlopRisk')::numeric, 5) <= 3 THEN 6
          WHEN latest.reason_codes && ARRAY['SOURCE_REQUIRED_MISSING'] THEN 7
          WHEN latest.reason_codes && ARRAY['CATEGORY_MISMATCH_SUSPECT'] THEN 8
          ELSE 9
        END AS priority
      FROM scope s
      LEFT JOIN latest ON latest.question_id = s.id
      LEFT JOIN rep ON rep.question_id = s.id
      WHERE (${reason}::text IS NULL OR ${reason} = ANY(COALESCE(latest.reason_codes, '{}')))
    )`;

  const total = await sql<{ n: number }>`${base} SELECT count(*)::int AS n FROM ranked`.execute(db);
  const rows = await sql<{
    id: string;
    external_id: string | null;
    category_id: string;
    difficulty: string;
    language: string;
    text: string;
    status: string;
    pool: string;
    revision: number;
    updated_at: Date;
    expires_at: Date | null;
    priority: number;
    open_reports: number;
    disputes: number;
    reasons: string[];
  }>`${base}
    SELECT * FROM ranked
    ORDER BY priority ASC, open_reports DESC, updated_at ASC, id ASC
    LIMIT ${limit} OFFSET ${offset}`.execute(db);
  return {
    total: total.rows[0]?.n ?? 0,
    entries: rows.rows.map((row) => ({
      id: row.id,
      externalId: row.external_id,
      category: row.category_id,
      difficulty: row.difficulty,
      language: row.language,
      text: row.text,
      status: row.status,
      pool: row.pool,
      revision: row.revision,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      priority: row.priority,
      openReports: row.open_reports,
      disputes: row.disputes,
      reasons: row.reasons,
    })),
  };
}
