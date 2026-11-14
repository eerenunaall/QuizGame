import { describe, expect, it } from 'vitest';
import {
  ConfigSchema,
  buildSteps,
  createState,
  execute,
  hostView,
  replay,
  templateConfig,
  tvView,
  validateConfig,
  type Command,
  type LogEvent,
  type QState,
  type QuizConfig,
} from './index';
import { fixture, q, run } from './fixtures';

const next = (n: number): Command[] => Array.from({ length: n }, () => ({ type: 'NEXT' }));
const code = (s: QState, cmd: Command) => {
  const o = execute(s, cmd, { now: 5, actor: 'h' });
  return o.ok ? 'OK' : o.error;
};
const stepOf = (s: QState, kind: string) => buildSteps(s.config).findIndex((x) => x.kind === kind);
const goTo = (s: QState, kind: string): QState => run(s, ...next(stepOf(s, kind) - s.cursor));
const goToRound = (s: QState, kind: string, round: number): QState =>
  run(
    s,
    ...next(buildSteps(s.config).findIndex((x) => x.kind === kind && x.round === round) - s.cursor),
  );

/** fixture() plus a final wager question (no tie-break, so the podium follows the reveal). */
function withFinal(over: Partial<QuizConfig['settings']> = {}): QuizConfig {
  const c = fixture(over, false);
  c.finalWager = {
    category: 'Tarih',
    question: q('fin', 0, { answer: { type: 'TEXT', text: 'Truva' } }),
  };
  return c;
}

/** Plays to the final intro: t1 holds 4 + 3 (estimate) = 7, t2 holds 1, t3 holds 0. */
function toFinalIntro(config = withFinal()): QState {
  let s = run(createState(config), { type: 'START' }, ...next(7));
  s = run(
    s,
    { type: 'MARK', questionId: 'a', teamId: 't1', right: true },
    { type: 'MARK', questionId: 'b', teamId: 't1', right: true },
    { type: 'MARK', questionId: 'c', teamId: 't1', right: true },
    { type: 'MARK', questionId: 'a', teamId: 't2', right: true },
  );
  s = run(s, ...next(10));
  s = run(s, { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't1', value: 100 });
  return goTo(s, 'FINAL_INTRO');
}

describe('final wager: script and limits', () => {
  it('adds the four final slides after the last standings, and only when configured', () => {
    const kinds = buildSteps(withFinal()).map((x) => x.kind);
    expect(kinds.slice(-6)).toEqual([
      'STANDINGS',
      'FINAL_INTRO',
      'FINAL_QUESTION',
      'FINAL_ANSWER',
      'FINAL_REVEAL',
      'PODIUM',
    ]);
    expect(buildSteps(fixture()).some((x) => x.kind === 'FINAL_INTRO')).toBe(false);
  });

  it('refuses a final whose answer is a number and one without a question', () => {
    const c = withFinal();
    c.finalWager!.question.answer = { type: 'NUMBER', value: 3 };
    expect(validateConfig(c)).toContainEqual({
      issue: 'FINAL_NEEDS_PLAIN_ANSWER',
      where: 'final-wager',
    });
    const d = withFinal();
    d.finalWager!.question.text = ' ';
    expect(validateConfig(d)).toContainEqual({
      issue: 'FINAL_QUESTION_MISSING',
      where: 'final-wager',
    });
  });

  it('stake is capped by the setting and by the points the team holds', () => {
    const s = toFinalIntro(withFinal({ wagerCap: 5 }));
    // t1 holds 7, cap 5; t2 holds 1; t3 holds 0
    expect(code(s, { type: 'WAGER', teamId: 't1', amount: 5 })).toBe('OK');
    expect(code(s, { type: 'WAGER', teamId: 't1', amount: 6 })).toBe('WAGER_TOO_HIGH');
    expect(code(s, { type: 'WAGER', teamId: 't2', amount: 1 })).toBe('OK');
    expect(code(s, { type: 'WAGER', teamId: 't2', amount: 2 })).toBe('WAGER_TOO_HIGH');
    expect(code(s, { type: 'WAGER', teamId: 't3', amount: 1 })).toBe('WAGER_TOO_HIGH');
    expect(code(s, { type: 'WAGER', teamId: 't3', amount: 0 })).toBe('OK');
    expect(hostView(s, 0).final!.teams.map((t) => t.max)).toEqual([5, 1, 0]);
  });

  it('defaults the cap to 10', () => {
    const c = withFinal();
    delete c.settings.wagerCap;
    let s = toFinalIntro(c);
    s = run(s, { type: 'WAGER', teamId: 't1', amount: 7 });
    expect(hostView(s, 0).final!.cap).toBe(10);
  });

  it('opens at the intro, locks when the question is on the TV and BACK does not reopen it', () => {
    let s = run(createState(withFinal()), { type: 'START' });
    expect(code(s, { type: 'WAGER', teamId: 't1', amount: 0 })).toBe('MARK_NOT_OPEN');
    s = toFinalIntro();
    s = run(s, { type: 'WAGER', teamId: 't1', amount: 4 });
    s = run(s, { type: 'NEXT' }); // question on TV
    expect(code(s, { type: 'WAGER', teamId: 't1', amount: 3 })).toBe('WAGER_LOCKED');
    s = run(s, { type: 'BACK' });
    expect(code(s, { type: 'WAGER', teamId: 't1', amount: 3 })).toBe('WAGER_LOCKED');
  });

  it('is rejected on a night without a final', () => {
    const s = run(createState(fixture()), { type: 'START' });
    expect(code(s, { type: 'WAGER', teamId: 't1', amount: 1 })).toBe('NO_FINAL');
    expect(code(s, { type: 'MARK', questionId: 'final-wager', teamId: 't1', right: true })).toBe(
      'NO_FINAL',
    );
  });
});

