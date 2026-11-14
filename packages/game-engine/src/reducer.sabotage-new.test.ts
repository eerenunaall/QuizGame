import { describe, expect, it } from 'vitest';
import {
  answerAll,
  component,
  edit,
  refusal,
  resolutionItems,
  risk,
  sabotage,
  scoreOf,
  settle,
  setup,
  toRound,
  youOf,
} from './risks.helpers';
import { Harness } from './testing';

/**
 * ADR-0023, the three new sabotages: Stake Cap (Bahis Sınırı), Cut (Kesme), Blind Clock (Kör Saat).
 * Same token, cooldown, per-round and per-target limits as the original five; each has a switch.
 */

/** Plays rounds 0..index-1 (the last player always wrong, the first fastest) and stops in SABOTAGE_PICK of `index`. */
function toSabotage(players = 3, override: unknown = {}, index = 2) {
  // No shield unless the test asks for one: a shield would eat the first hit.
  const base = { powers: { shieldPerGame: 0 } };
  const { h, ids } = setup(players, mergeConfig(base, override));
  toRound(h, ids, index, { [ids[players - 1]!]: 'wrong' });
  h.runUntil('SABOTAGE_PICK');
  return { h, ids };
}

const mergeConfig = (a: Record<string, unknown>, b: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries((b ?? {}) as Record<string, unknown>)) {
    const left = out[key];
    out[key] =
      typeof value === 'object' && value !== null && typeof left === 'object' && left !== null
        ? mergeConfig(left as Record<string, unknown>, value)
        : value;
  }
  return out;
};

const menu = (h: Harness) => {
  const data = h.view({ role: 'DISPLAY' }).phaseData;
  if (data.phase !== 'SABOTAGE_PICK') throw new Error(`not SABOTAGE_PICK: ${data.phase}`);
  return data;
};
const kindsOf = (h: Harness, _id: string) => menu(h).offered;

describe('what is on offer', () => {
  it('lists all eight sabotages on the menu, which is config and says nothing about anybody’s pick', () => {
    const { h, ids } = toSabotage();
    expect(kindsOf(h, ids[0]!)).toEqual([
      'JAM',
      'SHUFFLE',
      'FOG',
      'LOCKOUT',
      'POINT_TAX',
      'STAKE_CAP',
      'CUT',
      'BLIND_CLOCK',
    ]);
    expect(menu(h).cutRule).toEqual({ permille: 200, maxPoints: 30 });
  });

  it('drops the ones a venue switched off', () => {
    const { h, ids } = toSabotage(3, {
      powers: {
        stakeCap: { enabled: false },
        cut: { enabled: false },
        blindClock: { enabled: false },
      },
    });
    expect(kindsOf(h, ids[0]!)).toEqual(['JAM', 'SHUFFLE', 'FOG', 'LOCKOUT', 'POINT_TAX']);
    expect(menu(h).cutRule).toBeUndefined();
    for (const effect of ['STAKE_CAP', 'CUT', 'BLIND_CLOCK'] as const) {
      expect(refusal(sabotage(h, ids[0]!, ids[1]!, effect))).toBe('POWER_UNAVAILABLE');
    }
    // refused means nothing was spent
    expect(youOf(h, ids[0]!).powers!.sabotageTokens).toBe(1);
  });
});

