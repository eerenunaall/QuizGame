import { describe, expect, it } from 'vitest';
import type { ClientPayload, ErrorCode, SabotageKind, ServerEvent } from '@quizparty/protocol';
import type { CommandResult } from './types';
import { Harness, testConfig } from './testing';

type Commit = ClientPayload<'COMMIT_PREP'>;

const commitOf = (patch: Partial<Commit> = {}): Commit => ({
  stake: 'SAFE',
  doubleDown: false,
  sabotage: null,
  ...patch,
});

function setup(players = 3, override: unknown = {}) {
  const h = new Harness({ config: testConfig(override) });
  const ids = h.joinPlayers(players);
  h.start();
  return { h, ids };
}

const commit = (h: Harness, playerId: string, patch: Partial<Commit> = {}): CommandResult =>
  h.command(h.actor(playerId), { type: 'COMMIT_PREP', payload: commitOf(patch) });

const fiftyFifty = (h: Harness, playerId: string): CommandResult =>
  h.command(h.actor(playerId), { type: 'USE_FIFTY_FIFTY', payload: {} });

const refusal = (result: CommandResult): ErrorCode | 'OK' => (result.ok ? 'OK' : result.code);

/** Runs the game (nobody commits or answers) until round `index` is in QUESTION_PREP. */
function toPrep(h: Harness, index: number): void {
  for (let guard = 0; guard < 40; guard++) {
    h.runUntil('QUESTION_PREP');
    if (h.round().index === index) return;
    h.runUntil('SCORE_UPDATE');
  }
  throw new Error(`never reached round ${index}`);
}

/** Plays rounds up to (not including) `index`, answering correctly with the given players. */
function playCorrect(h: Harness, until: number, answerers: string[]): void {
  for (let guard = 0; guard < 40; guard++) {
    h.runUntil('QUESTION_PREP');
    if (h.round().index >= until) return;
    h.runUntil('ANSWERING');
    for (const id of answerers) h.answer(id, 'correct');
    h.runUntil('SCORE_UPDATE');
  }
  throw new Error('did not reach the target round');
}

const youOf = (h: Harness, playerId: string) => h.view({ role: 'PLAYER', playerId }).you!;
const prepData = (h: Harness) => {
  const data = h.view({ role: 'DISPLAY' }).phaseData;
  if (data.phase !== 'QUESTION_PREP') throw new Error(`not in prep: ${data.phase}`);
  return data;
};
const eventsOf = (h: Harness, type: ServerEvent['type']) => h.events(type);

describe('QUESTION_PREP offers', () => {
  it('shows the ladder with its rules, and what is on offer this round', () => {
    const { h } = setup();
    h.runUntil('QUESTION_PREP');
    const data = prepData(h);
    expect(data.riskLadder).toEqual([
      { tier: 'SAFE', multiplier: 1, loss: 0 },
      { tier: 'RISK', multiplier: 2, loss: 100 },
      { tier: 'HIGH', multiplier: 3, loss: 200 },
    ]);
    expect(data.stakeMandatory).toBe(false);
    expect(data.doubleDownEnabled).toBe(true);
    expect(data.sabotageEnabled).toBe(false); // round 1: sabotage opens at round 3
    expect(data).toMatchObject({ committedCount: 0, eligibleCount: 3 });
  });

  it('opens sabotage from the third round and closes it for the final stage', () => {
    const { h } = setup();
    toPrep(h, 2);
    expect(prepData(h).sabotageEnabled).toBe(true);
    toPrep(h, 7); // final stage of a 10-round game starts at round 8 (index 7)
    expect(h.round().kind).toBe('FINAL');
    expect(prepData(h).sabotageEnabled).toBe(false);
  });

  it('makes the stake mandatory, with no SAFE rung, on the very last question only', () => {
    const { h } = setup();
    toPrep(h, 8);
    expect(prepData(h)).toMatchObject({ stakeMandatory: false }); // final stage, but not the last
    toPrep(h, 9);
    const last = prepData(h);
    expect(last.stakeMandatory).toBe(true);
    expect(last.riskLadder.map((rung) => rung.tier)).toEqual(['RISK', 'HIGH', 'ALL_IN']);
  });

  it('gives risk and final rounds a longer decision window than ordinary ones', () => {
    const { h } = setup(3, {
      timings: { prepMs: 1000, prepQuickMs: 2000, prepDecisionMs: 5000 },
    });
    h.runUntil('QUESTION_PREP');
    expect(h.state.phaseDeadlineAt! - h.state.phaseEnteredAt).toBe(2000);
    toPrep(h, 7);
    expect(h.state.phaseDeadlineAt! - h.state.phaseEnteredAt).toBe(5000);
  });

  it('falls back to the short window when nothing can be chosen', () => {
    const config = testConfig({
      timings: { prepMs: 1000, prepQuickMs: 2000 },
      powers: { doubleDownPerGame: 0, sabotage: { enabled: false } },
    });
    // The ladder merge only adds rungs, so replace the ordinary ladder outright.
    config.scoring.ladders.STANDARD = { SAFE: { multiplier: 1, loss: 0 } };
    const h = new Harness({ config });
    h.joinPlayers(3);
    h.start();
    h.runUntil('QUESTION_PREP');
    expect(h.state.phaseDeadlineAt! - h.state.phaseEnteredAt).toBe(1000);
  });
});

