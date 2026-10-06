import { describe, expect, it } from 'vitest';
import type { Phase } from '@quizparty/protocol';
import { createRoom, reduce } from './reducer';
import { Harness, TEST_ROOM_ID, makeDeck, testConfig } from './testing';

/** Harness with `players` joined and the game advanced to the open answer window of round 1. */
function answeringHarness(players = 3, config = testConfig()) {
  const h = new Harness({ config });
  const ids = h.joinPlayers(players);
  h.start();
  h.runUntil('ANSWERING');
  return { h, ids };
}

describe('phase flow', () => {
  it('walks the full state machine and ends in RESULTS with the right shape', () => {
    const h = new Harness();
    h.joinPlayers(3);
    h.start();
    h.runUntil('RESULTS');

    const phases = h.phaseEvents();
    const perRound: Phase[] = [
      'ROUND_INTRO',
      'QUESTION_PREP',
      'QUESTION',
      'ANSWERING',
      'LOCKED',
      'REVEAL',
      'SCORE_UPDATE',
      'MICRO_INTERMISSION',
    ];
    const finalRound: Phase[] = [
      'FINAL',
      'QUESTION_PREP',
      'QUESTION',
      'ANSWERING',
      'LOCKED',
      'REVEAL',
      'SCORE_UPDATE',
      'RESULTS',
    ];
    // LOBBY (three joins start with LOBBY once) + COUNTDOWN, nine standard rounds, the final.
    expect(phases).toEqual([
      'LOBBY',
      'COUNTDOWN',
      ...Array(9).fill(perRound).flat(),
      ...finalRound,
    ]);
    expect(h.state.game!.roundIndex).toBe(9);
    expect(h.state.game!.round!.kind).toBe('FINAL');
    expect(h.state.game!.results!.ranking).toHaveLength(3);
  });

  it('never repeats a question within a game', () => {
    const h = new Harness();
    h.joinPlayers(2);
    h.start();
    const seen = new Set<string>();
    for (let round = 0; round < 10; round++) {
      h.runUntil(round === 9 ? 'FINAL' : 'ROUND_INTRO');
      const id = h.round().questionId;
      expect(seen.has(id), `round ${round} repeated ${id}`).toBe(false);
      seen.add(id);
      if (round < 9) h.runUntil('MICRO_INTERMISSION');
    }
    expect(seen.size).toBe(10);
  });

  it('stamps questionStartedAt, answerOpensAt and answerDeadlineAt from server time', () => {
    const { h } = answeringHarness();
    const round = h.round();
    expect(round.answerOpensAt).toBe(h.state.phaseEnteredAt);
    expect(round.answerDeadlineAt).toBe(round.answerOpensAt! + round.answerMs);
    expect(round.questionStartedAt!).toBeLessThan(round.answerOpensAt!);
  });

  it('keeps the options hidden until ANSWERING and the correct answer hidden until REVEAL', () => {
    const h = new Harness();
    h.joinPlayers(2);
    h.start();
    h.runUntil('QUESTION');
    expect(h.view({ role: 'DISPLAY' }).phaseData).not.toHaveProperty('options');
    h.runUntil('ANSWERING');
    expect(h.view({ role: 'DISPLAY' }).phaseData).toHaveProperty('options');
    expect(JSON.stringify(h.view({ role: 'DISPLAY' }))).not.toContain(
      h.correctOptionId().concat('-correct'),
    );
    expect(h.view({ role: 'DISPLAY' }).phaseData).not.toHaveProperty('correctOptionId');
    h.runUntil('REVEAL');
    expect(h.view({ role: 'DISPLAY' }).phaseData).toHaveProperty(
      'correctOptionId',
      h.correctOptionId(),
    );
  });
});