describe('Stake Cap (Bahis Sınırı)', () => {
  it('takes HIGH away from the target in the next question and then lapses', () => {
    const { h, ids } = toSabotage();
    expect(sabotage(h, ids[0]!, ids[1]!, 'STAKE_CAP').ok).toBe(true);
    // the hit lands in this question as a notice, the cap on the question after it
    h.runUntil('ANSWERING');
    expect(youOf(h, ids[1]!).hits).toEqual([{ effect: 'STAKE_CAP', blocked: false }]);
    expect(youOf(h, ids[1]!).powers!.stakeCap).toBeUndefined();
    answerAll(h, ids);
    h.runUntil('SCORE_UPDATE');
    h.runUntil('RISK_PICK');
    expect(h.round().index).toBe(3);
    expect(youOf(h, ids[1]!).powers!.stakeCap).toBe('RISK');
    expect(youOf(h, ids[0]!).powers!.stakeCap).toBeUndefined();
    expect(refusal(risk(h, ids[1]!, { stake: 'HIGH' }))).toBe('STAKE_INVALID');
    expect(h.round().commitments[ids[1]!]).toBeUndefined();
    // RISK, even with Double Down, is still legal under ADR-0021
    expect(risk(h, ids[1]!, { stake: 'RISK', doubleDown: true }).ok).toBe(true);
    // everybody else keeps the whole ladder
    expect(risk(h, ids[0]!, { stake: 'HIGH' }).ok).toBe(true);
    answerAll(h, ids);
    h.runUntil('SCORE_UPDATE');
    h.runUntil('RISK_PICK');
    expect(h.round().index).toBe(4);
    expect(youOf(h, ids[1]!).powers!.stakeCap).toBeUndefined();
    expect(risk(h, ids[1]!, { stake: 'HIGH' }).ok).toBe(true);
  });

  it('the shield blocks it', () => {
    const { h, ids } = toSabotage(3, { powers: { shieldPerGame: 1 } });
    sabotage(h, ids[0]!, ids[1]!, 'STAKE_CAP');
    h.runUntil('ANSWERING');
    expect(youOf(h, ids[1]!).hits).toEqual([{ effect: 'STAKE_CAP', blocked: true }]);
    answerAll(h, ids);
    h.runUntil('SCORE_UPDATE');
    h.runUntil('RISK_PICK');
    // a blocked cap is not a cap
    expect(youOf(h, ids[1]!).powers!.stakeCap).toBeUndefined();
    expect(risk(h, ids[1]!, { stake: 'HIGH' }).ok).toBe(true);
  });

  it('is not offered, and is refused with no token spent, when the next question is in the final stage', () => {
    const { h, ids } = toSabotage(3, {}, 6); // 10 rounds: the final stage starts at index 7
    const tokens = youOf(h, ids[0]!).powers!.sabotageTokens;
    expect(kindsOf(h, ids[0]!)).not.toContain('STAKE_CAP');
    expect(refusal(sabotage(h, ids[0]!, ids[1]!, 'STAKE_CAP'))).toBe('SABOTAGE_LIMIT');
    expect(youOf(h, ids[0]!).powers!.sabotageTokens).toBe(tokens);
    expect(sabotage(h, ids[0]!, ids[1]!, 'JAM').ok).toBe(true);
  });

  it('is not offered when no ordinary ladder has a rung above the cap', () => {
    const { h, ids } = toSabotage(3, { powers: { stakeCap: { maxTier: 'HIGH' } } });
    // the cap would be HIGH on ladders whose top rung is HIGH: it takes nothing away
    expect(kindsOf(h, ids[0]!)).not.toContain('STAKE_CAP');
    expect(refusal(sabotage(h, ids[0]!, ids[1]!, 'STAKE_CAP'))).toBe('SABOTAGE_LIMIT');
  });

  it('cannot be stacked with itself on one target in a round (one hit per target)', () => {
    const { h, ids } = toSabotage(4);
    expect(sabotage(h, ids[0]!, ids[1]!, 'STAKE_CAP').ok).toBe(true);
    expect(refusal(sabotage(h, ids[2]!, ids[1]!, 'STAKE_CAP'))).toBe('SABOTAGE_LIMIT');
  });
});