describe('COMMIT_PREP', () => {
  it('is accepted once, and only in QUESTION_PREP', () => {
    const { h, ids } = setup();
    h.runUntil('ROUND_INTRO');
    expect(refusal(commit(h, ids[0]!))).toBe('INVALID_STATE');
    h.runUntil('QUESTION_PREP');
    expect(refusal(commit(h, ids[0]!, { stake: 'RISK' }))).toBe('OK');
    expect(refusal(commit(h, ids[0]!, { stake: 'HIGH' }))).toBe('ALREADY_COMMITTED');
    expect(h.round().commitments[ids[0]!]!.stake).toBe('RISK'); // the first choice stands
    h.runUntil('ANSWERING');
    expect(refusal(commit(h, ids[1]!))).toBe('INVALID_STATE');
  });

  it('is for players: the display cannot commit', () => {
    const { h } = setup();
    h.runUntil('QUESTION_PREP');
    const result = h.command(h.displayActor(), { type: 'COMMIT_PREP', payload: commitOf() });
    expect(refusal(result)).toBe('FORBIDDEN');
  });

  it('refuses a stake the ladder does not offer', () => {
    const { h, ids } = setup();
    h.runUntil('QUESTION_PREP');
    expect(refusal(commit(h, ids[0]!, { stake: 'ALL_IN' }))).toBe('STAKE_INVALID');
    toPrep(h, 9);
    expect(refusal(commit(h, ids[0]!, { stake: 'SAFE' }))).toBe('STAKE_INVALID');
    expect(refusal(commit(h, ids[0]!, { stake: 'ALL_IN' }))).toBe('OK');
  });

  it('is all-or-nothing: a refused part spends nothing', () => {
    const { h, ids } = setup();
    h.runUntil('QUESTION_PREP');
    // Sabotage is closed in round 1, so the Double Down in the same message must not be spent either.
    const result = commit(h, ids[0]!, {
      doubleDown: true,
      sabotage: { targetId: ids[1]!, effect: 'JAM' },
    });
    expect(refusal(result)).toBe('POWER_UNAVAILABLE');
    expect(youOf(h, ids[0]!).powers).toMatchObject({ doubleDown: 2, sabotageTokens: 1 });
    expect(youOf(h, ids[0]!).commitment).toBeNull();
    expect(commit(h, ids[0]!, { doubleDown: true }).ok).toBe(true);
    expect(youOf(h, ids[0]!).powers!.doubleDown).toBe(1);
  });

  it('keeps choices private: others see counts, never the choices', () => {
    const { h, ids } = setup();
    h.runUntil('QUESTION_PREP');
    commit(h, ids[0]!, { stake: 'HIGH', doubleDown: true });
    expect(youOf(h, ids[0]!).commitment).toEqual({
      stake: 'HIGH',
      doubleDown: true,
      sabotage: null,
    });
    expect(youOf(h, ids[1]!).commitment).toBeNull();
    // Others see that someone decided, never what: no commitment appears in any other view or event.
    const others = JSON.stringify([
      h.view({ role: 'DISPLAY' }),
      h.view({ role: 'PLAYER', playerId: ids[1]! }),
      eventsOf(h, 'PREP_PROGRESS'),
    ]);
    expect(others).not.toContain('"doubleDown":true');
    expect(others).not.toContain('"commitment":{');
    expect(prepData(h).committedCount).toBe(1);
    expect(eventsOf(h, 'PREP_PROGRESS').at(-1)).toMatchObject({
      payload: { committedCount: 1, eligibleCount: 3 },
    });
  });

  it('moves on as soon as everyone online has decided', () => {
    const { h, ids } = setup(3, { timings: { prepQuickMs: 20_000 } });
    h.runUntil('QUESTION_PREP');
    const entered = h.now;
    commit(h, ids[0]!);
    commit(h, ids[1]!);
    expect(h.state.phase).toBe('QUESTION_PREP');
    commit(h, ids[2]!);
    expect(h.state.phase).toBe('QUESTION');
    expect(h.now).toBe(entered); // no waiting for the 20 s window
    expect(h.round().question).not.toBeNull();
  });

  it('does not wait for a player who is offline', () => {
    const { h, ids } = setup(3, { timings: { prepQuickMs: 20_000 } });
    h.runUntil('QUESTION_PREP');
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[2]!, connected: false });
    commit(h, ids[0]!);
    commit(h, ids[1]!);
    expect(h.state.phase).toBe('QUESTION');
  });
});

