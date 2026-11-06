import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createState,
  execute,
  hostView,
  replay,
  teamBadge,
  tvView,
  validateConfig,
  type Command,
  type LogEvent,
  type QState,
  type QuizConfig,
} from './index';

const q = (
  id: string,
  points = 1,
  over: Partial<QuizConfig['rounds'][0]['questions'][0]> = {},
) => ({
  id,
  text: `Soru ${id}`,
  answer: { type: 'TEXT' as const, text: `Cevap ${id}` },
  points,
  jokerAllowed: true,
  ...over,
});

export function fixture(over: Partial<QuizConfig['settings']> = {}, tie = true): QuizConfig {
  return {
    title: 'Test Gecesi',
    date: '2026-11-06',
    rounds: [
      { id: 'r1', kind: 'NORMAL', title: 'Tur 1', questions: [q('a', 1), q('b', 1), q('c', 2)] },
      {
        id: 'r2',
        kind: 'ESTIMATE',
        title: 'Tahmin',
        questions: [q('e', 3, { answer: { type: 'NUMBER', value: 100 }, jokerAllowed: false })],
      },
    ],
    tieBreak: tie
      ? q('tie-break', 0, { answer: { type: 'NUMBER', value: 50 }, jokerAllowed: false })
      : null,
    teams: [1, 2, 3].map((n) => ({
      id: `t${n}`,
      name: `Takım ${n}`,
      badge: teamBadge(n),
      table: n,
    })),
    settings: {
      jokersPerTeam: 2,
      wrongDoublePenalty: false,
      timerSec: 30,
      halfTimeAfterRound: 0,
      entranceText: '',
      prizeText: '',
      ...over,
    },
  };
}

let clock = 1_000;
export function run(state: QState, ...cmds: Command[]): QState {
  let s = state;
  for (const cmd of cmds) {
    const o = execute(s, cmd, { now: (clock += 1000), actor: 'host' });
    if (!o.ok) throw new Error(`${cmd.type} -> ${o.error}`);
    s = o.state;
  }
  return s;
}
const next = (n: number): Command[] => Array.from({ length: n }, () => ({ type: 'NEXT' }));
const code = (s: QState, cmd: Command) => {
  const o = execute(s, cmd, { now: 5, actor: 'h' });
  return o.ok ? 'OK' : o.error;
};

/** INTRO, HOWTO, ROUND_TITLE r1, a, b, c, LOCKED, SWAP(=idx 8) */
const toSwap1 = (s: QState) => run(s, ...next(7));

describe('config validation', () => {
  it('accepts the fixture and flags blanks', () => {
    expect(validateConfig(fixture())).toEqual([]);
    const bad = fixture();
    bad.rounds[0]!.questions[0]!.text = '';
    expect(validateConfig(bad)).toContainEqual({ issue: 'QUESTION_TEXT_MISSING', where: 'a' });
  });
  it('refuses to start an invalid config', () => {
    const bad = fixture();
    bad.teams = [];
    expect(code(createState(bad), { type: 'START' })).toBe('INVALID_CONFIG');
  });
});

describe('jokers', () => {
  it('locks when the question is shown and BACK does not reopen it', () => {
    let s = run(createState(fixture()), { type: 'START' });
    s = run(s, { type: 'JOKER', questionId: 'a', teamId: 't1', on: true });
    s = run(s, ...next(3)); // round title, then question a on TV
    expect(code(s, { type: 'JOKER', questionId: 'a', teamId: 't2', on: true })).toBe(
      'JOKER_LOCKED',
    );
    s = run(s, { type: 'BACK' }, { type: 'BACK' });
    expect(code(s, { type: 'JOKER', questionId: 'a', teamId: 't2', on: true })).toBe(
      'JOKER_LOCKED',
    );
    expect(code(s, { type: 'JOKER', questionId: 'b', teamId: 't2', on: true })).toBe('OK');
  });
  it('enforces the per-team limit and refuses estimates', () => {
    let s = run(createState(fixture()), { type: 'START' });
    s = run(
      s,
      { type: 'JOKER', questionId: 'a', teamId: 't1', on: true },
      { type: 'JOKER', questionId: 'b', teamId: 't1', on: true },
    );
    expect(code(s, { type: 'JOKER', questionId: 'c', teamId: 't1', on: true })).toBe('JOKER_LIMIT');
    expect(code(s, { type: 'JOKER', questionId: 'e', teamId: 't2', on: true })).toBe(
      'JOKER_NOT_ALLOWED',
    );
    s = run(s, { type: 'JOKER', questionId: 'a', teamId: 't1', on: false });
    expect(code(s, { type: 'JOKER', questionId: 'c', teamId: 't1', on: true })).toBe('OK');
  });
});