describe('answer timing (ADR-0006)', () => {
  it('accepts an answer 1 ms before, exactly at the deadline, rejects 1 ms after', () => {
    for (const [offset, expected] of [
      [-1, true],
      [0, true],
      [1, false],
    ] as const) {
      const { h, ids } = answeringHarness();
      const deadline = h.round().answerDeadlineAt!;
      const result = h.answer(ids[0]!, 'correct', deadline + offset);
      expect(result.ok, `offset ${offset}`).toBe(expected);
      if (!expected) expect(result).toEqual({ ok: false, code: 'ANSWER_LATE' });
      if (expected) {
        expect(h.round().answers[ids[0]!]!.remainingMs).toBe(Math.max(0, -offset));
      }
    }
  });

  it('honours a configured latency allowance and not a millisecond more', () => {
    const config = testConfig({ timings: { latencyAllowanceMs: 250 } });
    const { h, ids } = answeringHarness(3, config);
    const deadline = h.round().answerDeadlineAt!;
    expect(h.answer(ids[0]!, 'correct', deadline + 250).ok).toBe(true);
    expect(h.answer(ids[1]!, 'correct', deadline + 251)).toEqual({
      ok: false,
      code: 'ANSWER_LATE',
    });
    // a late-but-allowed answer earns no speed bonus
    expect(h.round().answers[ids[0]!]!.remainingMs).toBe(0);
  });

  it('locks at the first tick strictly after the cut-off, not at the cut-off itself', () => {
    const { h } = answeringHarness();
    const deadline = h.round().answerDeadlineAt!;
    h.tickAt(deadline);
    expect(h.state.phase).toBe('ANSWERING');
    h.tickAt(deadline + 1);
    expect(h.state.phase).toBe('LOCKED');
  });

  it('rejects answers during the reveal and every later phase of the round', () => {
    const { h, ids } = answeringHarness();
    h.runUntil('REVEAL');
    expect(h.answer(ids[0]!, 'correct')).toEqual({ ok: false, code: 'ANSWER_LATE' });
    h.runUntil('SCORE_UPDATE');
    expect(h.answer(ids[0]!, 'correct')).toEqual({ ok: false, code: 'ANSWER_LATE' });
  });

  it('rejects answers before the answer window opens', () => {
    const h = new Harness();
    const ids = h.joinPlayers(2);
    h.start();
    h.runUntil('QUESTION');
    const question = h.round().question!;
    const result = h.command(h.actor(ids[0]!), {
      type: 'SUBMIT_ANSWER',
      payload: { questionId: question.questionId, optionId: question.options[0]!.optionId },
    });
    expect(result).toEqual({ ok: false, code: 'INVALID_STATE' });
  });

  it('first answer wins: duplicates are rejected and change nothing', () => {
    const { h, ids } = answeringHarness();
    expect(h.answer(ids[0]!, 'wrong').ok).toBe(true);
    const before = h.state;
    expect(h.answer(ids[0]!, 'correct')).toEqual({ ok: false, code: 'ANSWER_DUPLICATE' });
    expect(h.state).toBe(before);
    expect(h.round().answers[ids[0]!]!.optionId).toBe(h.wrongOptionId());
  });

  it('rejects the wrong question id, unknown option ids and non-participants', () => {
    const { h, ids } = answeringHarness();
    const question = h.round().question!;
    const actor = h.actor(ids[0]!);
    expect(
      h.command(actor, {
        type: 'SUBMIT_ANSWER',
        payload: { questionId: 'q999', optionId: question.options[0]!.optionId },
      }),
    ).toEqual({ ok: false, code: 'QUESTION_MISMATCH' });
    expect(
      h.command(actor, {
        type: 'SUBMIT_ANSWER',
        payload: { questionId: question.questionId, optionId: 'AAAAAAAAAAAA' },
      }),
    ).toEqual({ ok: false, code: 'OPTION_INVALID' });
    h.command(h.displayActor(), { type: 'KICK_PLAYER', payload: { playerId: ids[1]! } });
    expect(h.answer(ids[1]!, 'correct')).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('clients cannot influence validity with a claimed time: only the server stamp counts', () => {
    const { h, ids } = answeringHarness();
    const question = h.round().question!;
    const deadline = h.round().answerDeadlineAt!;
    const result = h.command(
      h.actor(ids[0]!),
      {
        type: 'SUBMIT_ANSWER',
        payload: {
          questionId: question.questionId,
          optionId: question.options[0]!.optionId,
          clientSentAt: 1,
        },
      },
      deadline + 5_000,
    );
    expect(result).toEqual({ ok: false, code: 'ANSWER_LATE' });
  });
});

describe('early lock', () => {
  it('locks as soon as every eligible player has answered', () => {
    const { h, ids } = answeringHarness(3);
    h.answer(ids[0]!, 'correct');
    h.answer(ids[1]!, 'wrong');
    expect(h.state.phase).toBe('ANSWERING');
    h.answer(ids[2]!, 'correct');
    expect(h.state.phase).toBe('LOCKED');
    expect(h.round().lockedAt).toBe(h.now);
  });

  it('stops waiting for a player who disconnected once their grace expires', () => {
    const { h, ids } = answeringHarness(3);
    h.answer(ids[0]!, 'correct');
    h.answer(ids[1]!, 'correct');
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[2]!, connected: false });
    const lostAt = h.now;
    const grace = h.state.config.timings.earlyLockGraceMs;
    h.tickAt(lostAt + grace - 1);
    expect(h.state.phase).toBe('ANSWERING');
    h.tickAt(lostAt + grace);
    expect(h.state.phase).toBe('LOCKED');
  });

  it('re-evaluates when someone leaves mid-question', () => {
    const { h, ids } = answeringHarness(3);
    h.answer(ids[0]!, 'correct');
    h.answer(ids[1]!, 'correct');
    h.command(h.actor(ids[2]!), { type: 'LEAVE_ROOM', payload: {} });
    expect(h.state.phase).toBe('LOCKED');
    expect(h.state.game!.players[ids[2]!]!.removed).toBe(true);
  });

  it('never locks early when nobody is eligible', () => {
    const { h, ids } = answeringHarness(2);
    for (const id of ids) h.apply({ kind: 'PLAYER_CONNECTION', playerId: id, connected: false });
    h.tickAt(h.now + h.state.config.timings.earlyLockGraceMs + 1);
    expect(h.state.phase).toBe('ANSWERING');
  });
});

