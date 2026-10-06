import { z } from 'zod';
import { dimensionStatuses, statusOf, type Finding } from './findings';
import {
  DIMENSIONS,
  DIMENSION_STATUSES,
  REASONS,
  type Dimension,
  type DimensionStatus,
} from './reasons';

/**
 * Structured audit results (docs/QUESTION_QUALITY.md §7, GDD §27) and the arbiter that turns
 * several of them into one decision (ADR-0014): nothing is PASS because one model says so.
 */
export const SCORE_KEYS = [
  'factAccuracy',
  'clarity',
  'uniqueness',
  'distractorQuality',
  'languageQuality',
  'difficultyAccuracy',
  'gameplayValue',
  'answerFairness',
  'freshness',
  'aiSlopRisk',
] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
export type Scores = Partial<Record<ScoreKey, number>>;

/** Rubric §3: what automatic approval requires. */
export const REQUIRED_MINIMUMS: Readonly<Partial<Record<ScoreKey, number>>> = {
  factAccuracy: 4,
  clarity: 4,
  distractorQuality: 4,
  languageQuality: 4,
  answerFairness: 4,
  gameplayValue: 3,
  aiSlopRisk: 4,
};

/** A 0 on these dimensions *is* the rubric's hard-reject wording (false, duplicate, nonsense, …). */
const ZERO_MEANS_REJECT: readonly ScoreKey[] = [
  'factAccuracy',
  'uniqueness',
  'distractorQuality',
  'languageQuality',
  'answerFairness',
  'freshness',
];

export const AUDIT_PASSES = [
  'HEURISTIC',
  'FACT_CHECK',
  'AMBIGUITY',
  'LANGUAGE',
  'DIFFICULTY',
  'GAMEPLAY',
  'ARBITER',
  'MANUAL',
] as const;
export type AuditPassName = (typeof AUDIT_PASSES)[number];