describe('stakes and Double Down in the score', () => {
  const FINAL_FREE = { director: { maxRiskRounds: 0 } };

  it('a RISK stake pays double and a wrong answer costs the stake', () => {
    const { h, ids } = setup(3, FINAL_FREE);
    h.runUntil('QUESTION_PREP');
    commit(h, ids[0]!, { stake: 'RISK' });
    commit(h, ids[1]!, { stake: 'RISK' });
    // The third player stays at the default (SAFE).
    h.runUntil('ANSWERING');
    h.answer(ids[0]!, 'correct');
    h.answer(ids[1]!, 'wrong');
    h.answer(ids[2]!, 'correct');
    h.runUntil('SCORE_UPDATE');
    const deltas = Object.fromEntries(
      (
        h.view({ role: 'DISPLAY' }).phaseData as { deltas: { playerId: string; delta: number }[] }
      ).deltas.map((d) => [d.playerId, d.delta]),
    );
    // Everyone answers the instant the window opens, so speed is the same for all: 100 each.
    expect(deltas[ids[0]!]).toBe(2 * 100 + 100); // RISK pays 2 × base plus speed
    expect(deltas[ids[2]!]).toBe(100 + 100); // SAFE pays base plus speed
    // A wrong answer at RISK costs 100 but never below zero: the player had 0 points.
    expect(deltas[ids[1]!]).toBe(0);
  });

  it('a wrong answer costs the stake when there are points to lose', () => {
    const { h, ids } = setup(2, FINAL_FREE);
    playCorrect(h, 1, [ids[0]!, ids[1]!]);
    h.runUntil('QUESTION_PREP');
    const before = h.state.game!.players[ids[0]!]!.score;
    expect(before).toBeGreaterThan(100);
    commit(h, ids[0]!, { stake: 'HIGH' });
    h.runUntil('ANSWERING');
    h.answer(ids[0]!, 'wrong');
    h.runUntil('SCORE_UPDATE');
    expect(h.state.game!.players[ids[0]!]!.score).toBe(before - 200);
  });

  it('silence while connected with a stake riding is a loss', () => {
    const { h, ids } = setup(2, FINAL_FREE);
    playCorrect(h, 1, [ids[0]!, ids[1]!]);
    h.runUntil('QUESTION_PREP');
    const before = h.state.game!.players[ids[0]!]!.score;
    commit(h, ids[0]!, { stake: 'RISK' });
    h.runUntil('SCORE_UPDATE'); // never answers
    expect(h.state.game!.players[ids[0]!]!.score).toBe(before - 100);
  });

  it('Double Down doubles a gain, adds a loss when wrong, and is spent either way', () => {
    const { h, ids } = setup(2, FINAL_FREE);
    playCorrect(h, 1, [ids[0]!, ids[1]!]);
    h.runUntil('QUESTION_PREP');
    const before = h.state.game!.players[ids[0]!]!.score;
    commit(h, ids[0]!, { doubleDown: true });
    h.runUntil('ANSWERING');
    h.answer(ids[0]!, 'wrong');
    h.runUntil('SCORE_UPDATE');
    // Default extra loss 100 (the base of a standard question).
    expect(h.state.game!.players[ids[0]!]!.score).toBe(before - 100);
    expect(youOf(h, ids[0]!).powers!.doubleDown).toBe(1);
  });

  it('allows two Double Downs a game and refuses a third', () => {
    const { h, ids } = setup(2, FINAL_FREE);
    for (let round = 0; round < 3; round++) {
      h.runUntil('QUESTION_PREP');
      const result = commit(h, ids[0]!, { doubleDown: true });
      expect(refusal(result)).toBe(round < 2 ? 'OK' : 'POWER_UNAVAILABLE');
      h.runUntil('SCORE_UPDATE');
    }
  });

  it('stake and Double Down stack: the cap still holds', () => {
    const { h, ids } = setup(2, FINAL_FREE);
    h.runUntil('QUESTION_PREP');
    commit(h, ids[0]!, { stake: 'HIGH', doubleDown: true });
    h.runUntil('ANSWERING');
    h.answer(ids[0]!, 'correct');
    h.runUntil('SCORE_UPDATE');
    const delta = h.state.game!.players[ids[0]!]!.score;
    expect(delta).toBeLessThanOrEqual(1500); // maxGainPerQuestion
    expect(delta).toBeGreaterThan(600); // (3 × 100 + speed) × 2
  });
});