describe('scoring flow', () => {
  it('awards speed-weighted points, no penalty for wrong/no answer, and ranks with ties', () => {
    const { h, ids } = answeringHarness(3);
    const [a, b, c] = ids as [string, string, string];
    h.answer(a, 'correct', h.round().answerOpensAt! + 3_000); // 12 s left → +80 speed
    h.answer(b, 'wrong');
    h.runUntil('SCORE_UPDATE');

    const game = h.state.game!;
    expect(game.players[a]!.score).toBe(100 + 80);
    expect(game.players[b]!.score).toBe(0);
    expect(game.players[c]!.score).toBe(0);
    expect(game.players[a]!.streak).toBe(1);

    const view = h.view({ role: 'DISPLAY' }).phaseData;
    expect(view.phase).toBe('SCORE_UPDATE');
    if (view.phase !== 'SCORE_UPDATE') return;
    expect(view.deltas.find((d) => d.playerId === a)).toMatchObject({
      delta: 180,
      total: 180,
      rank: 1,
      previousRank: 1,
    });
    expect(view.scoreboard.map((e) => [e.playerId, e.rank])).toEqual([
      [a, 1],
      [b, 2],
      [c, 2],
    ]);
  });

  it('reveals correctness and the answer distribution only at REVEAL', () => {
    const { h, ids } = answeringHarness(3);
    h.answer(ids[0]!, 'correct');
    h.answer(ids[1]!, 'wrong');
    h.runUntil('REVEAL');
    const data = h.view({ role: 'DISPLAY' }).phaseData;
    expect(data.phase).toBe('REVEAL');
    if (data.phase !== 'REVEAL') return;
    expect(data.results).toEqual([
      { playerId: ids[0], outcome: 'CORRECT', optionId: h.correctOptionId() },
      { playerId: ids[1], outcome: 'INCORRECT', optionId: h.wrongOptionId() },
      { playerId: ids[2], outcome: 'NO_ANSWER', optionId: null },
    ]);
    const counts = Object.fromEntries(
      data.distribution.map((entry) => [entry.optionId, entry.count]),
    );
    expect(counts[h.correctOptionId()]).toBe(1);
    expect(counts[h.wrongOptionId()]).toBe(1);
  });

  it('resets the streak on a miss and tracks the best streak', () => {
    const h = new Harness();
    const [a] = h.joinPlayers(2) as [string, string];
    h.start();
    const streaks: number[] = [];
    for (const kind of ['correct', 'correct', 'wrong', 'correct'] as const) {
      h.runUntil('ANSWERING');
      h.answer(a, kind);
      h.runUntil('SCORE_UPDATE');
      streaks.push(h.state.game!.players[a]!.streak);
    }
    expect(streaks).toEqual([1, 2, 0, 1]);
    expect(h.state.game!.players[a]!.bestStreak).toBe(2);
  });

  it('emits persistence records for the audit trail', () => {
    const { h, ids } = answeringHarness(2);
    h.answer(ids[0]!, 'correct');
    h.runUntil('SCORE_UPDATE');
    const persisted = h.effects.flatMap((e) => (e.kind === 'persist' ? [e.record] : []));
    expect(persisted[0]).toMatchObject({ type: 'GAME_STARTED', totalRounds: 10, configVersion: 1 });
    const round = persisted.find((r) => r.type === 'ROUND_COMPLETED');
    expect(round).toMatchObject({ type: 'ROUND_COMPLETED', roundIndex: 0 });
    if (round?.type === 'ROUND_COMPLETED') {
      const row = round.players.find((p) => p.playerId === ids[0])!;
      expect(row.correct).toBe(true);
      expect(row.totalAfter).toBe(row.delta);
      expect(row.components.reduce((sum, c) => sum + c.points, 0)).toBe(row.delta);
    }
  });
});

