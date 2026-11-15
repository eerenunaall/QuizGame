import { duplicateFindings } from './duplicates';
import { finding, statusOf, type Finding, type HeuristicStatus } from './findings';
import {
  resolveConfig,
  runHeuristics,
  type AuditSubject,
  type HeuristicConfig,
} from './heuristics';
import { buildEntry, type MemorySimilarityIndex, type SimilarityEntry } from './similarity';
import { chiSquareSurvival, chiSquareUniform } from './stats';
import { foldKey, tokenize } from './text';
import { STANDARD_OPTIONS } from './enums';

/** Rules that only make sense across a whole batch (rubric §4 "repeating the same opening syntax"). */
export interface BatchRules {
  openerMinBatch: number;
  openerMaxShare: number;
  openerWords: number;
  templateMinBatch: number;
  templateMinQuota: number;
  templateMaxShare: number;
  positionMinBatch: number;
  positionAlpha: number;
  longestMinBatch: number;
  longestZ: number;
}

export const DEFAULT_BATCH_RULES: BatchRules = {
  openerMinBatch: 20,
  openerMaxShare: 0.2,
  openerWords: 2,
  templateMinBatch: 20,
  templateMinQuota: 3,
  templateMaxShare: 0.02,
  positionMinBatch: 40,
  positionAlpha: 0.01,
  longestMinBatch: 40,
  longestZ: 3,
};

export interface BatchItem {
  /** Caller's handle (external id, line number or database id). */
  key: string;
  subject: AuditSubject;
  /** Stored fingerprints when the question comes from the database. */
  entry?: SimilarityEntry;
}

export interface BatchOptions {
  now: Date;
  sourceRequired: (category: string) => boolean;
  config?: Partial<HeuristicConfig>;
  rules?: Partial<BatchRules>;
  /** Duplicate index; each item is checked against it and then added, so later copies are caught. */
  index?: MemorySimilarityIndex;
}

export interface BatchFinding {
  code: 'CORRECT_POSITION_SKEW' | 'CORRECT_LONGEST_BIAS';
  detail: Record<string, number | string>;
}

export interface BatchAudit {
  items: { key: string; findings: Finding[] }[];
  batchFindings: BatchFinding[];
  /** How often the correct answer sat at positions 0..3 among four-option questions. */
  positions: number[];
  positionPValue: number | null;
}

function openerKey(subject: AuditSubject, words: number): string {
  return tokenize(foldKey(subject.text, subject.language)).slice(0, words).join(' ');
}

/** The stem with names and numbers masked: two questions with one template share this key. */
function templateKey(subject: AuditSubject): string {
  const masked = subject.text
    .replace(/\d+/gu, 'dd')
    .split(/\s+/u)
    .map((word) => (/^\p{Lu}/u.test(word) ? 'nn' : word))
    .join(' ');
  return foldKey(masked, subject.language);
}