describe('50/50', () => {
  it('leaves the correct option and one wrong one, and refuses the removed options', () => {
    const { h, ids } = setup();
    h.runUntil('ANSWERING');
    expect(fiftyFifty(h, ids[0]!).ok).toBe(true);
    const keep = youOf(h, ids[0]!).fiftyFifty!.keep;
    expect(keep).toHaveLength(2);
    expect(keep).toContain(h.correctOptionId());
    const removed = h.round().question!.options.find((o) => !keep.includes(o.optionId))!;
    expect(refusal(h.answer(ids[0]!, removed.optionId))).toBe('OPTION_INVALID');
    expect(h.answer(ids[0]!, 'correct').ok).toBe(true);
  });

  it('is private and shared: the same pair for everyone who uses it, nothing for anyone else', () => {
    const { h, ids } = setup();
    h.runUntil('ANSWERING');
    fiftyFifty(h, ids[0]!);
    fiftyFifty(h, ids[1]!);
    expect(youOf(h, ids[1]!).fiftyFifty).toEqual(youOf(h, ids[0]!).fiftyFifty);
    expect(youOf(h, ids[2]!).fiftyFifty).toBeNull();
    expect(JSON.stringify(h.view({ role: 'DISPLAY' }))).not.toContain(
      youOf(h, ids[0]!).fiftyFifty!.keep[0]!.concat('x'),
    );
    expect(h.view({ role: 'DISPLAY' }).you).toBeNull();
  });

  it('can be used once a game, and not after answering or outside ANSWERING', () => {
    const { h, ids } = setup();
    h.runUntil('QUESTION');
    expect(refusal(fiftyFifty(h, ids[0]!))).toBe('INVALID_STATE');
    h.runUntil('ANSWERING');
    h.answer(ids[1]!, 'correct');
    expect(refusal(fiftyFifty(h, ids[1]!))).toBe('INVALID_STATE'); // already answered
    expect(fiftyFifty(h, ids[0]!).ok).toBe(true);
    expect(refusal(fiftyFifty(h, ids[0]!))).toBe('POWER_UNAVAILABLE'); // same round
    expect(youOf(h, ids[0]!).powers!.fiftyFifty).toBe(0);
    h.runUntil('SCORE_UPDATE');
    h.runUntil('ANSWERING');
    expect(refusal(fiftyFifty(h, ids[0]!))).toBe('POWER_UNAVAILABLE'); // next round: used up
    expect(fiftyFifty(h, ids[2]!).ok).toBe(true); // others still have theirs
  });

  it('halves a gain by default (ADR-0007) and shows in the audit trail', () => {
    const { h, ids } = setup(2);
    h.runUntil('ANSWERING');
    fiftyFifty(h, ids[0]!);
    h.answer(ids[0]!, 'correct');
    h.answer(ids[1]!, 'correct');
    h.runUntil('SCORE_UPDATE');
    const update = h.view({ role: 'DISPLAY' }).phaseData as {
      deltas: { playerId: string; delta: number; components: { kind: string }[] }[];
    };
    const mine = update.deltas.find((d) => d.playerId === ids[0]!)!;
    const other = update.deltas.find((d) => d.playerId === ids[1]!)!;
    expect(mine.components.map((c) => c.kind)).toContain('FIFTY_FIFTY');
    expect(mine.delta).toBeLessThan(other.delta);
    expect(mine.delta).toBe(Math.floor(other.delta / 2));
  });
});