describe('final round, results and rematch', () => {
  it('plays a distinct final: intro phase, bigger base, results straight after the score update', () => {
    const h = new Harness();
    h.joinPlayers(2);
    h.start();
    h.runUntil('FINAL');
    const round = h.round();
    expect(round).toMatchObject({
      kind: 'FINAL',
      isFinal: true,
      basePoints: 200,
      answerMs: 12_000,
    });
    h.runUntil('ANSWERING');
    h.answer('p1', 'correct');
    h.runUntil('RESULTS');
    const results = h.state.game!.results!;
    expect(results.ranking[0]!.playerId).toBe('p1');
    expect(results.ranking[0]!.rank).toBe(1);
    expect(h.state.phaseDeadlineAt).toBeNull();
  });

  it('hands out awards that point at real players', () => {
    const h = new Harness();
    const [a] = h.joinPlayers(2) as [string, string];
    h.start();
    for (let i = 0; i < 10; i++) {
      h.runUntil('ANSWERING');
      h.answer(a, 'correct');
      h.runUntil(i === 9 ? 'RESULTS' : 'MICRO_INTERMISSION');
    }
    const awards = h.state.game!.results!.awards;
    expect(awards.map((x) => x.kind)).toContain('SHARPSHOOTER');
    expect(awards.map((x) => x.kind)).toContain('STREAK_MASTER');
    for (const award of awards) expect(h.state.players[award.playerId]).toBeDefined();
  });

  it('rematch keeps the players, resets scores and starts a fresh game', () => {
    const h = new Harness();
    const [a] = h.joinPlayers(2) as [string, string];
    h.start();
    h.runUntil('ANSWERING');
    h.answer(a, 'correct');
    h.runUntil('RESULTS');
    const oldGame = h.state.game!.gameId;
    expect(h.state.game!.players[a]!.score).toBeGreaterThan(0);

    expect(h.command(h.actor(a), { type: 'REMATCH', payload: {} }).ok).toBe(true);
    expect(h.state.phase).toBe('COUNTDOWN');
    expect(h.state.game!.gameId).not.toBe(oldGame);
    expect(h.state.game!.players[a]!.score).toBe(0);
    expect(h.state.game!.results).toBeNull();
    expect(h.state.playerOrder).toHaveLength(2);
  });

  it('back-to-lobby clears the game but keeps players and settings', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    h.command(h.actor(a), { type: 'SET_SETTINGS', payload: { rounds: 5 } });
    h.start();
    h.runUntil('RESULTS');
    expect(h.command(h.actor(b), { type: 'BACK_TO_LOBBY', payload: {} })).toEqual({
      ok: false,
      code: 'NOT_HOST',
    });
    expect(h.command(h.actor(a), { type: 'BACK_TO_LOBBY', payload: {} }).ok).toBe(true);
    expect(h.state.phase).toBe('LOBBY');
    expect(h.state.game).toBeNull();
    expect(h.state.settings.rounds).toBe(5);
    expect(h.start().ok).toBe(true);
    expect(h.state.game!.totalRounds).toBe(5);
  });

  it('plays a minimal 3-round game ending with the final', () => {
    const h = new Harness();
    const [a] = h.joinPlayers(2) as [string, string];
    h.command(h.actor(a), { type: 'SET_SETTINGS', payload: { rounds: 3 } });
    h.start();
    h.runUntil('RESULTS');
    expect(h.state.game!.roundIndex).toBe(2);
    expect(h.state.game!.round!.kind).toBe('FINAL');
  });
});

