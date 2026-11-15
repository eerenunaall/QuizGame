import {
  DIMENSIONS,
  REASONS,
  type Dimension,
  type DimensionStatus,
  type ReasonCode,
  type Severity,
} from './reasons';

/** One thing an automatic check noticed about a question. */
export interface Finding {
  code: ReasonCode;
  severity: Severity;
  dimension: Dimension;
  /** Small, serialisable facts that explain the finding to an editor (never question text). */
  detail?: Record<string, string | number | boolean>;
}

export function finding(code: ReasonCode, detail?: Finding['detail']): Finding {
  const info = REASONS[code];
  return {
    code,
    severity: info.severity,
    dimension: info.dimension,
    ...(detail ? { detail } : {}),
  };
}

export type HeuristicStatus = 'PASS' | 'REVIEW' | 'REJECT';

/** REJECT beats REVIEW beats PASS; INFO findings never change the status. */
export function statusOf(findings: readonly Finding[]): HeuristicStatus {
  if (findings.some((item) => item.severity === 'REJECT')) return 'REJECT';
  if (findings.some((item) => item.severity === 'REVIEW')) return 'REVIEW';
  return 'PASS';
}

/**
 * Dimension statuses for a pass that examined `ran` (the others stay NOT_RUN). A dimension that was
 * examined and produced no finding is PASS; a REJECT finding makes it FAIL.
 */
export function dimensionStatuses(
  findings: readonly Finding[],
  ran: readonly Dimension[],
): Record<Dimension, DimensionStatus> {
  const out = Object.fromEntries(DIMENSIONS.map((name) => [name, 'NOT_RUN'])) as Record<
    Dimension,
    DimensionStatus
  >;
  for (const name of ran) out[name] = 'PASS';
  for (const item of findings) {
    if (item.severity === 'INFO') continue;
    const current = out[item.dimension];
    if (item.severity === 'REJECT') out[item.dimension] = 'FAIL';
    else if (current !== 'FAIL') out[item.dimension] = 'REVIEW';
  }
  return out;
}