describe('sabotage rules', () => {
  const attack = (
    h: Harness,
    from: string,
    to: string,
    effect: SabotageKind = 'JAM',
    joker?: 'FIFTY_FIFTY' | 'DOUBLE_DOWN',
  ) =>
    commit(h, from, {
      sabotage: { targetId: to, effect, ...(joker ? { joker } : {}) },
    });

  it('costs a token, and everyone starts with one', () => {
    const { h, ids } = setup();
    toPrep(h, 2);
    expect(youOf(h, ids[0]!).powers!.sabotageTokens).toBe(1);
    expect(refusal(attack(h, ids[0]!, ids[1]!))).toBe('OK');
    expect(youOf(h, ids[0]!).powers!.sabotageTokens).toBe(0);
  });

  it('cannot be aimed at yourself, a stranger or someone who left', () => {
    const { h, ids } = setup();
    toPrep(h, 2);
    expect(refusal(attack(h, ids[0]!, ids[0]!))).toBe('TARGET_INVALID');
    expect(refusal(attack(h, ids[0]!, 'nobody'))).toBe('TARGET_INVALID');
    h.command(h.actor(ids[2]!), { type: 'LEAVE_ROOM', payload: {} });
    expect(refusal(attack(h, ids[0]!, ids[2]!))).toBe('TARGET_INVALID');
    expect(youOf(h, ids[0]!).powers!.sabotageTokens).toBe(1); // nothing was spent
  });

  it('needs a token', () => {
    const { h, ids } = setup(4);
    toPrep(h, 2);
    attack(h, ids[0]!, ids[1]!);
    h.runUntil('SCORE_UPDATE');
    toPrep(h, 3);
    expect(refusal(attack(h, ids[0]!, ids[2]!))).toBe('POWER_UNAVAILABLE'); // out of tokens
  });

  it('limits sabotage per round and per target', () => {
    const { h, ids } = setup(5);
    toPrep(h, 2);
    expect(refusal(attack(h, ids[0]!, ids[3]!))).toBe('OK');
    expect(refusal(attack(h, ids[1]!, ids[3]!))).toBe('SABOTAGE_LIMIT'); // same target twice
    expect(refusal(attack(h, ids[1]!, ids[4]!))).toBe('OK');
    expect(refusal(attack(h, ids[2]!, ids[0]!))).toBe('SABOTAGE_LIMIT'); // two a round at most
  });

  it('spaces hits on the same target and caps them per game', () => {
    const { h, ids } = setup(3, {
      powers: { sabotage: { startTokens: 2, maxTokens: 2, attackerCooldownRounds: 0 } },
    });
    toPrep(h, 2);
    expect(refusal(attack(h, ids[0]!, ids[2]!))).toBe('OK');
    h.runUntil('SCORE_UPDATE');
    toPrep(h, 3);
    expect(refusal(attack(h, ids[1]!, ids[2]!))).toBe('SABOTAGE_LIMIT'); // hit last round
    h.runUntil('SCORE_UPDATE');
    toPrep(h, 4);
    expect(refusal(attack(h, ids[1]!, ids[2]!))).toBe('SABOTAGE_LIMIT'); // gap 2 rounds not over yet
    h.runUntil('SCORE_UPDATE');
    toPrep(h, 5);
    expect(refusal(attack(h, ids[1]!, ids[2]!))).toBe('OK');
  });

  it('cools the attacker down for two rounds', () => {
    const { h, ids } = setup(4, {
      powers: { sabotage: { startTokens: 2, maxTokens: 2 } },
    });
    toPrep(h, 2);
    attack(h, ids[0]!, ids[1]!);
    h.runUntil('SCORE_UPDATE');
    toPrep(h, 3);
    expect(refusal(attack(h, ids[0]!, ids[2]!))).toBe('SABOTAGE_LIMIT');
    h.runUntil('SCORE_UPDATE');
    toPrep(h, 4);
    expect(refusal(attack(h, ids[0]!, ids[2]!))).toBe('SABOTAGE_LIMIT');
    h.runUntil('SCORE_UPDATE');
    toPrep(h, 5);
    expect(refusal(attack(h, ids[0]!, ids[2]!))).toBe('OK');
  });

  it('earns a token at streak 3, never holds more than two, and never in the first rounds', () => {
    const { h, ids } = setup(3);
    toPrep(h, 0);
    expect(refusal(attack(h, ids[0]!, ids[1]!))).toBe('POWER_UNAVAILABLE'); // round 1
    playCorrect(h, 3, [ids[0]!]);
    h.runUntil('QUESTION_PREP');
    expect(youOf(h, ids[0]!).powers).toMatchObject({ sabotageTokens: 2, nextTokenAtStreak: 6 });
    expect(youOf(h, ids[1]!).powers).toMatchObject({ sabotageTokens: 1, nextTokenAtStreak: 3 });
  });

  it('is closed in the final stage', () => {
    const { h, ids } = setup();
    toPrep(h, 7);
    expect(refusal(attack(h, ids[0]!, ids[1]!))).toBe('POWER_UNAVAILABLE');
  });

  it('can be switched off by configuration', () => {
    const { h, ids } = setup(3, { powers: { sabotage: { enabled: false } } });
    toPrep(h, 2);
    expect(prepData(h).sabotageEnabled).toBe(false);
    expect(refusal(attack(h, ids[0]!, ids[1]!))).toBe('POWER_UNAVAILABLE');
  });
});

