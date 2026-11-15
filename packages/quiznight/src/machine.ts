import {
  countModeAvailable,
  isEstimate,
  jokerEligibleIn,
  locate,
  plainQuestions,
  rules,
  tieNeeded,
  wagerMax,
} from './scoring';
import { buildSteps, stepIndex } from './steps';
import type { Command, LogEvent, QError, QState, QuizConfig, Step } from './types';
import { FINAL_QUESTION_ID, TIE_QUESTION_ID } from './types';

export type Issue =
  | 'TITLE_MISSING'
  | 'NO_ROUNDS'
  | 'ROUND_EMPTY'
  | 'QUESTION_TEXT_MISSING'
  | 'ANSWER_MISSING'
  | 'OPTION_INDEX'
  | 'ESTIMATE_NEEDS_NUMBER'
  | 'TOO_FEW_TEAMS'
  | 'DUPLICATE_ID'
  | 'TIE_BREAK_NEEDS_NUMBER'
  | 'FINAL_NEEDS_PLAIN_ANSWER'
  | 'FINAL_QUESTION_MISSING';

/** What must be true before an event may go READY (the tablet shows these as a checklist). */
export function validateConfig(config: QuizConfig): { issue: Issue; where?: string }[] {
  const out: { issue: Issue; where?: string }[] = [];
  if (!config.title.trim()) out.push({ issue: 'TITLE_MISSING' });
  if (config.rounds.length === 0) out.push({ issue: 'NO_ROUNDS' });
  if (config.teams.length < 2) out.push({ issue: 'TOO_FEW_TEAMS' });
  const ids = new Set<string>();
  const dup = (id: string): void => {
    if (ids.has(id)) out.push({ issue: 'DUPLICATE_ID', where: id });
    ids.add(id);
  };
  for (const t of config.teams) dup(t.id);
  for (const round of config.rounds) {
    dup(round.id);
    if (round.questions.length === 0) out.push({ issue: 'ROUND_EMPTY', where: round.id });
    for (const q of round.questions) {
      dup(q.id);
      if (!q.text.trim()) out.push({ issue: 'QUESTION_TEXT_MISSING', where: q.id });
      checkAnswer(q, out);
      if (round.kind === 'ESTIMATE' && !isEstimate(q))
        out.push({ issue: 'ESTIMATE_NEEDS_NUMBER', where: q.id });
    }
  }
  if (config.tieBreak) {
    if (!config.tieBreak.text.trim())
      out.push({ issue: 'QUESTION_TEXT_MISSING', where: config.tieBreak.id });
    if (!isEstimate(config.tieBreak))
      out.push({ issue: 'TIE_BREAK_NEEDS_NUMBER', where: config.tieBreak.id });
  }
  const fin = config.finalWager;
  if (fin) {
    if (!fin.question.text.trim())
      out.push({ issue: 'FINAL_QUESTION_MISSING', where: FINAL_QUESTION_ID });
    checkAnswer(fin.question, out);
    // A closest-number question has no right/wrong to stake on.
    if (isEstimate(fin.question))
      out.push({ issue: 'FINAL_NEEDS_PLAIN_ANSWER', where: FINAL_QUESTION_ID });
  }
  return out;
}

function checkAnswer(
  q: QuizConfig['rounds'][number]['questions'][number],
  out: { issue: Issue; where?: string }[],
): void {
  const a = q.answer;
  if (a.type === 'TEXT' && !a.text.trim()) out.push({ issue: 'ANSWER_MISSING', where: q.id });
  if (a.type === 'OPTION' && (!q.options || a.index >= q.options.length))
    out.push({ issue: 'OPTION_INDEX', where: q.id });
}

export function createState(config: QuizConfig): QState {
  return {
    config,
    started: false,
    closed: false,
    cursor: -1,
    trail: [],
    reached: -1,
    paused: false,
    overlay: null,
    timer: null,
    jokers: {},
    marks: {},
    counts: {},
    modes: {},
    estimates: {},
    markers: {},
    wagers: {},
    bonusTeams: [],
    seq: 0,
  };
}

export interface Context {
  now: number;
  actor: string;
}
export type Outcome = { ok: true; state: QState; event: LogEvent } | { ok: false; error: QError };

const fail = (error: QError): Outcome => ({ ok: false, error });

function clone(s: QState): QState {
  const { config, ...rest } = s;
  // State is JSON-safe by construction (no Dates, maps or undefined), so a JSON round trip is a deep copy.
  return { config, ...(JSON.parse(JSON.stringify(rest)) as typeof rest) };
}

/** The slide NEXT would show, for the button label on the tablet. */
export function peekNext(s: QState): Step | null {
  const n = nextCursor(s);
  return n === null ? null : (buildSteps(s.config)[n] ?? null);
}

/** Next step that applies right now (tie-break steps vanish unless the top is tied). */
function nextCursor(s: QState): number | null {
  const steps = buildSteps(s.config);
  for (let i = s.cursor + 1; i < steps.length; i++) {
    const k = steps[i]!.kind;
    if ((k === 'TIE_QUESTION' || k === 'TIE_ANSWER') && !tieNeeded(s)) continue;
    return i;
  }
  return null;
}