describe('final wager: scoring', () => {
  /** t1 stakes 5 (right), t2 stakes 1 (wrong), t3 stakes nothing. */
  function played(): QState {
    let s = toFinalIntro();
    s = run(
      s,
      { type: 'WAGER', teamId: 't1', amount: 5 },
      { type: 'WAGER', teamId: 't2', amount: 1 },
    );
    s = run(s, { type: 'NEXT' }); // FINAL_QUESTION
    expect(code(s, { type: 'MARK', questionId: 'final-wager', teamId: 't1', right: true })).toBe(
      'MARK_NOT_OPEN',
    );
    s = run(s, { type: 'NEXT' }); // FINAL_ANSWER
    return run(
      s,
      { type: 'MARK', questionId: 'final-wager', teamId: 't1', right: true },
      { type: 'MARK', questionId: 'final-wager', teamId: 't2', right: false },
      { type: 'MARK', questionId: 'final-wager', teamId: 't3', right: true },
    );
  }

  it('right wins the stake, wrong loses it, no stake means nothing at risk', () => {
    const h = hostView(played(), 0);
    expect(h.final!.teams.map((t) => [t.teamId, t.wager, t.delta])).toEqual([
      ['t1', 5, 5],
      ['t2', 1, -1],
      ['t3', null, 0],
    ]);
  });

  it('adds the result to the totals on the podium, not before the reveal slide', () => {
    let s = played();
    // The TV is still on the final answer: the last standings must not include the final yet.
    s = run(s, { type: 'BACK' }, { type: 'BACK' }, { type: 'BACK' });
    const early = tvView(run(s, { type: 'SHOW_STANDINGS' }), 0);
    expect(early.standings!.map((r) => [r.teamId, r.total])).toEqual([
      ['t1', 7],
      ['t2', 1],
      ['t3', 0],
    ]);
    s = goTo(s, 'FINAL_REVEAL');
    const reveal = tvView(s, 0);
    expect(reveal.final!.reveal.map((r) => r.teamId)).toEqual(['t3', 't2', 't1']);
    expect(reveal.final!.reveal.find((r) => r.teamId === 't1')).toMatchObject({
      wager: 5,
      right: true,
      delta: 5,
      total: 12,
      rank: 1,
    });
    s = run(s, { type: 'NEXT' });
    const podium = tvView(s, 0);
    expect(podium.podium!.map((r) => [r.teamId, r.total])).toEqual([
      ['t1', 12],
      ['t2', 0],
      ['t3', 0],
    ]);
    expect(hostView(s, 0).winnerTeamIds).toEqual(['t1']);
  });

  it('an unmarked team neither wins nor loses', () => {
    let s = toFinalIntro();
    s = run(s, { type: 'WAGER', teamId: 't1', amount: 5 }, ...next(2));
    expect(hostView(s, 0).final!.teams[0]).toMatchObject({ wager: 5, right: null, delta: 0 });
  });

  it('a lowered earlier mark cuts the stake that counts to what the team now holds', () => {
    let s = played();
    // t1 loses c (2 points) retroactively: 7 -> 5 held, stake 5 still fits; lose a and b too -> 3 held
    s = run(
      s,
      { type: 'MARK', questionId: 'a', teamId: 't1', right: false },
      { type: 'MARK', questionId: 'b', teamId: 't1', right: false },
    );
    expect(hostView(s, 0).final!.teams[0]).toMatchObject({ wager: 5, max: 5, delta: 5 });
    s = run(s, { type: 'MARK', questionId: 'c', teamId: 't1', right: false });
    // only the estimate's 3 points remain
    expect(hostView(s, 0).final!.teams[0]).toMatchObject({ max: 3, delta: 3 });
  });
});

