import {
  countModeAvailable,
  estimateWinners,
  finalResults,
  isEstimate,
  jokerEligibleIn,
  plainQuestions,
  ranksFor,
  roundResult,
  rotation,
  rules,
  scoredRounds,
  standings,
  wagerMax,
  type EstimatePlace,
  type StandingRow,
} from './scoring';
import { peekNext } from './machine';
import { buildSteps, stepIndex } from './steps';
import type { Answer, QState, QuestionDef, RoundKind, Step, TeamDef, Timer } from './types';
import { TIE_QUESTION_ID } from './types';

export const TV_VIEW_VERSION = 1;

export function timerRemainingMs(t: Timer | null, now: number): number | null {
  if (!t) return null;
  const ref = t.pausedAt ?? now;
  return Math.max(0, t.seconds * 1000 - (ref - t.startedAt - t.pausedMs));
}

// ---- TV view: an allow-list. Nothing here is copied wholesale from state. ----------------------------

export interface TvQuestion {
  number: number;
  total: number;
  text: string;
  options: string[] | null;
  imageUrl: string | null;
  points: number;
  kind: RoundKind;
  trueFalse: boolean;
  estimate: boolean;
}
export type TvAnswer =
  | { type: 'TEXT'; text: string }
  | { type: 'OPTION'; index: number; text: string }
  | { type: 'NUMBER'; value: number; unit: string | null }
  | { type: 'BOOL'; value: boolean };

export interface TvTeam {
  id: string;
  name: string;
  badge: { color: string; emoji: string };
  table: number;
}
export interface TvRow {
  teamId: string;
  total: number;
  rank: number;
  rankChange: number | null;
  jokersLeft: number;
}

export interface TvView {
  v: typeof TV_VIEW_VERSION;
  title: string;
  step: Step['kind'] | 'WAITING';
  paused: boolean;
  overlay: 'STANDINGS' | null;
  entranceText: string;
  prizeText: string;
  /** The joker allowance is a public rule of the night (it is on the how-to slide). */
  jokersPerTeam: number;
  round: { index: number; count: number; kind: RoundKind; title: string; questions: number } | null;
  question: TvQuestion | null;
  /** Teams that played 2x on THIS question; only filled once the question is on screen. */
  doubled: string[];
  answer: TvAnswer | null;
  /** Present only on reveal slides (the payload scanner forbids the key before the reveal, ADR-0008). */
  explanation?: string;
  timer: { seconds: number; remainingMs: number; running: boolean } | null;
  rotation: { teamId: string; markerTeamId: string }[];
  roundScores: {
    rows: { teamId: string; points: number; total: number; rank: number }[];
    jokers: { teamId: string; number: number; gain: number }[];
    /** Closest team(s) per estimate question; `places` lists the other scoring places with the top-3 setting. */
    estimateWinners: { number: number; teamIds: string[]; places: EstimatePlace[] }[];
  } | null;
  /** The final wager round: category and limits on the intro, stakes and results only on the reveal. */
  final: {
    category: string;
    limits: { teamId: string; max: number }[];
    /** Last place first, so the slide can build up to the winner. */
    reveal: {
      teamId: string;
      wager: number;
      right: boolean | null;
      delta: number;
      total: number;
      rank: number;
    }[];
  } | null;
  /** Podium only: the last-placed team(s) and what they get. */
  consolation: { teamIds: string[]; text: string } | null;
  standings: TvRow[] | null;
  tie: { values: { teamId: string; value: number }[] } | null;
  podium: { teamId: string; rank: number; total: number }[] | null;
  teams: TvTeam[];
}

const tvTeam = (t: TeamDef): TvTeam => ({
  id: t.id,
  name: t.name,
  badge: { ...t.badge },
  table: t.table,
});

function tvQuestion(state: QState, r: number, q: number): TvQuestion {
  const round = state.config.rounds[r]!;
  const def = round.questions[q]!;
  return {
    number: q + 1,
    total: round.questions.length,
    text: def.text,
    options: def.options ? [...def.options] : null,
    imageUrl: def.imageUrl ?? null,
    points: def.points,
    kind: round.kind,
    trueFalse: round.kind === 'TRUE_FALSE' || def.answer.type === 'BOOL',
    estimate: isEstimate(def),
  };
}