describe('scoring', () => {
  it('doubles a right doubled answer and shows the payoff', () => {
    let s = run(createState(fixture()), { type: 'START' });
    s = run(s, { type: 'JOKER', questionId: 'c', teamId: 't1', on: true });
    s = toSwap1(s);
    s = run(
      s,
      { type: 'MARK', questionId: 'a', teamId: 't1', right: true },
      { type: 'MARK', questionId: 'c', teamId: 't1', right: true },
      { type: 'MARK', questionId: 'c', teamId: 't2', right: true },
    );
    const h = hostView(s, 0);
    expect(h.rounds[0]!.result!.points).toEqual({ t1: 5, t2: 2, t3: 0 });
    expect(h.rounds[0]!.result!.jokers).toEqual([{ teamId: 't1', number: 3, delta: 2 }]);
  });
  it('wrong doubled answer costs points only with the setting and once scored', () => {
    const on = fixture({ wrongDoublePenalty: true });
    let s = run(
      createState(on),
      { type: 'START' },
      { type: 'JOKER', questionId: 'c', teamId: 't1', on: true },
    );
    s = toSwap1(s);
    expect(hostView(s, 0).rounds[0]!.result!.points.t1).toBe(0);
    s = run(s, ...next(5)); // answers a,b,c, marking, round scores
    expect(hostView(s, 0).rounds[0]!.result!.points.t1).toBe(-2);
    const off = run(
      createState(fixture()),
      { type: 'START' },
      { type: 'JOKER', questionId: 'c', teamId: 't1', on: true },
    );
    expect(hostView(run(toSwap1(off), ...next(5)), 0).rounds[0]!.result!.points.t1).toBe(0);
  });
  it('count mode excludes doubled questions and is capped', () => {
    let s = run(
      createState(fixture()),
      { type: 'START' },
      { type: 'JOKER', questionId: 'c', teamId: 't1', on: true },
    );
    s = toSwap1(s);
    // plain questions a,b (1 point each), c is doubled so marked per question
    expect(code(s, { type: 'MARKING_MODE', roundId: 'r1', mode: 'COUNT' })).toBe('OK');
    s = run(s, { type: 'MARKING_MODE', roundId: 'r1', mode: 'COUNT' });
    expect(code(s, { type: 'MARK_COUNT', roundId: 'r1', teamId: 't1', count: 3 })).toBe(
      'COUNT_TOO_HIGH',
    );
    expect(code(s, { type: 'MARK', questionId: 'a', teamId: 't1', right: true })).toBe(
      'MODE_CONFLICT',
    );
    s = run(
      s,
      { type: 'MARK_COUNT', roundId: 'r1', teamId: 't1', count: 2 },
      { type: 'MARK', questionId: 'c', teamId: 't1', right: true },
    );
    expect(hostView(s, 0).rounds[0]!.result!.points.t1).toBe(2 + 4);
  });
  it('estimate: closest wins, equal distance shares, never per-team count', () => {
    let s = toSwap1(run(createState(fixture()), { type: 'START' }));
    s = run(s, ...next(10)); // to the paper swap of round 2
    s = run(
      s,
      { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't1', value: 90 },
      { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't2', value: 110 },
      { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't3', value: 300 },
    );
    expect(hostView(s, 0).rounds[1]!.result!.points).toEqual({ t1: 3, t2: 3, t3: 0 });
    s = run(s, { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't2', value: 101 });
    expect(hostView(s, 0).rounds[1]!.result!.points).toEqual({ t1: 0, t2: 3, t3: 0 });
  });
});