describe('final wager: nothing leaks to the TV early', () => {
  it('shows the category on the intro but neither question text nor answer nor stakes', () => {
    let s = toFinalIntro();
    s = run(s, { type: 'WAGER', teamId: 't1', amount: 5 });
    const intro = JSON.stringify(tvView(s, 0));
    expect(intro).toContain('Tarih');
    expect(intro).not.toContain('Soru fin');
    expect(intro).not.toContain('Truva');
    expect(tvView(s, 0).final!.limits.map((l) => l.max)).toEqual([7, 1, 0]);
    s = run(s, { type: 'NEXT' });
    const question = JSON.stringify(tvView(s, 0));
    expect(question).toContain('Soru fin');
    expect(question).not.toContain('Truva');
    expect(tvView(s, 0).final!.reveal).toEqual([]);
    s = run(s, { type: 'NEXT' });
    expect(JSON.stringify(tvView(s, 0))).toContain('Truva');
    expect(tvView(s, 0).final!.reveal).toEqual([]);
  });
});

describe('2x joker from round N', () => {
  it('refuses jokers before the configured round and shows it on the host view', () => {
    const s = run(createState(fixture({ jokerFromRound: 2 })), { type: 'START' });
    expect(code(s, { type: 'JOKER', questionId: 'a', teamId: 't1', on: true })).toBe(
      'JOKER_NOT_ALLOWED',
    );
    expect(hostView(s, 0).rounds[0]!.questions.every((x) => !x.jokerEligible)).toBe(true);
  });
  it('default allows round 1', () => {
    const s = run(createState(fixture()), { type: 'START' });
    expect(code(s, { type: 'JOKER', questionId: 'a', teamId: 't1', on: true })).toBe('OK');
  });
});

describe('team-name bonus', () => {
  it('is off by default and adds the points to round 1 when on', () => {
    let s = run(createState(fixture()), { type: 'START' });
    expect(code(s, { type: 'TEAM_NAME_BONUS', teamId: 't1', on: true })).toBe('BONUS_OFF');
    s = run(createState(fixture({ nameBonus: 2 })), { type: 'START' });
    s = run(s, { type: 'TEAM_NAME_BONUS', teamId: 't2', on: true });
    expect(code(s, { type: 'TEAM_NAME_BONUS', teamId: 't2', on: true })).toBe('NOOP');
    expect(hostView(s, 0).rounds[0]!.result!.points).toEqual({ t1: 0, t2: 2, t3: 0 });
    expect(hostView(s, 0).nameBonus).toEqual({ points: 2, teamIds: ['t2'] });
    s = run(s, { type: 'TEAM_NAME_BONUS', teamId: 't2', on: false });
    expect(hostView(s, 0).rounds[0]!.result!.points.t2).toBe(0);
  });
});