function tvFinalQuestion(def: QuestionDef): TvQuestion {
  return {
    number: 1,
    total: 1,
    text: def.text,
    options: def.options ? [...def.options] : null,
    imageUrl: def.imageUrl ?? null,
    points: 0,
    kind: 'NORMAL',
    trueFalse: def.answer.type === 'BOOL',
    estimate: false,
  };
}

function tvAnswer(def: QuestionDef): TvAnswer {
  const a: Answer = def.answer;
  switch (a.type) {
    case 'TEXT':
      return { type: 'TEXT', text: a.text };
    case 'OPTION':
      return { type: 'OPTION', index: a.index, text: def.options?.[a.index] ?? '' };
    case 'NUMBER':
      return { type: 'NUMBER', value: a.value, unit: a.unit ?? null };
    case 'BOOL':
      return { type: 'BOOL', value: a.value };
  }
}

/** The last place gets the consolation prize; with fewer than three teams or everybody tied there is no "last". */
function consolationOf(
  rows: StandingRow[],
  text: string,
): { teamIds: string[]; text: string } | null {
  const trimmed = text.trim();
  if (!trimmed || rows.length < 3) return null;
  const worst = Math.max(...rows.map((r) => r.rank));
  if (worst === 1) return null;
  return { teamIds: rows.filter((r) => r.rank === worst).map((r) => r.teamId), text: trimmed };
}

const toTvRow = (r: StandingRow): TvRow => ({
  teamId: r.teamId,
  total: r.total,
  rank: r.rank,
  rankChange: r.rankChange,
  jokersLeft: r.jokersLeft,
});

/**
 * What the TV may see right now. The answer exists only on ANSWER/TIE_ANSWER/PODIUM-era slides; per-team
 * marks, counts, estimates (except the tied teams' tie-break guesses once revealed) never leave the server.
 */