describe('Cut (Kesme)', () => {
  it('moves 20 % of the target’s next gain, at most 30, to the attacker', () => {
    const { h, ids } = toSabotage();
    const [a, b] = [scoreOf(h, ids[0]!), scoreOf(h, ids[1]!)];
    expect(sabotage(h, ids[2]!, ids[1]!, 'CUT').ok).toBe(true); // the player at the bottom cuts the middle one
    answerAll(h, ids, { [ids[2]!]: 'wrong' });
    const items = resolutionItems(h);
    const deltas = settle(h);
    expect(component(deltas[ids[1]!], 'CUT')).toBe(-30);
    expect(component(deltas[ids[2]!], 'CUT')).toBe(30);
    // points are moved, not created
    const own = (id: string) => deltas[id]!.delta - component(deltas[id], 'CUT');
    expect(scoreOf(h, ids[1]!)).toBe(b + own(ids[1]!) - 30);
    expect(scoreOf(h, ids[2]!)).toBe(0 + own(ids[2]!) + 30);
    expect(scoreOf(h, ids[0]!)).toBe(a + own(ids[0]!));
    expect(items).toContainEqual({
      kind: 'SABOTAGE',
      actorId: ids[2],
      targetId: ids[1],
      effect: 'CUT',
      blocked: false,
    });
    expect(items).toContainEqual({ kind: 'CUT', actorId: ids[2], targetId: ids[1], points: 30 });
  });

  it('works when the attacker is wrong: being right is not required', () => {
    const { h, ids } = toSabotage();
    sabotage(h, ids[2]!, ids[0]!, 'CUT'); // refused: ids[0] leads
    expect(sabotage(h, ids[2]!, ids[1]!, 'CUT').ok).toBe(true);
    answerAll(h, ids, { [ids[2]!]: 'wrong' });
    expect(component(settle(h)[ids[2]!], 'CUT')).toBe(30);
  });

  it('never aims at the player in front, nor at somebody with no points, whatever the rank', () => {
    const { h, ids } = toSabotage();
    expect(refusal(sabotage(h, ids[1]!, ids[0]!, 'CUT'))).toBe('TARGET_INVALID'); // rank 1
    expect(refusal(sabotage(h, ids[1]!, ids[2]!, 'CUT'))).toBe('TARGET_INVALID'); // 0 points
    expect(youOf(h, ids[1]!).powers!.sabotageTokens).toBe(1); // nothing spent
    expect(youOf(h, ids[1]!).sabotage).toMatchObject({ ready: true, decided: false });
  });

  it('players tied for first are all out of reach', () => {
    const { h, ids } = toSabotage();
    edit(h, (draft) => {
      const [x, y] = [draft.game!.players[ids[0]!]!, draft.game!.players[ids[1]!]!];
      y.score = x.score;
      y.correctCount = x.correctCount;
      y.totalRemainingMs = x.totalRemainingMs;
    });
    expect(refusal(sabotage(h, ids[2]!, ids[0]!, 'CUT'))).toBe('TARGET_INVALID');
    expect(refusal(sabotage(h, ids[2]!, ids[1]!, 'CUT'))).toBe('TARGET_INVALID');
  });

  it('in a two-player room the trailing player cannot cut the leader (the leader may cut them)', () => {
    const { h, ids } = toSabotage(2);
    // ids[1] answered wrong twice: no points. Give them some so the leader may aim at them.
    edit(h, (draft) => {
      draft.game!.players[ids[1]!]!.score = 50;
    });
    expect(refusal(sabotage(h, ids[1]!, ids[0]!, 'CUT'))).toBe('TARGET_INVALID');
    expect(sabotage(h, ids[0]!, ids[1]!, 'CUT').ok).toBe(true);
  });

  it('the shield blocks it and nothing is ever taken', () => {
    const { h, ids } = toSabotage(3, { powers: { shieldPerGame: 1 } });
    sabotage(h, ids[2]!, ids[1]!, 'CUT');
    answerAll(h, ids, { [ids[2]!]: 'wrong' });
    expect(h.state.game!.players[ids[1]!]!.powers.cut ?? null).toBeNull();
    const deltas = settle(h);
    expect(component(deltas[ids[1]!], 'CUT')).toBe(0);
    expect(component(deltas[ids[2]!], 'CUT')).toBe(0);
  });

  it('lapses after three rounds without a gain, and a miss does not use it up', () => {
    const { h, ids } = toSabotage();
    sabotage(h, ids[2]!, ids[1]!, 'CUT');
    for (let round = 2; round <= 4; round++) {
      h.runUntil('ANSWERING');
      expect(h.state.game!.players[ids[1]!]!.powers.cut).not.toBeNull();
      answerAll(h, ids, { [ids[1]!]: 'wrong', [ids[2]!]: 'wrong' });
      h.runUntil('SCORE_UPDATE');
      if (round < 4) h.runUntil('RISK_PICK');
    }
    expect(h.state.game!.players[ids[1]!]!.powers.cut ?? null).toBeNull();
    h.runUntil('RISK_PICK');
    answerAll(h, ids, { [ids[2]!]: 'wrong' });
    expect(component(settle(h)[ids[1]!], 'CUT')).toBe(0);
  });

  it('waits for a miss to pass: it is paid out of the first gain, in a later round', () => {
    const { h, ids } = toSabotage();
    sabotage(h, ids[2]!, ids[1]!, 'CUT');
    answerAll(h, ids, { [ids[1]!]: 'wrong', [ids[2]!]: 'wrong' });
    h.runUntil('SCORE_UPDATE');
    h.runUntil('RISK_PICK');
    answerAll(h, ids, { [ids[2]!]: 'wrong' });
    const deltas = settle(h);
    expect(component(deltas[ids[1]!], 'CUT')).toBe(-30);
    expect(component(deltas[ids[2]!], 'CUT')).toBe(30);
  });

  it('is an economy hit of its own: not on a target that already carries a Tax or a Cut, and not both', () => {
    const { h, ids } = toSabotage(4, { powers: { sabotage: { targetMinGapRounds: 0 } } });
    expect(sabotage(h, ids[3]!, ids[1]!, 'CUT').ok).toBe(true);
    answerAll(h, ids, { [ids[1]!]: 'wrong', [ids[3]!]: 'wrong' });
    h.runUntil('SCORE_UPDATE');
    h.runUntil('RISK_PICK');
    h.runUntil('SABOTAGE_PICK');
    // the cut is still waiting for a gain
    expect(refusal(sabotage(h, ids[2]!, ids[1]!, 'POINT_TAX'))).toBe('SABOTAGE_LIMIT');
    expect(refusal(sabotage(h, ids[2]!, ids[1]!, 'CUT'))).toBe('SABOTAGE_LIMIT');

    const other = toSabotage(4, { powers: { sabotage: { targetMinGapRounds: 0 } } });
    sabotage(other.h, other.ids[3]!, other.ids[1]!, 'POINT_TAX');
    answerAll(other.h, other.ids, { [other.ids[1]!]: 'wrong', [other.ids[3]!]: 'wrong' });
    other.h.runUntil('SCORE_UPDATE');
    other.h.runUntil('RISK_PICK');
    other.h.runUntil('SABOTAGE_PICK');
    expect(refusal(sabotage(other.h, other.ids[2]!, other.ids[1]!, 'CUT'))).toBe('SABOTAGE_LIMIT');
  });

  it('keeps the original limits: attacker cooldown, one hit per target and round', () => {
    const { h, ids } = toSabotage(4);
    expect(sabotage(h, ids[3]!, ids[1]!, 'CUT').ok).toBe(true);
    expect(refusal(sabotage(h, ids[2]!, ids[1]!, 'CUT'))).toBe('SABOTAGE_LIMIT');
    answerAll(h, ids, { [ids[3]!]: 'wrong' });
    h.runUntil('SCORE_UPDATE');
    h.runUntil('RISK_PICK');
    // the attacker now cools down for two rounds: the original rule, unchanged
    expect(youOf(h, ids[3]!).sabotage?.ready ?? false).toBe(false);
  });

  it('lapses with the attacker: a player who left leaves nothing to collect', () => {
    const { h, ids } = toSabotage();
    sabotage(h, ids[2]!, ids[1]!, 'CUT');
    h.runUntil('ANSWERING');
    h.command(h.actor(ids[2]!), { type: 'LEAVE_ROOM', payload: {} });
    answerAll(h, ids);
    const deltas = settle(h);
    expect(component(deltas[ids[1]!], 'CUT')).toBe(0);
    expect(h.state.game!.players[ids[1]!]!.powers.cut ?? null).toBeNull();
  });

  it('is paid on a later gain when the attacker sits the question out as the author (Who Said It)', () => {
    const h = new Harness({ tier: 'FULL' });
    const ids = h.joinPlayers(3);
    h.apply({ kind: 'SET_CONTENT', mode: 'WHO_SAID_IT', ref: null, title: null, rounds: 10 });
    ids.forEach((id, i) =>
      h.command(h.actor(id), { type: 'SUBMIT_STATEMENT', payload: { text: `söz numara ${i}` } }),
    );
    h.start();
    h.runUntil('RISK_PICK');
    const author = h.state.game!.deck.questions[h.round().questionId]!.authorPlayerId!;
    const target = ids.find((id) => id !== author)!;
    edit(h, (draft) => {
      draft.game!.players[target]!.powers.cut = { by: author, expiresAfterRound: 99 };
    });
    h.runUntil('ANSWERING');
    for (const id of ids.filter((x) => x !== author)) h.answer(id, 'correct');
    const deltas = settle(h);
    expect(component(deltas[target], 'CUT')).toBe(0);
    expect(deltas[author]).toBeUndefined();
    expect(h.state.game!.players[target]!.powers.cut).toEqual({
      by: author,
      expiresAfterRound: 99,
    });
  });
});