/** Walk the whole fixture night, marking according to `rights`. */
function playNight(rights: Record<string, string[]>, tieValues?: Record<string, number>): QState {
  let s = run(createState(fixture()), { type: 'START' }, ...next(7));
  for (const [qid, teams] of Object.entries(rights))
    for (const t of teams) s = run(s, { type: 'MARK', questionId: qid, teamId: t, right: true });
  s = run(s, ...next(10));
  s = run(s, { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't1', value: 100 });
  s = run(s, ...next(4));
  if (tieValues) {
    s = run(s, { type: 'NEXT' });
    for (const [t, v] of Object.entries(tieValues))
      s = run(s, { type: 'ESTIMATE_VALUE', questionId: 'tie-break', teamId: t, value: v });
  }
  return s;
}

describe('standings', () => {
  it('uses competition ranking and reports rank changes', () => {
    const s = playNight({ a: ['t1', 't2'], b: ['t3'] });
    const rows = hostView(s, 0).standings;
    // t1: 1 + 3(estimate)=4, t2: 1, t3: 1
    expect(rows.map((r) => [r.teamId, r.total, r.rank])).toEqual([
      ['t1', 4, 1],
      ['t2', 1, 2],
      ['t3', 1, 2],
    ]);
    expect(rows[0]!.rankChange).toBe(0);
  });
  it('tie for first runs the tie-break and orders by distance', () => {
    // t1 gets 1+3=4, t2 needs 4: a(1)+b(1)+c(2)
    let s = playNight({ a: ['t1', 't2'], b: ['t2'], c: ['t2'] }, { t1: 40, t2: 49 });
    const tv = tvView(s, 0);
    expect(tv.step).toBe('TIE_QUESTION');
    s = run(s, { type: 'NEXT' }, { type: 'NEXT' });
    const done = hostView(s, 0);
    expect(done.winnerTeamIds).toEqual(['t2']);
    expect(done.tie!.needed).toBe(true);
  });
  it('skips the tie-break when the top is not tied', () => {
    const s = playNight({ a: ['t2'] });
    // t1: 3, t2: 1 -> no tie; next step goes to PODIUM
    expect(tvView(run(s, { type: 'NEXT' }), 0).step).toBe('PODIUM');
  });
});