export function tvView(state: QState, now: number): TvView {
  const { config } = state;
  const steps = buildSteps(config);
  const step = steps[state.cursor];
  const base: TvView = {
    v: TV_VIEW_VERSION,
    title: config.title,
    step: step ? step.kind : 'WAITING',
    paused: state.paused,
    overlay: state.overlay,
    entranceText: config.settings.entranceText,
    prizeText: config.settings.prizeText,
    jokersPerTeam: config.settings.jokersPerTeam,
    round: null,
    question: null,
    doubled: [],
    answer: null,
    timer: null,
    rotation: [],
    roundScores: null,
    final: null,
    consolation: null,
    standings: null,
    tie: null,
    podium: null,
    teams: config.teams.map(tvTeam),
  };
  if (!step) return base;
  if (step.round !== undefined) {
    const round = config.rounds[step.round]!;
    base.round = {
      index: step.round,
      count: config.rounds.length,
      kind: round.kind,
      title: round.title,
      questions: round.questions.length,
    };
  }
  const visibleRounds = scoredRounds(state, true);
  const finalDef = rules(config).finalWager;
  // The final's points join the totals only once the reveal slide is on screen.
  const finalShown = !finalDef || state.cursor >= stepIndex(steps, 'FINAL_REVEAL');
  const standingsRows = (rounds: number, withTie: boolean): TvRow[] =>
    standings(state, rounds, { withTie, lockedJokersOnly: true, withFinal: finalShown }).map(
      toTvRow,
    );

  switch (step.kind) {
    case 'QUESTION': {
      base.question = tvQuestion(state, step.round!, step.q!);
      const def = config.rounds[step.round!]!.questions[step.q!]!;
      base.doubled = [...(state.jokers[def.id] ?? [])];
      const t = state.timer;
      if (t)
        base.timer = {
          seconds: t.seconds,
          remainingMs: timerRemainingMs(t, now) ?? 0,
          running: t.pausedAt === null,
        };
      break;
    }
    case 'ANSWER': {
      const def = config.rounds[step.round!]!.questions[step.q!]!;
      base.question = tvQuestion(state, step.round!, step.q!);
      base.answer = tvAnswer(def);
      if (def.explanation) base.explanation = def.explanation;
      break;
    }
    case 'SWAP':
      base.rotation = rotation(state);
      break;
    case 'ROUND_SCORES': {
      const r = step.round!;
      const res = roundResult(state, r, true);
      const rows = standings(state, r + 1, {
        withTie: false,
        lockedJokersOnly: true,
        withFinal: finalShown,
      });
      base.roundScores = {
        rows: rows.map((x) => ({
          teamId: x.teamId,
          points: res.points[x.teamId] ?? 0,
          total: x.total,
          rank: x.rank,
        })),
        jokers: res.jokerDeltas.map((j) => ({
          teamId: j.teamId,
          number: j.number,
          gain: j.delta,
        })),
        estimateWinners: res.estimateWinners.map((w) => ({
          number: w.number,
          teamIds: w.teamIds,
          places: w.places.map((p) => ({ ...p, teamIds: [...p.teamIds] })),
        })),
      };
      break;
    }
    case 'STANDINGS':
    case 'HALF_TIME':
      base.standings = standingsRows(step.round! + 1, false);
      break;
    case 'FINAL_INTRO': {
      base.final = {
        category: finalDef!.category,
        limits: config.teams.map((t) => ({ teamId: t.id, max: wagerMax(state, t.id) })),
        reveal: [],
      };
      base.standings = standingsRows(config.rounds.length, false);
      break;
    }
    case 'FINAL_QUESTION': {
      base.final = { category: finalDef!.category, limits: [], reveal: [] };
      base.question = tvFinalQuestion(finalDef!.question);
      const t = state.timer;
      if (t)
        base.timer = {
          seconds: t.seconds,
          remainingMs: timerRemainingMs(t, now) ?? 0,
          running: t.pausedAt === null,
        };
      break;
    }
    case 'FINAL_ANSWER': {
      base.final = { category: finalDef!.category, limits: [], reveal: [] };
      base.question = tvFinalQuestion(finalDef!.question);
      base.answer = tvAnswer(finalDef!.question);
      if (finalDef!.question.explanation) base.explanation = finalDef!.question.explanation;
      break;
    }
    case 'FINAL_REVEAL': {
      const rows = standings(state, config.rounds.length, {
        withTie: false,
        lockedJokersOnly: true,
        withFinal: true,
      });
      const results = new Map(finalResults(state).map((f) => [f.teamId, f]));
      base.final = {
        category: finalDef!.category,
        limits: [],
        reveal: [...rows].reverse().map((x) => {
          const f = results.get(x.teamId);
          return {
            teamId: x.teamId,
            wager: f?.wager ?? 0,
            right: f?.right ?? null,
            delta: f?.delta ?? 0,
            total: x.total,
            rank: x.rank,
          };
        }),
      };
      base.standings = rows.map(toTvRow);
      break;
    }
    case 'TIE_QUESTION': {
      const tb = config.tieBreak!;
      base.question = {
        number: 1,
        total: 1,
        text: tb.text,
        options: null,
        imageUrl: tb.imageUrl ?? null,
        points: 0,
        kind: 'ESTIMATE',
        trueFalse: false,
        estimate: true,
      };
      break;
    }
    case 'TIE_ANSWER': {
      const tb = config.tieBreak!;
      base.answer = tvAnswer(tb);
      if (tb.explanation) base.explanation = tb.explanation;
      const top = [...ranksFor(state, config.rounds.length, false)]
        .filter(([, rk]) => rk === 1)
        .map(([t]) => t);
      base.tie = {
        values: top.flatMap((t) => {
          const v = state.estimates[TIE_QUESTION_ID]?.[t];
          return v === undefined ? [] : [{ teamId: t, value: v }];
        }),
      };
      break;
    }
    case 'PODIUM': {
      const rows = standings(state, config.rounds.length, {
        withTie: true,
        lockedJokersOnly: true,
      });
      base.podium = rows
        .filter((x) => x.rank <= 3)
        .map((x) => ({ teamId: x.teamId, rank: x.rank, total: x.total }));
      base.standings = rows.map(toTvRow);
      base.consolation = consolationOf(rows, rules(config).consolationText);
      break;
    }
    case 'INTRO':
    case 'HOWTO':
    case 'ROUND_TITLE':
    case 'LOCKED':
    case 'MARKING':
      break;
  }
  if (state.overlay === 'STANDINGS' && visibleRounds > 0)
    base.standings = standingsRows(visibleRounds, false);
  return base;
}