describe('display handling', () => {
  it('holds at a round boundary while the display is gone, and resumes when it returns', () => {
    const h = new Harness();
    h.joinPlayers(2);
    h.start();
    h.runUntil('ANSWERING');
    h.apply({ kind: 'DISPLAY_CONNECTION', connected: false });
    const lostAt = h.now;
    h.runUntil('MICRO_INTERMISSION');
    h.tickAt(h.state.phaseDeadlineAt!);
    expect(h.state.awaitingDisplay).toBe(true);
    expect(h.state.phase).toBe('MICRO_INTERMISSION');
    expect(h.state.phaseDeadlineAt).toBeNull();
    expect(h.now - lostAt).toBeGreaterThanOrEqual(h.state.config.timings.displayGraceMs);
    expect(h.events('DISPLAY_STATUS').at(-1)?.payload).toEqual({
      connected: false,
      awaitingDisplay: true,
    });

    const roundBefore = h.state.game!.roundIndex;
    h.apply({ kind: 'DISPLAY_CONNECTION', connected: true });
    expect(h.state.awaitingDisplay).toBe(false);
    h.runUntil('ROUND_INTRO');
    expect(h.state.game!.roundIndex).toBe(roundBefore + 1);
  });

  it('keeps playing through a short display outage without holding', () => {
    const { h } = answeringHarness();
    h.apply({ kind: 'DISPLAY_CONNECTION', connected: false });
    h.tickAt(h.now + 5_000);
    h.apply({ kind: 'DISPLAY_CONNECTION', connected: true });
    h.runUntil('ROUND_INTRO');
    expect(h.state.awaitingDisplay).toBe(false);
  });

  it('abandons the room when the display never returns', () => {
    const { h } = answeringHarness();
    h.apply({ kind: 'DISPLAY_CONNECTION', connected: false });
    h.tickAt(h.now + h.state.config.timings.abandonMs);
    expect(h.state.closed?.reason).toBe('ABANDONED');
  });
});