describe('estimate top 3', () => {
  function estimateNight(over: Partial<QuizConfig['settings']>): QState {
    const c = fixture(over);
    c.rounds[1]!.questions[0]!.points = 5;
    const s = run(createState(c), { type: 'START' }, ...next(7), ...next(10));
    return run(
      s,
      { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't1', value: 90 }, // distance 10
      { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't2', value: 130 }, // distance 30
      { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't3', value: 70 }, // distance 30
    );
  }
  it('pays 5/3/1 to places 1, 2 and 3 and shares a tied place', () => {
    const s = estimateNight({ estimateTop3: true });
    // t2 and t3 are tied for second place: both get the second-place 3 points
    expect(hostView(s, 0).rounds[1]!.result!.points).toEqual({ t1: 5, t2: 3, t3: 3 });
  });
  it('only the closest scores without the setting', () => {
    const s = estimateNight({});
    expect(hostView(s, 0).rounds[1]!.result!.points).toEqual({ t1: 5, t2: 0, t3: 0 });
  });
  it('places are 1, 2, 3 when all distances differ', () => {
    let s = estimateNight({ estimateTop3: true });
    s = run(s, { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't3', value: 60 });
    expect(hostView(s, 0).rounds[1]!.result!.points).toEqual({ t1: 5, t2: 3, t3: 1 });
  });
  it('the TV round slide lists every scoring place', () => {
    let s = estimateNight({ estimateTop3: true });
    s = goToRound(s, 'ROUND_SCORES', 1);
    const slide = tvView(s, 0).roundScores!;
    expect(slide.estimateWinners[0]!.places.map((p) => [p.place, p.points])).toEqual([
      [1, 5],
      [2, 3],
    ]);
  });
});

describe('consolation prize', () => {
  it('goes to the last place on the podium, and to nobody when none is set', () => {
    let s = toFinalIntro(withFinal({ consolationText: 'Bir kahve' }));
    s = goTo(s, 'PODIUM');
    const tv = tvView(s, 0);
    // t1 holds 7, t2 holds 1, t3 holds 0: only t3 is last
    expect(tv.consolation).toEqual({ teamIds: ['t3'], text: 'Bir kahve' });
    expect(hostView(s, 0).consolation).toEqual({ teamIds: ['t3'], text: 'Bir kahve' });
    const none = goTo(toFinalIntro(withFinal()), 'PODIUM');
    expect(tvView(none, 0).consolation).toBeNull();
  });
});

describe('replay with the new commands', () => {
  it('folds the same state from the log', () => {
    const config = withFinal({ nameBonus: 1, estimateTop3: true });
    let state = createState(config);
    const log: LogEvent[] = [];
    let t = 0;
    const cmds: Command[] = [
      { type: 'START' },
      { type: 'TEAM_NAME_BONUS', teamId: 't3', on: true },
      ...next(7),
      { type: 'MARK', questionId: 'a', teamId: 't1', right: true },
      ...next(10),
      ...next(5),
      { type: 'WAGER', teamId: 't1', amount: 1 },
      ...next(2),
      { type: 'MARK', questionId: 'final-wager', teamId: 't1', right: true },
    ];
    for (const cmd of cmds) {
      const o = execute(state, cmd, { now: (t += 10), actor: 'h' });
      expect(o.ok).toBe(true);
      if (o.ok) {
        state = o.state;
        log.push(o.event);
      }
    }
    expect(replay(config, log)).toEqual(state);
  });
});

describe('recommended template', () => {
  it('builds the researched night and validates once teams and texts are filled in', () => {
    let n = 0;
    const config = templateConfig('RECOMMENDED', {
      title: 'Cuma',
      date: '2026-11-20',
      newId: () => `id${n++}`,
      labels: { round: (i) => `Tur ${i}`, final: 'Final', estimate: 'Tahmin' },
    });
    expect(config.rounds.map((r) => [r.kind, r.questions.length])).toEqual([
      ['NORMAL', 10],
      ['NORMAL', 10],
      ['NORMAL', 10],
      ['ESTIMATE', 3],
    ]);
    expect(config.rounds[3]!.questions.every((x) => x.points === 5)).toBe(true);
    expect(config.settings).toMatchObject({
      jokerFromRound: 2,
      nameBonus: 2,
      estimateTop3: true,
      wagerCap: 10,
      halfTimeAfterRound: 2,
    });
    expect(config.finalWager).not.toBeNull();
    expect(config.tieBreak?.answer.type).toBe('NUMBER');
    // what is still missing is exactly what the host must write: texts, answers, teams
    const issues = new Set(validateConfig(config).map((i) => i.issue));
    expect(issues).toEqual(
      new Set([
        'QUESTION_TEXT_MISSING',
        'ANSWER_MISSING',
        'TOO_FEW_TEAMS',
        'FINAL_QUESTION_MISSING',
      ]),
    );
    expect(ConfigSchema.safeParse(config).success).toBe(true);
  });
});