describe('Blind Clock (Kör Saat)', () => {
  it('hides the target’s countdown for the question and costs no time', () => {
    const { h, ids } = toSabotage();
    expect(sabotage(h, ids[0]!, ids[1]!, 'BLIND_CLOCK').ok).toBe(true);
    h.runUntil('ANSWERING');
    expect(youOf(h, ids[1]!).effects).toMatchObject({ jamMs: 0, blindClock: true });
    expect(youOf(h, ids[1]!).hits).toEqual([{ effect: 'BLIND_CLOCK', blocked: false }]);
    expect(youOf(h, ids[2]!).effects?.blindClock).toBeUndefined();
    expect(youOf(h, ids[0]!).effects).toBeNull();
    // the window itself is the same for everybody: the server still takes answers until the same deadline
    expect(h.round().effects[ids[1]!]!.jamMs).toBe(0);
  });

  it('the shield blocks it', () => {
    const { h, ids } = toSabotage(3, { powers: { shieldPerGame: 1 } });
    sabotage(h, ids[0]!, ids[1]!, 'BLIND_CLOCK');
    h.runUntil('ANSWERING');
    expect(youOf(h, ids[1]!).effects?.blindClock).toBeUndefined();
    expect(youOf(h, ids[1]!).hits).toEqual([{ effect: 'BLIND_CLOCK', blocked: true }]);
  });

  it('is not softened by reduced effects: nothing about it moves or costs time', () => {
    const { h, ids } = toSabotage();
    h.command(h.actor(ids[1]!), { type: 'SET_PREFERENCES', payload: { reducedEffects: true } });
    sabotage(h, ids[0]!, ids[1]!, 'BLIND_CLOCK');
    h.runUntil('ANSWERING');
    expect(youOf(h, ids[1]!).effects).toMatchObject({ blindClock: true, jamMs: 0 });
  });

  it('answers are scored exactly as without it', () => {
    const { h, ids } = toSabotage();
    sabotage(h, ids[0]!, ids[1]!, 'BLIND_CLOCK');
    answerAll(h, ids, {}, { [ids[0]!]: 1000, [ids[1]!]: 1000, [ids[2]!]: 1000 });
    const deltas = settle(h);
    expect(deltas[ids[1]!]!.delta).toBe(deltas[ids[0]!]!.delta);
  });
});