export const AUDIT_STATUSES = ['PASS', 'REVIEW', 'REJECT'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const HEURISTICS_VERSION = 1;

const scoresSchema = z.partialRecord(z.enum(SCORE_KEYS), z.number().min(0).max(5));
const dimensionsSchema = z.partialRecord(z.enum(DIMENSIONS), z.enum(DIMENSION_STATUSES));

/** One audit pass as stored in `question_audits`. */
export const PassResultSchema = z.strictObject({
  pass: z.enum(AUDIT_PASSES),
  provider: z.string().min(1).max(80),
  status: z.enum(AUDIT_STATUSES),
  dimensions: dimensionsSchema.default({}),
  scores: scoresSchema.default({}),
  reasonCodes: z.array(z.string().min(1).max(80)).max(60).default([]),
  hardRejectReasons: z.array(z.string().min(1).max(200)).max(20).default([]),
  reviewReasons: z.array(z.string().min(1).max(200)).max(60).default([]),
  suggestedRewrite: z.string().max(2000).nullable().default(null),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type AuditPassResult = z.output<typeof PassResultSchema>;

/**
 * The row shape the rubric asks auditors (models or people) to output, plus optional pass and
 * provider labels. Used to import results from a manual audit round (GDD §28).
 */
export const ExternalAuditRowSchema = z.strictObject({
  questionId: z.string().min(1).max(64),
  status: z.enum(AUDIT_STATUSES),
  scores: scoresSchema.default({}),
  dimensions: dimensionsSchema.default({}),
  hardRejectReasons: z.array(z.string().min(1).max(200)).max(20).default([]),
  reviewReasons: z.array(z.string().min(1).max(200)).max(60).default([]),
  suggestedRewrite: z.string().max(2000).nullable().default(null),
  pass: z.enum(AUDIT_PASSES).optional(),
  provider: z.string().min(1).max(80).optional(),
});
export type ExternalAuditRow = z.output<typeof ExternalAuditRowSchema>;

export function externalRowToPass(row: ExternalAuditRow): AuditPassResult {
  return {
    pass: row.pass ?? 'MANUAL',
    provider: row.provider ?? 'manual',
    status: row.status,
    dimensions: row.dimensions,
    scores: row.scores,
    reasonCodes: [],
    hardRejectReasons: row.hardRejectReasons,
    reviewReasons: row.reviewReasons,
    suggestedRewrite: row.suggestedRewrite,
  };
}

const HEURISTIC_RAN: readonly Dimension[] = [
  'ambiguity',
  'grammar',
  'style',
  'distractorQuality',
  'freshness',
];

export interface HeuristicPassOptions {
  /** Also examined duplicates (an index was available). */
  duplicatesChecked?: boolean;
  /** REVIEW codes a human approval acknowledged for this revision (never REJECT, never unwaivable). */
  waived?: readonly string[];
  provider?: string;
}

export function heuristicPass(
  findings: readonly Finding[],
  options: HeuristicPassOptions = {},
): AuditPassResult {
  const waived = new Set(options.waived ?? []);
  const effective = findings.filter(
    (item) => !(item.severity === 'REVIEW' && REASONS[item.code].waivable && waived.has(item.code)),
  );
  const ran: Dimension[] = [
    ...HEURISTIC_RAN,
    ...(options.duplicatesChecked ? ['duplication' as const] : []),
  ];
  return {
    pass: 'HEURISTIC',
    provider: options.provider ?? `heuristics@${HEURISTICS_VERSION}`,
    status: statusOf(effective),
    dimensions: dimensionStatuses(effective, ran),
    scores: {},
    reasonCodes: [...new Set(findings.map((item) => item.code))],
    hardRejectReasons: [
      ...new Set(effective.filter((item) => item.severity === 'REJECT').map((item) => item.code)),
    ],
    reviewReasons: [
      ...new Set(effective.filter((item) => item.severity === 'REVIEW').map((item) => item.code)),
    ],
    suggestedRewrite: null,
    detail: {
      version: HEURISTICS_VERSION,
      waived: findings.filter((item) => !effective.includes(item)).map((item) => item.code),
      findings: findings.map((item) => ({
        code: item.code,
        severity: item.severity,
        ...(item.detail ? { detail: item.detail } : {}),
      })),
    },
  };
}

export interface ArbiterDecision {
  status: AuditStatus;
  dimensions: Record<Dimension, DimensionStatus>;
  /** Conservative merge (lowest score per key across passes); null when no pass scored anything. */
  scores: Scores | null;
  reasonCodes: string[];
  hardRejectReasons: string[];
  reviewReasons: string[];
  suggestedRewrite: string | null;
  /** A human approved this revision (their fact-check stands in for model scores). */
  humanApproved: boolean;
}

export interface ArbiterOptions {
  minimums?: Partial<Record<ScoreKey, number>>;
}

const ORDER: Record<DimensionStatus, number> = { NOT_RUN: 0, PASS: 1, REVIEW: 2, FAIL: 3 };

/**
 * Merges the passes of one question revision (chronological order) into the decision stored as the
 * `ARBITER` audit. Rules, in order:
 *  1. any hard-reject reason, FAIL dimension, REJECT pass or zero on a "zero means reject" score
 *     → REJECT (hard rejects always win);
 *  2. fact-check must be PASS (a model or a human did it) → otherwise REVIEW;
 *  3. any remaining REVIEW dimension or pass → REVIEW;
 *  4. rubric §3 minimum scores must be present and met, unless a human approved the revision;
 *  5. otherwise PASS.
 * A human approval waives REVIEW verdicts of model passes recorded *before* it; it never waives
 * REJECT/FAIL, and heuristic REVIEW findings only through the explicit `waived` list.
 */
export function arbitrate(
  passes: readonly AuditPassResult[],
  options: ArbiterOptions = {},
): ArbiterDecision {
  const minimums = { ...REQUIRED_MINIMUMS, ...options.minimums };
  let approvalAt = -1;
  passes.forEach((pass, index) => {
    if (pass.pass === 'MANUAL' && pass.status === 'PASS' && pass.dimensions.factCheck === 'PASS')
      approvalAt = index;
  });
  const humanApproved = approvalAt >= 0;

  const merged = new Map<Dimension, DimensionStatus>();
  const codes = new Set<string>();
  const hard = new Set<string>();
  const review = new Set<string>();
  const scoreLists = new Map<ScoreKey, number[]>();
  let rewrite: string | null = null;
  let reviewVerdict = false;

  passes.forEach((pass, index) => {
    if (pass.pass === 'ARBITER') return;
    const waived =
      humanApproved && index < approvalAt && pass.pass !== 'MANUAL' && pass.pass !== 'HEURISTIC';
    for (const dimension of DIMENSIONS) {
      let status = pass.dimensions[dimension];
      if (status === undefined) continue;
      if (waived && status === 'REVIEW') status = 'PASS';
      if (ORDER[status] > ORDER[merged.get(dimension) ?? 'NOT_RUN']) merged.set(dimension, status);
    }
    for (const code of pass.reasonCodes) codes.add(code);
    for (const reason of pass.hardRejectReasons) hard.add(reason);
    if (pass.status === 'REJECT' && pass.hardRejectReasons.length === 0)
      hard.add(`REJECTED_BY:${pass.provider}`);
    if (!waived) {
      for (const reason of pass.reviewReasons) review.add(reason);
      if (pass.status === 'REVIEW') reviewVerdict = true;
    }
    if (pass.suggestedRewrite) rewrite = pass.suggestedRewrite;
    for (const key of SCORE_KEYS) {
      const value = pass.scores[key];
      if (value === undefined) continue;
      const list = scoreLists.get(key) ?? [];
      list.push(value);
      scoreLists.set(key, list);
    }
  });

  const dimensions = Object.fromEntries(
    DIMENSIONS.map((dimension) => [dimension, merged.get(dimension) ?? 'NOT_RUN']),
  ) as Record<Dimension, DimensionStatus>;
  const scores: Scores = {};
  for (const [key, list] of scoreLists) scores[key] = Math.min(...list);
  for (const key of ZERO_MEANS_REJECT) if (scores[key] === 0) hard.add(`SCORE_ZERO:${key}`);

  const reasons = new Set<string>(codes);
  let status: AuditStatus;
  if (hard.size > 0 || DIMENSIONS.some((dimension) => dimensions[dimension] === 'FAIL')) {
    status = 'REJECT';
  } else {
    const blockers = new Set<string>(review);
    if (dimensions.factCheck !== 'PASS')
      blockers.add(dimensions.factCheck === 'NOT_RUN' ? 'FACT_CHECK_NOT_RUN' : 'FACT_CHECK_REVIEW');
    const dimensionReview = DIMENSIONS.filter(
      (dimension) => dimension !== 'factCheck' && dimensions[dimension] === 'REVIEW',
    );
    // A REVIEW verdict that names no reason (an imported "REVIEW" row) still blocks.
    if ((reviewVerdict || dimensionReview.length > 0) && blockers.size === 0)
      blockers.add('REVIEWER_VERDICT');
    if (!humanApproved) {
      const missing = Object.keys(minimums).some((key) => scores[key as ScoreKey] === undefined);
      if (missing) blockers.add('SCORES_MISSING');
      for (const [key, minimum] of Object.entries(minimums)) {
        const value = scores[key as ScoreKey];
        if (value !== undefined && value < minimum) blockers.add(`SCORE_BELOW_MINIMUM:${key}`);
      }
    }
    for (const blocker of blockers) reasons.add(blocker);
    status = blockers.size === 0 ? 'PASS' : 'REVIEW';
  }

  return {
    status,
    dimensions,
    scores: scoreLists.size > 0 ? scores : null,
    reasonCodes: [...reasons],
    hardRejectReasons: [...hard],
    reviewReasons: [...review],
    suggestedRewrite: rewrite,
    humanApproved,
  };
}