describe('TV view never leaks', () => {
  it('has no answer before the answer slide and no marks ever', () => {
    let s = run(
      createState(fixture()),
      { type: 'START' },
      { type: 'JOKER', questionId: 'a', teamId: 't2', on: true },
    );
    s = run(s, ...next(3));
    let tv = tvView(s, 0);
    expect(tv.step).toBe('QUESTION');
    expect(tv.doubled).toEqual(['t2']);
    expect(JSON.stringify(tv)).not.toContain('Cevap a');
    s = run(s, ...next(5)); // b, c, locked, swap, answer a
    s = run(s, { type: 'MARK', questionId: 'b', teamId: 't3', right: true });
    tv = tvView(s, 0);
    expect(tv.step).toBe('ANSWER');
    expect(JSON.stringify(tv)).toContain('Cevap a');
    expect(JSON.stringify(tv)).not.toContain('Cevap b');
    expect(JSON.stringify(tv)).not.toMatch(/marks|right"/);
  });
  it('does not show a joker pick before the question is on screen', () => {
    const s = run(
      createState(fixture()),
      { type: 'START' },
      { type: 'JOKER', questionId: 'a', teamId: 't2', on: true },
    );
    expect(tvView(s, 0).doubled).toEqual([]);
  });
});

describe('log, undo, corrections', () => {
  it('records previous values for corrections', () => {
    let s = toSwap1(run(createState(fixture()), { type: 'START' }));
    s = run(s, { type: 'MARK', questionId: 'a', teamId: 't1', right: true });
    const o = execute(
      s,
      { type: 'MARK', questionId: 'a', teamId: 't1', right: false },
      { now: 9, actor: 'owner-1' },
    );
    expect(o.ok && o.event).toMatchObject({ prev: true, actor: 'owner-1', at: 9 });
  });
  it('BACK steps one slide back; pause freezes the timer', () => {
    let s = run(createState(fixture()), { type: 'START' }, ...next(3));
    s = run(s, { type: 'TIMER_START', seconds: 30 });
    const t0 = s.timer!.startedAt;
    s = run(s, { type: 'PAUSE' });
    const frozen = tvView(s, t0 + 5_000).timer!.remainingMs;
    expect(tvView(s, t0 + 20_000).timer!.remainingMs).toBe(frozen);
    s = run(s, { type: 'BACK' });
    expect(s.cursor).toBe(2);
    expect(code(createState(fixture()), { type: 'NEXT' })).toBe('NOT_STARTED');
  });
  it('rejects corrections after close and close before the podium', () => {
    let s = playNight({ a: ['t1'] });
    expect(code(s, { type: 'CLOSE' })).toBe('PODIUM_NOT_REACHED');
    s = run(s, { type: 'NEXT' }, { type: 'CLOSE' });
    expect(code(s, { type: 'MARK', questionId: 'a', teamId: 't2', right: true })).toBe('CLOSED');
  });
  it('jump to standings is an overlay that returns to the same slide', () => {
    let s = playNight({ a: ['t1'] });
    s = run(s, { type: 'BACK' });
    const at = s.cursor;
    s = run(s, { type: 'SHOW_STANDINGS' });
    expect(tvView(s, 0).standings).not.toBeNull();
    s = run(s, { type: 'NEXT' });
    expect(s.cursor).toBe(at);
  });
});

describe('properties', () => {
  const cmdArb: fc.Arbitrary<Command> = fc.oneof(
    fc.constant<Command>({ type: 'NEXT' }),
    fc.constant<Command>({ type: 'BACK' }),
    fc
      .constantFrom('a', 'b', 'c', 'e')
      .chain((questionId) =>
        fc
          .tuple(fc.constantFrom('t1', 't2', 't3'), fc.boolean())
          .map(([teamId, on]): Command => ({ type: 'JOKER', questionId, teamId, on })),
      ),
    fc
      .tuple(fc.constantFrom('a', 'b', 'c'), fc.constantFrom('t1', 't2', 't3'), fc.boolean())
      .map(([questionId, teamId, right]): Command => ({ type: 'MARK', questionId, teamId, right })),
    fc
      .tuple(fc.constantFrom('t1', 't2', 't3'), fc.double({ min: 0, max: 500, noNaN: true }))
      .map(([teamId, value]): Command => ({
        type: 'ESTIMATE_VALUE',
        questionId: 'e',
        teamId,
        value,
      })),
  );

  function fold(cmds: Command[]): { state: QState; log: LogEvent[] } {
    let state = createState(fixture());
    const log: LogEvent[] = [];
    let t = 0;
    for (const cmd of [{ type: 'START' } as Command, ...cmds]) {
      const o = execute(state, cmd, { now: (t += 10), actor: 'h' });
      if (o.ok) {
        state = o.state;
        log.push(o.event);
      }
    }
    return { state, log };
  }

  it('replay is deterministic and equals the live fold', () => {
    fc.assert(
      fc.property(fc.array(cmdArb, { maxLength: 80 }), (cmds) => {
        const { state, log } = fold(cmds);
        const again = replay(fixture(), log);
        expect(again).toEqual(state);
        expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1));
      }),
      { numRuns: 150 },
    );
  });

  it('never exceeds the joker limit and totals equal the sum of earned points', () => {
    fc.assert(
      fc.property(fc.array(cmdArb, { maxLength: 80 }), (cmds) => {
        const { state } = fold(cmds);
        for (const t of ['t1', 't2', 't3']) {
          const used = Object.values(state.jokers).filter((l) => l.includes(t)).length;
          expect(used).toBeLessThanOrEqual(2);
        }
        const h = hostView(state, 0);
        // Conservation: every round's points are exactly rights*points (+points per joker that was right).
        for (const round of h.rounds) {
          const total = Object.values(round.result!.points).reduce((a, b) => a + b, 0);
          let expected = 0;
          for (const qd of round.questions) {
            if (qd.estimate) {
              const vals = Object.entries(qd.estimates);
              if (vals.length) {
                const best = Math.min(...vals.map(([, v]) => Math.abs(v - 100)));
                expected += vals.filter(([, v]) => Math.abs(v - 100) === best).length * qd.points;
              }
              continue;
            }
            for (const [tid, right] of Object.entries(qd.marks))
              if (right) expected += qd.points * (qd.doubled.includes(tid) ? 2 : 1);
          }
          expect(total).toBe(expected);
        }
      }),
      { numRuns: 150 },
    );
  });
});