export function auditBatch(items: readonly BatchItem[], options: BatchOptions): BatchAudit {
  const config = resolveConfig(options.config);
  const rules = { ...DEFAULT_BATCH_RULES, ...options.rules };
  const results = items.map((item) => ({
    key: item.key,
    findings: runHeuristics(item.subject, {
      now: options.now,
      sourceRequired: options.sourceRequired(item.subject.category),
      config,
    }),
  }));

  if (options.index) {
    const index = options.index;
    items.forEach((item, position) => {
      const correct = item.subject.options.find((option) => option.correct)?.text ?? '';
      const entry =
        item.entry ??
        buildEntry({
          id: item.key,
          language: item.subject.language,
          stem: item.subject.text,
          correctAnswer: correct,
        });
      results[position]!.findings.push(...duplicateFindings(entry, index, config.duplicate));
      index.add(entry);
    });
  }

  const n = items.length;
  // Openers and templates: flag only the copies beyond the quota, in input order.
  if (n >= rules.openerMinBatch) {
    const quota = Math.floor(rules.openerMaxShare * n);
    const seen = new Map<string, number>();
    items.forEach((item, position) => {
      const key = openerKey(item.subject, rules.openerWords);
      if (key === '') return;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count > quota)
        results[position]!.findings.push(finding('REPEATED_OPENER', { opener: key }));
    });
  }
  if (n >= rules.templateMinBatch) {
    const quota = Math.max(rules.templateMinQuota, Math.ceil(rules.templateMaxShare * n));
    const seen = new Map<string, number>();
    items.forEach((item, position) => {
      const key = templateKey(item.subject);
      if (tokenize(key).length < 4) return;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count > quota) results[position]!.findings.push(finding('TEMPLATE_REPEAT'));
    });
  }

  const batchFindings: BatchFinding[] = [];
  const positions = new Array<number>(STANDARD_OPTIONS).fill(0);
  for (const item of items) {
    if (item.subject.options.length !== STANDARD_OPTIONS) continue;
    const at = item.subject.options.findIndex((option) => option.correct);
    if (at >= 0) positions[at] = (positions[at] ?? 0) + 1;
  }
  const counted = positions.reduce((sum, value) => sum + value, 0);
  let positionPValue: number | null = null;
  if (counted >= rules.positionMinBatch) {
    const { statistic, df } = chiSquareUniform(positions);
    positionPValue = chiSquareSurvival(statistic, df);
    if (positionPValue < rules.positionAlpha)
      batchFindings.push({
        code: 'CORRECT_POSITION_SKEW',
        detail: {
          counts: positions.join('/'),
          chiSquare: Math.round(statistic * 100) / 100,
          p: Math.round(positionPValue * 10_000) / 10_000,
        },
      });
  }

  let eligible = 0;
  let longest = 0;
  let expected = 0;
  for (const item of items) {
    const options = item.subject.options;
    if (options.length < 3 || options.filter((option) => option.correct).length !== 1) continue;
    const lengths = options.map((option) => [...option.text].length);
    const top = Math.max(...lengths);
    if (lengths.filter((value) => value === top).length !== 1) continue;
    eligible++;
    expected += 1 / options.length;
    if (options.find((option) => option.correct) === options[lengths.indexOf(top)]) longest++;
  }
  if (eligible >= rules.longestMinBatch) {
    const p = expected / eligible;
    const z = (longest - expected) / Math.sqrt(eligible * p * (1 - p));
    if (z >= rules.longestZ)
      batchFindings.push({
        code: 'CORRECT_LONGEST_BIAS',
        detail: { longest, eligible, z: Math.round(z * 100) / 100 },
      });
  }

  return { items: results, batchFindings, positions, positionPValue };
}

// ───────────────────────── summaries ─────────────────────────

export interface ItemOutcome {
  key: string;
  status: HeuristicStatus;
  reasons: readonly string[];
  category?: string;
}

export interface BatchSummary {
  total: number;
  pass: number;
  review: number;
  reject: number;
  /** How many questions carry each reason code. */
  reasons: Record<string, number>;
  byCategory: Record<string, { pass: number; review: number; reject: number }>;
}

export function summarize(outcomes: readonly ItemOutcome[]): BatchSummary {
  const summary: BatchSummary = {
    total: outcomes.length,
    pass: 0,
    review: 0,
    reject: 0,
    reasons: {},
    byCategory: {},
  };
  for (const outcome of outcomes) {
    if (outcome.status === 'PASS') summary.pass++;
    else if (outcome.status === 'REVIEW') summary.review++;
    else summary.reject++;
    for (const reason of new Set(outcome.reasons))
      summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
    if (outcome.category) {
      const bucket = (summary.byCategory[outcome.category] ??= { pass: 0, review: 0, reject: 0 });
      if (outcome.status === 'PASS') bucket.pass++;
      else if (outcome.status === 'REVIEW') bucket.review++;
      else bucket.reject++;
    }
  }
  return summary;
}

export function summarizeFindings(
  results: readonly { key: string; findings: readonly Finding[]; category?: string }[],
): BatchSummary {
  return summarize(
    results.map((result) => ({
      key: result.key,
      status: statusOf(result.findings),
      reasons: result.findings.filter((item) => item.severity !== 'INFO').map((item) => item.code),
      ...(result.category ? { category: result.category } : {}),
    })),
  );
}

/** "500 → 420 PASS / 58 REVIEW / 22 REJECT" (GDD §27). */
export function formatSummary(
  summary: Pick<BatchSummary, 'total' | 'pass' | 'review' | 'reject'>,
): string {
  return `${summary.total} → ${summary.pass} PASS / ${summary.review} REVIEW / ${summary.reject} REJECT`;
}