describe('crash recovery (ADR-0006)', () => {
  it('freezes the clock across an outage: answers survive and deadlines shift', () => {
    const { h, ids } = answeringHarness(3);
    const opens = h.round().answerOpensAt!;
    h.answer(ids[0]!, 'correct', opens + 2_000);
    const deadline = h.round().answerDeadlineAt!;
    const remainingBefore = h.round().answers[ids[0]!]!.remainingMs;

    const outage = 7_000;
    h.apply({ kind: 'RECOVER', outageMs: outage }, h.now + outage);
    expect(h.round().answerDeadlineAt).toBe(deadline + outage);
    expect(h.round().answerOpensAt).toBe(opens + outage);
    expect(h.round().answers[ids[0]!]!.remainingMs).toBe(remainingBefore);
    expect(h.state.players[ids[1]!]!.connection).toBe('DISCONNECTED');

    // after reconnecting, a slower player still gets exactly the time they had left
    for (const id of ids) h.apply({ kind: 'PLAYER_CONNECTION', playerId: id, connected: true });
    const lateButValid = h.round().answerDeadlineAt! - 1;
    expect(h.answer(ids[1]!, 'correct', lateButValid).ok).toBe(true);
    expect(h.answer(ids[2]!, 'correct', h.round().answerDeadlineAt! + 1)).toEqual({
      ok: false,
      code: 'ANSWER_LATE',
    });
  });

  it('closes rooms whose outage exceeded the recoverable limit and keeps their scores', () => {
    const { h, ids } = answeringHarness(2);
    h.answer(ids[0]!, 'correct');
    h.apply({ kind: 'RECOVER', outageMs: h.state.config.timings.maxRecoverableOutageMs + 1 });
    expect(h.state.closed?.reason).toBe('INTERRUPTED');
    expect(h.state.phase).toBe('ROOM_CLOSED');
  });

  it('replaying the logged inputs reproduces the exact state', () => {
    const h = new Harness();
    const ids = h.joinPlayers(4);
    h.start();
    let n = 0;
    for (let round = 0; round < 10; round++) {
      h.runUntil('ANSWERING');
      for (const id of ids) {
        n += 1;
        if (n % 5 === 0) continue; // some players stay silent
        h.answer(
          id,
          n % 3 === 0 ? 'wrong' : 'correct',
          h.round().answerOpensAt! + ((n * 977) % 14_000),
        );
      }
      h.runUntil(round === 9 ? 'RESULTS' : 'MICRO_INTERMISSION');
    }
    h.command(h.actor(ids[0]!), { type: 'REMATCH', payload: {} });
    h.runUntil('ANSWERING');

    let replay = createRoom({
      roomId: TEST_ROOM_ID,
      code: 'ABC234',
      displaySessionId: h.displaySessionId,
      now: 1_700_000_000_000,
      config: testConfig(),
      tier: 'FULL',
    });
    for (const input of h.inputs) replay = reduce(replay, input).state;
    expect(JSON.parse(JSON.stringify(replay))).toEqual(JSON.parse(JSON.stringify(h.state)));
    expect(replay.version).toBe(h.state.version);
  });
});

describe('players leaving a running game', () => {
  it('drops them from the scoreboard and results', () => {
    const h = new Harness();
    const [a, b, c] = h.joinPlayers(3) as [string, string, string];
    h.start();
    h.runUntil('ANSWERING');
    h.answer(c, 'correct');
    h.command(h.actor(c), { type: 'LEAVE_ROOM', payload: {} });
    h.runUntil('RESULTS');
    const ranked = h.state.game!.results!.ranking.map((r) => r.playerId);
    expect(ranked).toEqual(expect.arrayContaining([a, b]));
    expect(ranked).not.toContain(c);
  });

  it('closes the room when everybody has left mid-game', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    h.start();
    h.runUntil('ANSWERING');
    h.command(h.actor(a), { type: 'LEAVE_ROOM', payload: {} });
    h.command(h.actor(b), { type: 'LEAVE_ROOM', payload: {} });
    expect(h.state.closed?.reason).toBe('ABANDONED');
  });
});

describe('deck handling', () => {
  it('ends gracefully with the rounds played if the deck cannot supply a question', () => {
    const h = new Harness();
    h.joinPlayers(2);
    h.command(h.displayActor(), { type: 'SET_SETTINGS', payload: { rounds: 3 } });
    h.startWith(makeDeck(3));
    h.runUntil('RESULTS');
    expect(h.state.phase).toBe('RESULTS');
  });
});