// ---- Host (tablet) view: everything the quiz master needs, including answers. -----------------------

export interface HostQuestion {
  id: string;
  number: number;
  text: string;
  points: number;
  estimate: boolean;
  jokerEligible: boolean;
  answerText: string;
  explanation: string | null;
  doubled: string[];
  marks: Record<string, boolean | null>;
  estimates: Record<string, number>;
  /** True once the question has been on the TV (jokers locked). */
  locked: boolean;
}
export interface HostRound {
  id: string;
  index: number;
  title: string;
  kind: RoundKind;
  mode: 'GRID' | 'COUNT';
  countAvailable: boolean;
  plainCount: number;
  counts: Record<string, number | null>;
  questions: HostQuestion[];
  scored: boolean;
  result: {
    points: Record<string, number>;
    jokers: { teamId: string; number: number; delta: number }[];
  } | null;
}

export interface HostView {
  started: boolean;
  closed: boolean;
  podiumReached: boolean;
  cursor: number;
  stepCount: number;
  step: Step | null;
  nextStep: Step | null;
  paused: boolean;
  overlay: 'STANDINGS' | null;
  timerSeconds: number;
  timer: { seconds: number; remainingMs: number; running: boolean } | null;
  seq: number;
  teams: (TvTeam & { jokersLeft: number })[];
  rounds: HostRound[];
  /** The next question that has not been shown yet: where the "Çift puan" team picker applies. */
  nextQuestion: {
    roundIndex: number;
    questionId: string;
    number: number;
    text: string;
    doubled: string[];
    eligible: boolean;
  } | null;
  rotation: { teamId: string; markerTeamId: string }[];
  standings: StandingRow[];
  tie: { needed: boolean; text: string; answerText: string; values: Record<string, number> } | null;
  /** The final wager round with what the host enters: stakes before the question, marks after the answer. */
  final: {
    category: string;
    questionText: string;
    answerText: string;
    explanation: string | null;
    /** Stakes may be entered (final intro reached) and are locked once the question is on the TV. */
    wagersOpen: boolean;
    wagersLocked: boolean;
    marksOpen: boolean;
    cap: number;
    teams: {
      teamId: string;
      max: number;
      wager: number | null;
      right: boolean | null;
      delta: number;
    }[];
  } | null;
  nameBonus: { points: number; teamIds: string[] } | null;
  consolation: { teamIds: string[]; text: string } | null;
  winnerTeamIds: string[];
}

const answerText = (q: QuestionDef): string => {
  const a = q.answer;
  if (a.type === 'TEXT') return a.text;
  if (a.type === 'OPTION') return q.options?.[a.index] ?? '';
  if (a.type === 'NUMBER') return `${a.value}${a.unit ? ` ${a.unit}` : ''}`;
  return a.value ? 'true' : 'false';
};

