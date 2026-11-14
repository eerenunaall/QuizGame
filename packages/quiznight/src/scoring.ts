import { buildSteps, stepIndex } from './steps';
import type { FinalWager, QState, QuestionDef, QuizConfig } from './types';
import { FINAL_QUESTION_ID, TIE_QUESTION_ID } from './types';

/** Settings added after the first release, with their defaults (nights saved earlier lack them). */
export function rules(config: QuizConfig): {
  jokerFromRound: number;
  nameBonus: number;
  consolationText: string;
  estimateTop3: boolean;
  wagerCap: number;
  finalWager: FinalWager | null;
} {
  const s = config.settings;
  return {
    jokerFromRound: s.jokerFromRound ?? 1,
    nameBonus: s.nameBonus ?? 0,
    consolationText: s.consolationText ?? '',
    estimateTop3: s.estimateTop3 ?? false,
    wagerCap: s.wagerCap ?? 10,
    finalWager: config.finalWager ?? null,
  };
}

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

/** A question of round `r` (0-based) may be doubled: allowed on the card and the round is not before `jokerFromRound`. */
export function jokerEligibleIn(config: QuizConfig, r: number, q: QuestionDef): boolean {
  return jokerEligible(q) && r + 1 >= rules(config).jokerFromRound;
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

export interface EstimatePlace {
  place: number;
  teamIds: string[];
  points: number;
}

/**
 * Who earns what on an estimate question. Competition ranking by distance (equal distance shares a place and
 * the next place is skipped). Without `estimateTop3` only the closest team scores; with it the first three
 * places pay the question's points, 60 % and 20 % (rounded down, so 5 -> 5/3/1).
 */
export function estimatePlaces(state: QState, q: QuestionDef): EstimatePlace[] {
  if (q.answer.type !== 'NUMBER') return [];
  const target = q.answer.value;
  const values = Object.entries(state.estimates[q.id] ?? {}).map(
    ([teamId, v]) => [teamId, Math.abs(v - target)] as const,
  );
  if (values.length === 0) return [];
  const tiers = rules(state.config).estimateTop3
    ? [q.points, Math.floor(q.points * 0.6), Math.floor(q.points * 0.2)]
    : [q.points];
  const distances = [...new Set(values.map(([, d]) => d))].sort((a, b) => a - b);
  const out: EstimatePlace[] = [];
  let taken = 0;
  for (const d of distances) {
    const teamIds = values.filter(([, x]) => x === d).map(([t]) => t);
    const place = taken + 1;
    taken += teamIds.length;
    const points = tiers[place - 1] ?? 0;
    if (points > 0) out.push({ place, teamIds, points });
  }
  return out;
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
  /** For estimate questions: who was closest (place 1) and, with the top-3 setting, who else scored. */
  estimateWinners: {
    questionId: string;
    number: number;
    teamIds: string[];
    places: EstimatePlace[];
  }[];
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
      const places = estimatePlaces(state, q);
      const first = places[0]?.place === 1 ? places[0].teamIds : [];
      if (places.length) winners.push({ questionId: q.id, number: i + 1, teamIds: first, places });
      for (const p of places) for (const t of p.teamIds) if (t in points) points[t]! += p.points;
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
  // The team-name bonus is announced at the start of the night, so it rides on round 1 and every
  // later total (and the "this round" column) already includes it.
  if (r === 0) {
    const bonus = rules(config).nameBonus;
    for (const t of state.bonusTeams) if (t in points) points[t]! += bonus;
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

function totalsFor(state: QState, rounds: number, withFinal: boolean): Map<string, number> {
  const totals = new Map(state.config.teams.map((t) => [t.id, 0]));
  for (let r = 0; r < rounds; r++) {
    const res = roundResult(state, r, true);
    for (const [t, p] of Object.entries(res.points)) totals.set(t, (totals.get(t) ?? 0) + p);
  }
  if (withFinal && rounds === state.config.rounds.length) {
    for (const f of finalResults(state))
      totals.set(f.teamId, (totals.get(f.teamId) ?? 0) + f.delta);
  }
  return totals;
}

/** Points a team holds after every round, before the final wager: the stake can never exceed them. */
export function pointsBeforeFinal(state: QState, teamId: string): number {
  return totalsFor(state, state.config.rounds.length, false).get(teamId) ?? 0;
}

/** Largest stake a team may write down: the cap, or what it holds if that is less, never below 0. */
export function wagerMax(state: QState, teamId: string): number {
  return Math.max(0, Math.min(rules(state.config).wagerCap, pointsBeforeFinal(state, teamId)));
}

export interface FinalResult {
  teamId: string;
  /** The stake that counts (a written stake above the limit is cut down; no stake means 0). */
  wager: number;
  /** null until the host has marked the team's answer: an unmarked team neither wins nor loses. */
  right: boolean | null;
  delta: number;
}

/** Right wins the stake, wrong loses it (Final-Jeopardy rule, research notes). Empty without a final round. */
export function finalResults(state: QState): FinalResult[] {
  if (!rules(state.config).finalWager) return [];
  return state.config.teams.map((t) => {
    const wager = Math.min(state.wagers[t.id] ?? 0, wagerMax(state, t.id));
    const right = state.marks[FINAL_QUESTION_ID]?.[t.id] ?? null;
    return { teamId: t.id, wager, right, delta: right === null ? 0 : right ? wager : -wager };
  });
}

/** Competition ranking (1,1,3). With `withTie` the closest-number tie-break orders the teams tied for first. */
export function ranksFor(
  state: QState,
  rounds: number,
  withTie: boolean,
  withFinal = true,
): Map<string, number> {
  const totals = totalsFor(state, rounds, withFinal);
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
  opts: { withTie: boolean; lockedJokersOnly: boolean; withFinal?: boolean },
): StandingRow[] {
  const { config } = state;
  const withFinal = opts.withFinal ?? true;
  const totals = totalsFor(state, rounds, withFinal);
  const ranks = ranksFor(state, rounds, opts.withTie, withFinal);
  const prevRanks = rounds > 1 ? ranksFor(state, rounds - 1, false, false) : null;
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