describe('sabotage effects', () => {
  // Every player owns one shield that blocks the first hit; effects are tested without it.
  const bare = (players = 3, extra: Record<string, unknown> = {}) =>
    setup(players, {
      ...extra,
      powers: {
        shieldPerGame: 0,
        ...((extra.powers as Record<string, unknown> | undefined) ?? {}),
      },
    });
  const sabotage = (
    h: Harness,
    from: string,
    to: string,
    effect: SabotageKind,
    joker?: 'FIFTY_FIFTY' | 'DOUBLE_DOWN',
  ) => commit(h, from, { sabotage: { targetId: to, effect, ...(joker ? { joker } : {}) } });

  it("JAM shortens only the target's window, by a bounded amount", () => {
    const { h, ids } = bare();
    toPrep(h, 2);
    sabotage(h, ids[0]!, ids[1]!, 'JAM');
    h.runUntil('ANSWERING');
    const window = h.round().answerMs;
    const jam = youOf(h, ids[1]!).effects!.jamMs;
    expect(jam).toBe(Math.min(2000, Math.floor(window * 0.15)));
    expect(jam).toBeLessThanOrEqual(window * 0.2); // never below 80 % of the window
    expect(youOf(h, ids[2]!).effects).toBeNull();
    expect(youOf(h, ids[1]!).hits).toEqual([{ effect: 'JAM', blocked: false }]);
    expect(youOf(h, ids[0]!).hits).toEqual([]);

    const deadline = h.round().answerDeadlineAt!;
    expect(refusal(h.answer(ids[1]!, 'correct', deadline - jam + 1))).toBe('ANSWER_LATE');
    expect(refusal(h.answer(ids[2]!, 'correct', deadline - jam + 1))).toBe('OK');
    expect(refusal(h.answer(ids[1]!, 'correct', deadline - jam))).toBe('OK');
    // The jammed player's remaining time is counted on their own, shorter clock.
    expect(h.round().answers[ids[1]!]!.remainingMs).toBe(0);
  });

  it('SHUFFLE gives the target their own order of the same options', () => {
    const { h, ids } = bare();
    toPrep(h, 2);
    sabotage(h, ids[0]!, ids[1]!, 'SHUFFLE');
    h.runUntil('ANSWERING');
    const original = h.round().question!.options.map((o) => o.optionId);
    const order = youOf(h, ids[1]!).effects!.order!;
    expect([...order].sort()).toEqual([...original].sort());
    expect(order).not.toEqual(original);
    expect(youOf(h, ids[1]!).effects!.jamMs).toBe(0);
    // Correctness is untouched: the same option ids are right for everyone.
    expect(h.answer(ids[1]!, 'correct').ok).toBe(true);
  });

  it('FOG hides one option, chosen without regard to the answer, for the first moments', () => {
    const { h, ids } = bare();
    toPrep(h, 2);
    sabotage(h, ids[0]!, ids[1]!, 'FOG');
    h.runUntil('ANSWERING');
    const fx = youOf(h, ids[1]!).effects!;
    expect(h.round().question!.options.map((o) => o.optionId)).toContain(fx.fogOptionId);
    expect(fx.fogMs).toBe(1500);
    expect(fx.jamMs).toBe(0);
  });

  it('players who asked for reduced effects get a half-strength JAM instead of SHUFFLE or FOG', () => {
    for (const effect of ['SHUFFLE', 'FOG'] as const) {
      const { h, ids } = bare();
      h.command(h.actor(ids[1]!), { type: 'SET_PREFERENCES', payload: { reducedEffects: true } });
      expect(youOf(h, ids[1]!).reducedEffects).toBe(true);
      toPrep(h, 2);
      sabotage(h, ids[0]!, ids[2]!, effect); // someone else: full effect
      sabotage(h, ids[2]!, ids[1]!, effect);
      h.runUntil('ANSWERING');
      const softened = youOf(h, ids[1]!).effects!;
      expect(softened.order).toBeNull();
      expect(softened.fogOptionId).toBeNull();
      const full = Math.min(2000, Math.floor(h.round().answerMs * 0.15));
      expect(softened.jamMs).toBe(Math.floor(full / 2));
      // The attacker's view is identical either way: the setting is never disclosed.
      expect(youOf(h, ids[2]!).hits).toEqual([{ effect, blocked: false }]);
      expect(youOf(h, ids[0]!).reducedEffects).toBe(false);
    }
  });

  it('LOCKOUT blocks one joker next round, does not consume it, and cannot chain', () => {
    const { h, ids } = bare(4, { powers: { sabotage: { startTokens: 2, maxTokens: 2 } } });
    toPrep(h, 2);
    expect(refusal(sabotage(h, ids[0]!, ids[1]!, 'LOCKOUT'))).toBe('POWER_UNAVAILABLE'); // needs a joker
    expect(refusal(sabotage(h, ids[0]!, ids[1]!, 'LOCKOUT', 'DOUBLE_DOWN'))).toBe('OK');
    h.runUntil('SCORE_UPDATE');
    toPrep(h, 3);
    const you = youOf(h, ids[1]!);
    expect(you.powers).toMatchObject({ lockedJoker: 'DOUBLE_DOWN', doubleDown: 2 }); // not consumed
    expect(refusal(commit(h, ids[1]!, { doubleDown: true }))).toBe('POWER_LOCKED_OUT');
    expect(youOf(h, ids[1]!).powers!.doubleDown).toBe(2);
    expect(commit(h, ids[1]!, { stake: 'RISK' }).ok).toBe(true); // the rest of the PREP is open
    // A lockout that holds this round cannot be extended into the next one.
    expect(refusal(sabotage(h, ids[2]!, ids[1]!, 'LOCKOUT', 'DOUBLE_DOWN'))).toBe('SABOTAGE_LIMIT');
    h.runUntil('SCORE_UPDATE');
    toPrep(h, 4);
    expect(youOf(h, ids[1]!).powers!.lockedJoker).toBeNull();
    expect(commit(h, ids[1]!, { doubleDown: true }).ok).toBe(true);
  });

  it('LOCKOUT on 50/50 refuses it during the next round only', () => {
    const { h, ids } = bare();
    toPrep(h, 2);
    sabotage(h, ids[0]!, ids[1]!, 'LOCKOUT', 'FIFTY_FIFTY');
    h.runUntil('ANSWERING');
    expect(fiftyFifty(h, ids[1]!).ok).toBe(true); // this round is not locked
    h.runUntil('SCORE_UPDATE');
    h.runUntil('ANSWERING');
    expect(refusal(fiftyFifty(h, ids[1]!))).toBe('POWER_UNAVAILABLE'); // used up above
    expect(refusal(fiftyFifty(h, ids[2]!))).toBe('OK'); // untouched players are fine
  });

  it('POINT_TAX takes 25 % of the next gain, once', () => {
    const { h, ids } = bare(3);
    toPrep(h, 2);
    sabotage(h, ids[0]!, ids[1]!, 'POINT_TAX');
    h.runUntil('ANSWERING');
    h.answer(ids[1]!, 'correct');
    h.answer(ids[2]!, 'correct');
    h.runUntil('SCORE_UPDATE');
    const update = h.view({ role: 'DISPLAY' }).phaseData as {
      deltas: { playerId: string; delta: number; components: { kind: string; points: number }[] }[];
    };
    const taxed = update.deltas.find((d) => d.playerId === ids[1]!)!;
    const free = update.deltas.find((d) => d.playerId === ids[2]!)!;
    expect(taxed.components.some((c) => c.kind === 'POINT_TAX' && c.points < 0)).toBe(true);
    expect(taxed.delta).toBeLessThan(free.delta);
    expect(h.state.game!.players[ids[1]!]!.powers.pointTax).toBeNull(); // consumed
    // Next round: no tax.
    toPrep(h, 3);
    h.runUntil('ANSWERING');
    h.answer(ids[1]!, 'correct');
    h.runUntil('SCORE_UPDATE');
    const next = h.view({ role: 'DISPLAY' }).phaseData as {
      deltas: { playerId: string; components: { kind: string }[] }[];
    };
    expect(
      next.deltas.find((d) => d.playerId === ids[1]!)!.components.map((c) => c.kind),
    ).not.toContain('POINT_TAX');
  });

  it('POINT_TAX lapses after three rounds if there was no gain to tax', () => {
    const { h, ids } = bare(3, {
      powers: { sabotage: { pointTaxRounds: 3 } },
    });
    toPrep(h, 2);
    sabotage(h, ids[0]!, ids[1]!, 'POINT_TAX');
    // Nobody answers for three rounds (rounds 3, 4, 5).
    h.runUntil('SCORE_UPDATE');
    expect(h.state.game!.players[ids[1]!]!.powers.pointTax).not.toBeNull();
    toPrep(h, 3);
    h.runUntil('SCORE_UPDATE');
    expect(h.state.game!.players[ids[1]!]!.powers.pointTax).not.toBeNull();
    toPrep(h, 4);
    h.runUntil('SCORE_UPDATE');
    expect(h.state.game!.players[ids[1]!]!.powers.pointTax).toBeNull();
  });

  it('the shield blocks the first hit (the token stays spent) and is then gone', () => {
    const { h, ids } = setup(3, { powers: { sabotage: { targetMinGapRounds: 0 } } });
    toPrep(h, 2);
    sabotage(h, ids[0]!, ids[1]!, 'JAM');
    h.runUntil('ANSWERING');
    expect(youOf(h, ids[1]!).hits).toEqual([{ effect: 'JAM', blocked: true }]);
    expect(youOf(h, ids[1]!).effects!.jamMs).toBe(0);
    expect(youOf(h, ids[1]!).powers!.shield).toBe(0);
    expect(youOf(h, ids[0]!).powers!.sabotageTokens).toBe(0);
    h.runUntil('SCORE_UPDATE');
    toPrep(h, 3);
    sabotage(h, ids[2]!, ids[1]!, 'JAM');
    h.runUntil('ANSWERING');
    expect(youOf(h, ids[1]!).hits).toEqual([{ effect: 'JAM', blocked: false }]);
    expect(youOf(h, ids[1]!).effects!.jamMs).toBeGreaterThan(0);
  });

  it('pushes the new private state to the people it concerns, once the options exist', () => {
    const { h, ids } = bare();
    toPrep(h, 2);
    h.effects.length = 0;
    sabotage(h, ids[0]!, ids[1]!, 'FOG');
    sabotage(h, ids[2]!, ids[0]!, 'JAM');
    commit(h, ids[1]!); // everyone online has now decided: the phase moves on
    expect(h.state.phase).toBe('QUESTION');
    const lastState = (playerId: string) =>
      h.effects
        .flatMap((e) =>
          e.kind === 'emit' &&
          e.event.type === 'PLAYER_STATE' &&
          e.audience.to === 'PLAYER' &&
          e.audience.playerId === playerId
            ? [e.event.payload.you]
            : [],
        )
        .at(-1)!;
    expect(lastState(ids[1]!).hits).toEqual([{ effect: 'FOG', blocked: false }]);
    expect(lastState(ids[1]!).effects!.fogOptionId).not.toBeNull();
    expect(lastState(ids[0]!).hits).toEqual([{ effect: 'JAM', blocked: false }]);
    expect(lastState(ids[2]!).hits).toEqual([]);
  });

  it('never tells the target who did it, and tells nobody before the options exist', () => {
    const { h, ids } = bare();
    toPrep(h, 2);
    sabotage(h, ids[0]!, ids[1]!, 'SHUFFLE');
    const during = JSON.stringify([
      youOf(h, ids[1]!),
      h.view({ role: 'DISPLAY' }),
      h.view({ role: 'PLAYER', playerId: ids[2]! }),
    ]);
    expect(during).not.toContain('SHUFFLE');
    h.runUntil('ANSWERING');
    // The attacker's id may appear in the roster, but never as a source of the hit.
    expect(JSON.stringify(youOf(h, ids[1]!))).not.toContain(ids[0]!);
    expect(JSON.stringify(youOf(h, ids[2]!))).not.toContain(ids[0]!);
    expect(JSON.stringify(h.view({ role: 'DISPLAY' }).phaseData)).not.toContain('actor');
    expect(youOf(h, ids[1]!).hits).toEqual([{ effect: 'SHUFFLE', blocked: false }]);
    expect(youOf(h, ids[2]!).hits).toEqual([]);
  });
});

