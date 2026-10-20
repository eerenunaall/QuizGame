import type { Database } from '@quizparty/db';
import {
  ExternalAuditRowSchema,
  externalRowToPass,
  parseJsonl,
  summarize,
  type AuditPassResult,
  type BatchSummary,
  type Dimension,
  type DimensionStatus,
  type EmbeddingProvider,
  type HeuristicConfig,
  type Scores,
} from '@quizparty/question-schema';
import { SYSTEM_ACTOR, type Actor } from './lifecycle';
import {
  appendAudit,
  loadQuestion,
  loadQuestionByExternalId,
  type StoredQuestion,
} from './repository';
import { auditQuestionTx, type ReviewContext } from './review';

/** Which score speaks for which dimension when an auditor reports scores only (rubric §2). */
const SCORE_DIMENSIONS: [Dimension, keyof Scores, number][] = [
  ['factCheck', 'factAccuracy', 4],
  ['ambiguity', 'answerFairness', 4],
  ['grammar', 'languageQuality', 4],
  ['style', 'aiSlopRisk', 4],
  ['distractorQuality', 'distractorQuality', 4],
  ['difficulty', 'difficultyAccuracy', 3],
  ['duplication', 'uniqueness', 3],
  ['freshness', 'freshness', 3],
  ['gameplayValue', 'gameplayValue', 3],
];

/** Dimension statuses implied by scores: at the minimum PASS, 0 FAIL, anything between REVIEW. */
export function dimensionsFromScores(scores: Scores): Partial<Record<Dimension, DimensionStatus>> {
  const out: Partial<Record<Dimension, DimensionStatus>> = {};
  for (const [dimension, key, minimum] of SCORE_DIMENSIONS) {
    const value = scores[key];
    if (value === undefined) continue;
    out[dimension] = value >= minimum ? 'PASS' : value === 0 ? 'FAIL' : 'REVIEW';
  }
  return out;
}

export interface ParsedResultLine {
  line: number;
  row?: ReturnType<typeof ExternalAuditRowSchema.parse>;
  error?: string;
}

export function parseResults(text: string): ParsedResultLine[] {
  return parseJsonl(text).map((line) => {
    if (line.error) return { line: line.line, error: line.error };
    const parsed = ExternalAuditRowSchema.safeParse(line.value);
    return parsed.success
      ? { line: line.line, row: parsed.data }
      : { line: line.line, error: `invalid_row:${parsed.error.issues[0]?.path.join('.') ?? ''}` };
  });
}

export interface ResultsImportOptions {
  now: Date;
  /** Label of the auditor ("chatgpt-go", "vendor-2026-10"); stored as `external:<source>`. */
  source: string;
  actor?: Actor;
  config?: Partial<HeuristicConfig>;
  embeddings?: EmbeddingProvider;
}

export interface ResultsImportReport {
  total: number;
  applied: number;
  skipped: { line: number; reason: string; key?: string }[];
  summary: BatchSummary;
}

/**
 * Applies results of a manual audit round. They count as a model pass (`external:<source>`),
 * recorded against the revision the question has now, then the arbiter decides. They are never a
 * human approval: only an editor in the admin console can approve.
 */
export async function importAuditResults(
  db: Database,
  lines: readonly ParsedResultLine[],
  options: ResultsImportOptions,
): Promise<ResultsImportReport> {
  const actor = options.actor ?? SYSTEM_ACTOR;
  const context: ReviewContext = {
    now: options.now,
    ...(options.config ? { config: options.config } : {}),
    ...(options.embeddings ? { embeddings: options.embeddings } : {}),
  };
  const report: ResultsImportReport = {
    total: lines.length,
    applied: 0,
    skipped: [],
    summary: summarize([]),
  };
  const outcomes: { key: string; status: 'PASS' | 'REVIEW' | 'REJECT'; reasons: string[] }[] = [];

  for (const line of lines) {
    if (!line.row) {
      report.skipped.push({ line: line.line, reason: line.error ?? 'invalid' });
      continue;
    }
    const row = line.row;
    if (row.pass === 'MANUAL' || row.pass === 'ARBITER') {
      report.skipped.push({ line: line.line, reason: 'pass_not_importable', key: row.questionId });
      continue;
    }
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      row.questionId,
    );
    const stored: StoredQuestion | null = isUuid
      ? await loadQuestion(db, row.questionId)
      : await loadQuestionByExternalId(db, row.questionId);
    if (!stored) {
      report.skipped.push({ line: line.line, reason: 'question_not_found', key: row.questionId });
      continue;
    }
    if (row.revision !== undefined && row.revision !== stored.revision) {
      // The wording changed after the export: this verdict is about a different question.
      report.skipped.push({ line: line.line, reason: 'revision_changed', key: row.questionId });
      continue;
    }
    const pass: AuditPassResult = {
      ...externalRowToPass({
        ...row,
        pass: row.pass ?? 'FACT_CHECK',
        provider: `external:${options.source}`,
      }),
    };
    if (Object.keys(pass.dimensions).length === 0)
      pass.dimensions = dimensionsFromScores(pass.scores);
    const outcome = await db.transaction().execute(async (trx) => {
      await appendAudit(trx, stored.id, stored.revision, pass, actor.accountId);
      return auditQuestionTx(trx, stored, context, { actor });
    });
    report.applied++;
    outcomes.push({
      key: row.questionId,
      status: outcome.decision.status,
      reasons: outcome.decision.blockers,
    });
  }
  report.summary = summarize(outcomes);
  return report;
}
