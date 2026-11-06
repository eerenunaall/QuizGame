import { buildSteps, stepIndex } from './steps';
import type { QState, QuestionDef, QuizConfig } from './types';
import { TIE_QUESTION_ID } from './types';

/** A NUMBER answer means "closest wins"; such a question never takes a joker (ADR-0029 amended). */
export const isEstimate = (q: QuestionDef): boolean => q.answer.type === 'NUMBER';

export function locate(
  config: QuizConfig,
  questionId: string,
): { r: number; q: number; question: QuestionDef } | null {
  for (let r = 0; r < config.rounds.length; r++) {
    const qs = config.rounds[r]!.questions;
    const q = qs.findIndex((x) => x.id === questionId);
    if (q >= 0) return { r, q, question: qs[q]! };
  }
  return null;
}

export function jokerEligible(q: QuestionDef): boolean {
  return q.jokerAllowed && !isEstimate(q) && q.id !== TIE_QUESTION_ID;
}

/** Teams whose number is closest to the answer; equal distance shares the win. */
export function estimateWinners(state: QState, q: QuestionDef): string[] {
  if (q.answer.type !== 'NUMBER') return [];
  const target = q.answer.value;
  const values = Object.entries(state.estimates[q.id] ?? {});
  if (values.length === 0) return [];
  const best = Math.min(...values.map(([, v]) => Math.abs(v - target)));
  return values.filter(([, v]) => Math.abs(v - target) === best).map(([t]) => t);
}

/** Questions that a per-team count can stand for: not estimate, not doubled by anyone. */
export function plainQuestions(state: QState, r: number): QuestionDef[] {
  const round = state.config.rounds[r]!;
  if (round.kind === 'BONUS' || round.kind === 'ESTIMATE') return [];
  return round.questions.filter((q) => !isEstimate(q) && (state.jokers[q.id] ?? []).length === 0);
}

export function countModeAvailable(state: QState, r: number): boolean {
  const plain = plainQuestions(state, r);
  return plain.length > 0 && plain.every((q) => q.points === plain[0]!.points);
}

export interface JokerDelta {
  teamId: string;
  questionId: string;
  /** 1-based number of the question inside the round, for the slide. */
  number: number;
  delta: number;
}
export interface RoundResult {
  points: Record<string, number>;
  jokerDeltas: JokerDelta[];
  /** For estimate questions: who was closest. */
  estimateWinners: { questionId: string; number: number; teamIds: string[] }[];
}

/**
 * Points every team earned in one round. A wrong doubled answer costs the question's points only when
 * the setting is on and the round is already scored (an unmarked cell is not yet "wrong").
 */
export function roundResult(state: QState, r: number, scored: boolean): RoundResult {
  const { config } = state;
  const round = config.rounds[r]!;
  const points: Record<string, number> = Object.fromEntries(config.teams.map((t) => [t.id, 0]));
  const jokerDeltas: JokerDelta[] = [];
  const winners: RoundResult['estimateWinners'] = [];
  const countMode = state.modes[round.id] === 'COUNT' && countModeAvailable(state, r);
  const plain = new Set(plainQuestions(state, r).map((q) => q.id));
  const plainPts = plainQuestions(state, r)[0]?.points ?? 0;

  round.questions.forEach((q, i) => {
    if (isEstimate(q)) {
      const w = estimateWinners(state, q);
      if (w.length) winners.push({ questionId: q.id, number: i + 1, teamIds: w });
      for (const t of w) if (t in points) points[t]! += q.points;
      return;
    }
    if (countMode && plain.has(q.id)) return;
    const doubled = new Set(state.jokers[q.id] ?? []);
    for (const team of config.teams) {
      const right = state.marks[q.id]?.[team.id] === true;
      const isJoker = doubled.has(team.id);
      let delta = 0;
      if (right) delta = q.points * (isJoker ? 2 : 1);
      else if (isJoker && scored && config.settings.wrongDoublePenalty) delta = -q.points;
      points[team.id]! += delta;
      if (isJoker)
        jokerDeltas.push({
          teamId: team.id,
          questionId: q.id,
          number: i + 1,
          delta: right ? q.points : delta,
        });
    }
  });
  if (countMode) {
    for (const team of config.teams) {
      const n = Math.min(state.counts[round.id]?.[team.id] ?? 0, plain.size);
      points[team.id]! += n * plainPts;
    }
  }
  return { points, jokerDeltas, estimateWinners: winners };
}

/** How many leading rounds have their round-scores slide reached (host) or visible right now (tv). */
export function scoredRounds(state: QState, tvCut: boolean): number {
  const steps = buildSteps(state.config);
  const limit = tvCut ? state.cursor : state.reached;
  let n = 0;
  for (let r = 0; r < state.config.rounds.length; r++) {
    if (stepIndex(steps, 'ROUND_SCORES', r) <= limit) n = r + 1;
    else break;
  }
  return n;
}