describe('POWER_RESOLUTION', () => {
  it('is skipped when nothing noteworthy happened', () => {
    const { h } = setup();
    h.runUntil('QUESTION_PREP');
    const phases = new Set<string>();
    while (h.state.phase !== 'SCORE_UPDATE') {
      phases.add(h.state.phase);
      h.step();
    }
    expect(phases.has('POWER_RESOLUTION')).toBe(false);
  });

  it('names stakes, doubles, lifelines and sabotage with their outcomes, after the reveal', () => {
    const { h, ids } = setup(3);
    toPrep(h, 2);
    commit(h, ids[0]!, { stake: 'HIGH', doubleDown: true });
    commit(h, ids[1]!, { sabotage: { targetId: ids[2]!, effect: 'JAM' } });
    h.runUntil('ANSWERING');
    h.answer(ids[0]!, 'correct');
    fiftyFifty(h, ids[1]!);
    h.answer(ids[1]!, 'wrong');
    h.runUntil('POWER_RESOLUTION');
    const data = h.view({ role: 'DISPLAY' }).phaseData;
    expect(data.phase).toBe('POWER_RESOLUTION');
    if (data.phase !== 'POWER_RESOLUTION') return;
    expect(data.items).toEqual([
      { kind: 'STAKE', playerId: ids[0]!, tier: 'HIGH', outcome: 'CORRECT' },
      { kind: 'DOUBLE_DOWN', playerId: ids[0]!, outcome: 'CORRECT' },
      { kind: 'FIFTY_FIFTY', playerId: ids[1]!, outcome: 'INCORRECT' },
      { kind: 'SABOTAGE', actorId: ids[1]!, targetId: ids[2]!, effect: 'JAM', blocked: true },
    ]);
    // Several items stay on screen longer than one.
    expect(h.state.phaseDeadlineAt! - h.state.phaseEnteredAt).toBe(3000 + 700 * 3);
  });

  it('records power use for the audit trail', () => {
    const { h, ids } = setup(3);
    toPrep(h, 2);
    commit(h, ids[0]!, {
      stake: 'RISK',
      doubleDown: true,
      sabotage: { targetId: ids[1]!, effect: 'FOG' },
    });
    h.runUntil('SCORE_UPDATE');
    const record = h.effects
      .flatMap((e) =>
        e.kind === 'persist' && e.record.type === 'ROUND_COMPLETED' ? [e.record] : [],
      )
      .find((r) => r.roundIndex === 2)!;
    expect(record.players.find((p) => p.playerId === ids[0]!)).toMatchObject({
      stake: 'RISK',
      doubleDown: true,
    });
    expect(record.sabotages).toEqual([
      { actorId: ids[0]!, targetId: ids[1]!, effect: 'FOG', blocked: true },
    ]);
  });
});