/**
 * Apply one command. Pure: the caller provides the clock and the actor, so the same log always folds
 * into the same state. Every rejected command leaves the state untouched.
 */
export function execute(prev: QState, cmd: Command, ctx: Context): Outcome {
  const s = clone(prev);
  const { config } = s;
  const steps = buildSteps(config);
  let before: unknown = null;
  const team = (id: string) => config.teams.some((t) => t.id === id);

  if (cmd.type !== 'START' && !s.started) return fail('NOT_STARTED');
  if (s.closed) return fail('CLOSED');

  switch (cmd.type) {
    case 'START': {
      if (s.started) return fail('ALREADY_STARTED');
      if (validateConfig(config).length > 0) return fail('INVALID_CONFIG');
      s.started = true;
      s.cursor = 0;
      s.reached = 0;
      break;
    }
    case 'NEXT': {
      if (s.overlay) {
        // Leaving the overlay returns to the slide underneath; it must not also skip a slide.
        s.overlay = null;
        break;
      }
      const n = nextCursor(s);
      if (n === null) return fail('AT_END');
      s.trail.push(s.cursor);
      s.cursor = n;
      s.reached = Math.max(s.reached, n);
      s.timer = null;
      s.paused = false;
      break;
    }
    case 'BACK': {
      if (s.overlay) {
        s.overlay = null;
        break;
      }
      const p = s.trail.pop();
      if (p === undefined) return fail('AT_START');
      s.cursor = p;
      s.timer = null;
      s.paused = false;
      break;
    }
    case 'PAUSE': {
      if (s.paused) return fail('NOOP');
      s.paused = true;
      if (s.timer && s.timer.pausedAt === null) s.timer.pausedAt = ctx.now;
      break;
    }
    case 'RESUME': {
      if (!s.paused) return fail('NOT_PAUSED');
      s.paused = false;
      if (s.timer && s.timer.pausedAt !== null) {
        s.timer.pausedMs += ctx.now - s.timer.pausedAt;
        s.timer.pausedAt = null;
      }
      break;
    }
    case 'TIMER_START': {
      if (
        steps[s.cursor]?.kind !== 'QUESTION' &&
        steps[s.cursor]?.kind !== 'TIE_QUESTION' &&
        steps[s.cursor]?.kind !== 'FINAL_QUESTION'
      )
        return fail('NO_TIMER_HERE');
      s.timer = { seconds: cmd.seconds, startedAt: ctx.now, pausedAt: null, pausedMs: 0 };
      s.paused = false;
      break;
    }
    case 'JOKER': {
      const loc = cmd.questionId === TIE_QUESTION_ID ? null : locate(config, cmd.questionId);
      if (!loc || !team(cmd.teamId)) return fail('UNKNOWN_REF');
      if (!jokerEligibleIn(config, loc.r, loc.question)) return fail('JOKER_NOT_ALLOWED');
      // Locked the moment the question has been on the TV; BACK does not reopen it (`reached`).
      if (stepIndex(steps, 'QUESTION', loc.r, loc.q) <= s.reached) return fail('JOKER_LOCKED');
      const cur = s.jokers[cmd.questionId] ?? [];
      const has = cur.includes(cmd.teamId);
      before = has;
      if (cmd.on === has) return fail('NOOP');
      if (cmd.on) {
        const used = Object.values(s.jokers).filter((l) => l.includes(cmd.teamId)).length;
        if (used >= config.settings.jokersPerTeam) return fail('JOKER_LIMIT');
        s.jokers[cmd.questionId] = [...cur, cmd.teamId];
      } else {
        s.jokers[cmd.questionId] = cur.filter((t) => t !== cmd.teamId);
      }
      break;
    }
    case 'MARK': {
      if (cmd.questionId === FINAL_QUESTION_ID) {
        if (!rules(config).finalWager) return fail('NO_FINAL');
        if (!team(cmd.teamId)) return fail('UNKNOWN_REF');
        if (s.reached < stepIndex(steps, 'FINAL_ANSWER')) return fail('MARK_NOT_OPEN');
        before = s.marks[FINAL_QUESTION_ID]?.[cmd.teamId] ?? null;
        (s.marks[FINAL_QUESTION_ID] ??= {})[cmd.teamId] = cmd.right;
        break;
      }
      const loc = locate(config, cmd.questionId);
      if (!loc || !team(cmd.teamId)) return fail('UNKNOWN_REF');
      if (isEstimate(loc.question)) return fail('MODE_CONFLICT');
      if (s.reached < stepIndex(steps, 'SWAP', loc.r)) return fail('MARK_NOT_OPEN');
      const round = config.rounds[loc.r]!;
      if (
        s.modes[round.id] === 'COUNT' &&
        plainQuestions(s, loc.r).some((q) => q.id === loc.question.id)
      )
        return fail('MODE_CONFLICT');
      before = s.marks[cmd.questionId]?.[cmd.teamId] ?? null;
      (s.marks[cmd.questionId] ??= {})[cmd.teamId] = cmd.right;
      break;
    }
    case 'MARKING_MODE': {
      const r = config.rounds.findIndex((x) => x.id === cmd.roundId);
      if (r < 0) return fail('UNKNOWN_REF');
      if (cmd.mode === 'COUNT' && !countModeAvailable(s, r)) return fail('COUNT_UNAVAILABLE');
      before = s.modes[cmd.roundId] ?? 'GRID';
      s.modes[cmd.roundId] = cmd.mode;
      break;
    }
    case 'MARK_COUNT': {
      const r = config.rounds.findIndex((x) => x.id === cmd.roundId);
      if (r < 0 || !team(cmd.teamId)) return fail('UNKNOWN_REF');
      if (s.reached < stepIndex(steps, 'SWAP', r)) return fail('MARK_NOT_OPEN');
      if (s.modes[cmd.roundId] !== 'COUNT') return fail('MODE_CONFLICT');
      if (cmd.count > plainQuestions(s, r).length) return fail('COUNT_TOO_HIGH');
      before = s.counts[cmd.roundId]?.[cmd.teamId] ?? null;
      (s.counts[cmd.roundId] ??= {})[cmd.teamId] = cmd.count;
      break;
    }
    case 'ESTIMATE_VALUE': {
      const q =
        cmd.questionId === TIE_QUESTION_ID
          ? config.tieBreak
          : (locate(config, cmd.questionId)?.question ?? null);
      if (!q || !team(cmd.teamId)) return fail('UNKNOWN_REF');
      if (!isEstimate(q)) return fail('NOT_ESTIMATE');
      if (cmd.questionId === TIE_QUESTION_ID) {
        if (s.reached < stepIndex(steps, 'TIE_QUESTION')) return fail('MARK_NOT_OPEN');
      } else {
        const loc = locate(config, cmd.questionId)!;
        if (s.reached < stepIndex(steps, 'SWAP', loc.r)) return fail('MARK_NOT_OPEN');
      }
      before = s.estimates[cmd.questionId]?.[cmd.teamId] ?? null;
      const m = (s.estimates[cmd.questionId] ??= {});
      if (cmd.value === null) delete m[cmd.teamId];
      else m[cmd.teamId] = cmd.value;
      break;
    }
    case 'MARKER': {
      if (!team(cmd.teamId) || !team(cmd.markerTeamId)) return fail('UNKNOWN_REF');
      if (cmd.teamId === cmd.markerTeamId) return fail('BAD_MARKER');
      before = s.markers[cmd.teamId] ?? null;
      s.markers[cmd.teamId] = cmd.markerTeamId;
      break;
    }
    case 'WAGER': {
      if (!rules(config).finalWager) return fail('NO_FINAL');
      if (!team(cmd.teamId)) return fail('UNKNOWN_REF');
      // Stakes depend on the final standings, so they open with the final intro slide and lock the
      // moment the question is on the TV (BACK does not reopen them: `reached`).
      if (s.reached < stepIndex(steps, 'FINAL_INTRO')) return fail('MARK_NOT_OPEN');
      if (s.reached >= stepIndex(steps, 'FINAL_QUESTION')) return fail('WAGER_LOCKED');
      if (cmd.amount > wagerMax(s, cmd.teamId)) return fail('WAGER_TOO_HIGH');
      before = s.wagers[cmd.teamId] ?? null;
      s.wagers[cmd.teamId] = cmd.amount;
      break;
    }
    case 'TEAM_NAME_BONUS': {
      if (rules(config).nameBonus === 0) return fail('BONUS_OFF');
      if (!team(cmd.teamId)) return fail('UNKNOWN_REF');
      const has = s.bonusTeams.includes(cmd.teamId);
      before = has;
      if (cmd.on === has) return fail('NOOP');
      s.bonusTeams = cmd.on
        ? [...s.bonusTeams, cmd.teamId]
        : s.bonusTeams.filter((t) => t !== cmd.teamId);
      break;
    }
    case 'SHOW_STANDINGS': {
      if (s.reached < stepIndex(steps, 'ROUND_SCORES', 0)) return fail('NOOP');
      s.overlay = 'STANDINGS';
      break;
    }
    case 'HIDE_OVERLAY': {
      if (!s.overlay) return fail('NOOP');
      s.overlay = null;
      break;
    }
    case 'CLOSE': {
      if (s.reached < stepIndex(steps, 'PODIUM')) return fail('PODIUM_NOT_REACHED');
      s.closed = true;
      break;
    }
  }
  s.seq = prev.seq + 1;
  return {
    ok: true,
    state: s,
    event: { seq: s.seq, at: ctx.now, actor: ctx.actor, cmd, prev: before },
  };
}

/** Rebuild a night from its log; deterministic because `at`/`actor` come from the log, never the clock. */
export function replay(config: QuizConfig, log: readonly LogEvent[]): QState {
  let s = createState(config);
  for (const e of log) {
    const o = execute(s, e.cmd, { now: e.at, actor: e.actor });
    // A stored event was accepted once; a failure here means the log or the engine changed.
    if (!o.ok) throw new Error(`quiznight replay failed at seq ${e.seq}: ${o.error}`);
    s = o.state;
  }
  return s;
}