export interface StandingRow {
  teamId: string;
  total: number;
  rank: number;
  /** Places gained since the previous round (positive = up); null for the first round. */
  rankChange: number | null;
  roundPoints: number | null;
  jokersLeft: number;
}

function rankDescending<T extends { teamId: string }>(
  rows: T[],
  key: (r: T) => number,
): Map<string, number> {
  const sorted = [...rows].sort((a, b) => key(b) - key(a));
  const out = new Map<string, number>();
  sorted.forEach((row, i) => {
    const prev = sorted[i - 1];
    out.set(row.teamId, prev && key(prev) === key(row) ? out.get(prev.teamId)! : i + 1);
  });
  return out;
}

function totalsFor(state: QState, rounds: number): Map<string, number> {
  const totals = new Map(state.config.teams.map((t) => [t.id, 0]));
  for (let r = 0; r < rounds; r++) {
    const res = roundResult(state, r, true);
    for (const [t, p] of Object.entries(res.points)) totals.set(t, (totals.get(t) ?? 0) + p);
  }
  return totals;
}

/** Competition ranking (1,1,3). With `withTie` the closest-number tie-break orders the teams tied for first. */
export function ranksFor(state: QState, rounds: number, withTie: boolean): Map<string, number> {
  const totals = totalsFor(state, rounds);
  const rows = [...totals].map(([teamId, total]) => ({ teamId, total }));
  const ranks = rankDescending(rows, (r) => r.total);
  const tb = state.config.tieBreak;
  if (withTie && tb && tb.answer.type === 'NUMBER') {
    const top = rows.filter((r) => ranks.get(r.teamId) === 1);
    if (top.length > 1) {
      const target = tb.answer.value;
      const dist = (teamId: string): number => {
        const v = state.estimates[TIE_QUESTION_ID]?.[teamId];
        return v === undefined ? Infinity : Math.abs(v - target);
      };
      for (const t of top) {
        ranks.set(t.teamId, 1 + top.filter((o) => dist(o.teamId) < dist(t.teamId)).length);
      }
    }
  }
  return ranks;
}

export function tieNeeded(state: QState): boolean {
  if (!state.config.tieBreak) return false;
  const ranks = ranksFor(state, state.config.rounds.length, false);
  return [...ranks.values()].filter((x) => x === 1).length > 1;
}

/**
 * Standings after `rounds` rounds. `lockedJokersOnly` counts only jokers of questions already shown, so the
 * TV never reveals a pick the host noted for a question that is not on screen yet.
 */
export function standings(
  state: QState,
  rounds: number,
  opts: { withTie: boolean; lockedJokersOnly: boolean },
): StandingRow[] {
  const { config } = state;
  const totals = totalsFor(state, rounds);
  const ranks = ranksFor(state, rounds, opts.withTie);
  const prevRanks = rounds > 1 ? ranksFor(state, rounds - 1, false) : null;
  const last = rounds > 0 ? roundResult(state, rounds - 1, true) : null;
  const steps = buildSteps(config);
  const used = (teamId: string): number => {
    let n = 0;
    for (const [qid, teams] of Object.entries(state.jokers)) {
      if (!teams.includes(teamId)) continue;
      const loc = locate(config, qid);
      if (!loc) continue;
      if (opts.lockedJokersOnly && stepIndex(steps, 'QUESTION', loc.r, loc.q) > state.reached)
        continue;
      n++;
    }
    return n;
  };
  const rows: StandingRow[] = config.teams.map((t) => ({
    teamId: t.id,
    total: totals.get(t.id) ?? 0,
    rank: ranks.get(t.id) ?? config.teams.length,
    rankChange: prevRanks ? prevRanks.get(t.id)! - (ranks.get(t.id) ?? 0) : null,
    roundPoints: last ? (last.points[t.id] ?? 0) : null,
    jokersLeft: Math.max(0, config.settings.jokersPerTeam - used(t.id)),
  }));
  const table = new Map(config.teams.map((t) => [t.id, t.table]));
  return rows.sort((a, b) => a.rank - b.rank || table.get(a.teamId)! - table.get(b.teamId)!);
}

/** Paper rotation: every team's paper goes to the next table; the host may override a marker. */
export function rotation(state: QState): { teamId: string; markerTeamId: string }[] {
  const teams = [...state.config.teams].sort((a, b) => a.table - b.table);
  if (teams.length < 2) return [];
  return teams.map((t, i) => {
    const next = teams[(i + 1) % teams.length]!;
    return { teamId: t.id, markerTeamId: state.markers[t.id] ?? next.id };
  });
}