export function hostView(state: QState, now: number): HostView {
  const { config } = state;
  const steps = buildSteps(config);
  const rounds: HostRound[] = config.rounds.map((round, r) => {
    const scored = state.reached >= stepIndex(steps, 'ROUND_SCORES', r);
    const res = roundResult(state, r, scored);
    return {
      id: round.id,
      index: r,
      title: round.title,
      kind: round.kind,
      mode: state.modes[round.id] === 'COUNT' && countModeAvailable(state, r) ? 'COUNT' : 'GRID',
      countAvailable: countModeAvailable(state, r),
      plainCount: plainQuestions(state, r).length,
      counts: Object.fromEntries(
        config.teams.map((t) => [t.id, state.counts[round.id]?.[t.id] ?? null]),
      ),
      scored,
      result: {
        points: res.points,
        jokers: res.jokerDeltas.map((j) => ({
          teamId: j.teamId,
          number: j.number,
          delta: j.delta,
        })),
      },
      questions: round.questions.map((q, i) => ({
        id: q.id,
        number: i + 1,
        text: q.text,
        points: q.points,
        estimate: isEstimate(q),
        jokerEligible: jokerEligibleIn(config, r, q),
        answerText: answerText(q),
        explanation: q.explanation ?? null,
        doubled: [...(state.jokers[q.id] ?? [])],
        marks: Object.fromEntries(
          config.teams.map((t) => [t.id, state.marks[q.id]?.[t.id] ?? null]),
        ),
        estimates: { ...(state.estimates[q.id] ?? {}) },
        locked: stepIndex(steps, 'QUESTION', r, i) <= state.reached,
      })),
    };
  });
  let nextQuestion: HostView['nextQuestion'] = null;
  outer: for (const round of rounds) {
    for (const q of round.questions) {
      if (!q.locked) {
        nextQuestion = {
          roundIndex: round.index,
          questionId: q.id,
          number: q.number,
          text: q.text,
          doubled: q.doubled,
          eligible: q.jokerEligible,
        };
        break outer;
      }
    }
  }
  const nRounds = config.rounds.length;
  const rows = standings(state, scoredRounds(state, false), {
    withTie: false,
    lockedJokersOnly: false,
  });
  const finalRows = standings(state, nRounds, { withTie: true, lockedJokersOnly: false });
  const tb = config.tieBreak;
  const t = state.timer;
  const jokersLeft = new Map(finalRows.map((x) => [x.teamId, x.jokersLeft]));
  const podiumReached = state.reached >= stepIndex(steps, 'PODIUM');
  const finalDef = rules(config).finalWager;
  const finalByTeam = new Map(finalResults(state).map((f) => [f.teamId, f]));
  const final: HostView['final'] = finalDef
    ? {
        category: finalDef.category,
        questionText: finalDef.question.text,
        answerText: answerText(finalDef.question),
        explanation: finalDef.question.explanation ?? null,
        wagersOpen: state.reached >= stepIndex(steps, 'FINAL_INTRO'),
        wagersLocked: state.reached >= stepIndex(steps, 'FINAL_QUESTION'),
        marksOpen: state.reached >= stepIndex(steps, 'FINAL_ANSWER'),
        cap: rules(config).wagerCap,
        teams: config.teams.map((tm) => {
          const f = finalByTeam.get(tm.id);
          return {
            teamId: tm.id,
            max: wagerMax(state, tm.id),
            wager: state.wagers[tm.id] ?? null,
            right: f?.right ?? null,
            delta: f?.delta ?? 0,
          };
        }),
      }
    : null;
  return {
    started: state.started,
    closed: state.closed,
    podiumReached,
    cursor: state.cursor,
    stepCount: steps.length,
    step: steps[state.cursor] ?? null,
    nextStep: state.started && !state.closed ? peekNext(state) : null,
    paused: state.paused,
    overlay: state.overlay,
    timerSeconds: config.settings.timerSec,
    timer: t
      ? {
          seconds: t.seconds,
          remainingMs: timerRemainingMs(t, now) ?? 0,
          running: t.pausedAt === null,
        }
      : null,
    seq: state.seq,
    teams: config.teams.map((x) => ({ ...tvTeam(x), jokersLeft: jokersLeft.get(x.id) ?? 0 })),
    rounds,
    nextQuestion,
    rotation: rotation(state),
    standings: rows,
    tie: tb
      ? {
          needed:
            ranksFor(state, nRounds, false).size > 0 &&
            [...ranksFor(state, nRounds, false).values()].filter((x) => x === 1).length > 1,
          text: tb.text,
          answerText: answerText(tb),
          values: { ...(state.estimates[TIE_QUESTION_ID] ?? {}) },
        }
      : null,
    final,
    nameBonus:
      rules(config).nameBonus > 0
        ? { points: rules(config).nameBonus, teamIds: [...state.bonusTeams] }
        : null,
    consolation: podiumReached ? consolationOf(finalRows, rules(config).consolationText) : null,
    winnerTeamIds: podiumReached ? finalRows.filter((x) => x.rank === 1).map((x) => x.teamId) : [],
  };
}

export { estimateWinners };