describe('powers across a game', () => {
  it('start fresh on a rematch', () => {
    const { h, ids } = setup(2, { defaultRounds: 3 });
    h.runUntil('QUESTION_PREP');
    commit(h, ids[0]!, { doubleDown: true });
    h.runUntil('RESULTS');
    h.command(h.actor(ids[0]!), { type: 'REMATCH', payload: {} });
    h.runUntil('QUESTION_PREP');
    expect(youOf(h, ids[0]!).powers).toMatchObject({ doubleDown: 2, fiftyFifty: 1, shield: 1 });
    expect(youOf(h, ids[0]!).commitment).toBeNull();
  });

  it('are absent in the lobby', () => {
    const h = new Harness();
    const [id] = h.joinPlayers(2);
    expect(youOf(h, id!).powers).toBeNull();
  });

  it('feed the director how much risk the room takes', () => {
    const { h, ids } = setup(2);
    h.runUntil('QUESTION_PREP');
    commit(h, ids[0]!, { stake: 'HIGH' });
    commit(h, ids[1]!, { stake: 'SAFE' });
    h.runUntil('SCORE_UPDATE');
    expect(h.state.game!.director.recentRiskTakePermille.at(-1)).toBe(500);
  });

  it('survive a reconnect snapshot: the same private view comes back', () => {
    const { h, ids } = setup(3);
    toPrep(h, 2);
    commit(h, ids[0]!, {
      stake: 'RISK',
      doubleDown: true,
      sabotage: { targetId: ids[1]!, effect: 'JAM' },
    });
    h.runUntil('ANSWERING');
    fiftyFifty(h, ids[0]!);
    const before = youOf(h, ids[0]!);
    expect(h.view({ role: 'PLAYER', playerId: ids[0]! }).you).toEqual(before);
    expect(before.commitment).toEqual({
      stake: 'RISK',
      doubleDown: true,
      sabotage: { targetId: ids[1]!, effect: 'JAM' },
    });
    expect(before.fiftyFifty!.keep).toHaveLength(2);
  });
});
