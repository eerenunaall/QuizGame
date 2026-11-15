import { describe, expect, it } from 'vitest';
import { scanForbiddenKeys, type ErrorCode } from '@quizparty/protocol';
import { GameConfigSchema, DEFAULT_GAME_CONFIG } from './config';
import { checkRisk } from './powers';
import {
  answerAll,
  component,
  edit,
  refusal,
  resolutionItems,
  respondDuel,
  risk,
  scoreOf,
  settle,
  setup,
  toRound,
  youOf,
} from './risks.helpers';
import { Harness } from './testing';

/**
 * ADR-0023, the three new risks: Cover (Örtü), Duel (Düello), Pot (Havuz). Rules and numbers are the
 * research doc's (docs/RISK_SABOTAGE_RESEARCH.md R1, R2, R5) with the owner's defaults: Duel is opt-in
 * for both sides, every new thing has a switch.
 */
const riskData = (h: Harness) => {
  const data = h.view({ role: 'DISPLAY' }).phaseData;
  if (data.phase !== 'RISK_PICK') throw new Error(`not RISK_PICK: ${data.phase}`);
  return data;
};

describe('Cover (Örtü)', () => {
  it('a miss under RISK costs the fee (half the stake loss) and nothing else', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    const before = scoreOf(h, ids[0]!);
    expect(risk(h, ids[0]!, { stake: 'RISK', cover: true }).ok).toBe(true);
    answerAll(h, ids, { [ids[0]!]: 'wrong' });
    const items = resolutionItems(h);
    const deltas = settle(h);
    expect(deltas[ids[0]!]!.delta).toBe(-50);
    expect(deltas[ids[0]!]!.components).toEqual([{ kind: 'COVER_FEE', points: -50 }]);
    expect(scoreOf(h, ids[0]!)).toBe(before - 50);
    expect(items).toContainEqual({
      kind: 'COVER',
      playerId: ids[0],
      outcome: 'INCORRECT',
      fee: 50,
      saved: 100,
    });
  });

  it('a hit still pays the fee: RISK x2 stays attractive but costs 50', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    risk(h, ids[0]!, { stake: 'RISK', cover: true });
    risk(h, ids[1]!, { stake: 'RISK' });
    answerAll(h, ids);
    const items = resolutionItems(h);
    const deltas = settle(h);
    // Same stake, same answer: the covered player is exactly the fee behind the uncovered one
    // (the 100 ms answer-order difference moves the speed bonus by at most a few points).
    const gap = deltas[ids[1]!]!.delta - deltas[ids[0]!]!.delta;
    expect(gap).toBeGreaterThanOrEqual(50 - 5);
    expect(gap).toBeLessThanOrEqual(50 + 5);
    expect(component(deltas[ids[0]!], 'COVER_FEE')).toBe(-50);
    expect(items).toContainEqual({
      kind: 'COVER',
      playerId: ids[0],
      outcome: 'CORRECT',
      fee: 50,
      saved: 0,
    });
  });

  it('HIGH + Cover: fee 100 against a loss of 200', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    risk(h, ids[0]!, { stake: 'HIGH', cover: true });
    answerAll(h, ids, { [ids[0]!]: 'none' });
    const deltas = settle(h);
    expect(deltas[ids[0]!]!.delta).toBe(-100);
  });

  it('refuses Cover on SAFE, spending nothing, and lets the player choose again', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    expect(refusal(risk(h, ids[0]!, { stake: 'SAFE', cover: true }))).toBe('STAKE_INVALID');
    expect(h.round().commitments[ids[0]!]).toBeUndefined();
    expect(youOf(h, ids[0]!).powers!.cover).toBe(1);
    expect(risk(h, ids[0]!, { stake: 'RISK', cover: true }).ok).toBe(true);
    expect(youOf(h, ids[0]!).powers!.cover).toBe(0);
  });

  it('is one per game', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    risk(h, ids[0]!, { stake: 'RISK', cover: true });
    answerAll(h, ids);
    h.runUntil('SCORE_UPDATE');
    h.runUntil('RISK_PICK');
    expect(refusal(risk(h, ids[0]!, { stake: 'RISK', cover: true }))).toBe('POWER_UNAVAILABLE');
    expect(h.round().commitments[ids[0]!]).toBeUndefined();
  });

  it('does not go with Double Down by default (one big gamble per question)', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    expect(refusal(risk(h, ids[0]!, { stake: 'RISK', doubleDown: true, cover: true }))).toBe(
      'BIG_GAMBLE_CONFLICT',
    );
    expect(youOf(h, ids[0]!).powers).toMatchObject({ cover: 1, doubleDown: 2 });
  });

  it('can be allowed with Double Down by config, and then waives its extra loss too', () => {
    const { h, ids } = setup(3, { powers: { cover: { allowWithDoubleDown: true } } });
    toRound(h, ids, 1);
    expect(risk(h, ids[0]!, { stake: 'RISK', doubleDown: true, cover: true }).ok).toBe(true);
    answerAll(h, ids, { [ids[0]!]: 'wrong' });
    expect(settle(h)[ids[0]!]!.delta).toBe(-50);
  });

  it('can be switched off: refused, and no longer offered', () => {
    const { h, ids } = setup(3, { powers: { cover: { enabled: false } } });
    toRound(h, ids, 1);
    expect(riskData(h).risks?.cover).toBe(false);
    expect(refusal(risk(h, ids[0]!, { stake: 'RISK', cover: true }))).toBe('POWER_UNAVAILABLE');
  });

  it('a player who is offline at lock pays nothing: no answer, no stake lost, no fee', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    risk(h, ids[0]!, { stake: 'RISK', cover: true });
    h.runUntil('ANSWERING');
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[0]!, connected: false });
    answerAll(h, ids, { [ids[0]!]: 'none' });
    expect(settle(h)[ids[0]!]!.delta).toBe(0);
    // The use is gone all the same (spent on commitment, ADR-0007).
    expect(h.state.game!.players[ids[0]!]!.powers.cover).toBe(0);
  });

  it('shows the fee per rung on the public ladder and keeps who covered private', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    const ladder = riskData(h).riskLadder;
    expect(ladder.map((r) => [r.tier, r.coverFee])).toEqual([
      ['SAFE', 0],
      ['RISK', 50],
      ['HIGH', 100],
    ]);
    risk(h, ids[0]!, { stake: 'RISK', cover: true });
    expect(youOf(h, ids[0]!).commitment).toMatchObject({ cover: true });
    expect(youOf(h, ids[1]!).commitment).toBeNull();
  });

  it('a game stored before Cover existed simply has none of it, and plays on', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    edit(h, (draft) => {
      for (const gp of Object.values(draft.game!.players)) delete gp.powers.cover;
    });
    expect(refusal(risk(h, ids[0]!, { stake: 'RISK', cover: true }))).toBe('POWER_UNAVAILABLE');
    expect(risk(h, ids[0]!, { stake: 'RISK' }).ok).toBe(true);
  });
});

describe('Pot (Havuz)', () => {
  it('everyone who antes puts 30 in; the right answers split it', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    for (const id of ids) expect(risk(h, id, { pot: true }).ok).toBe(true);
    answerAll(h, ids, { [ids[2]!]: 'wrong' });
    const items = resolutionItems(h);
    const deltas = settle(h);
    expect(component(deltas[ids[0]!], 'POT')).toBe(45 - 30);
    expect(component(deltas[ids[1]!], 'POT')).toBe(45 - 30);
    expect(component(deltas[ids[2]!], 'POT')).toBe(-30);
    expect(items).toContainEqual({
      kind: 'POT',
      playerIds: ids,
      winnerIds: [ids[0], ids[1]],
      size: 90,
      refunded: false,
    });
  });

  it('gives the remainder to the fastest right answer', () => {
    const { h, ids } = setup(3, { powers: { pot: { ante: 31 } } });
    toRound(h, ids, 1);
    for (const id of ids) risk(h, id, { pot: true });
    // ids[1] answers first
    answerAll(h, ids, { [ids[2]!]: 'wrong' }, { [ids[0]!]: 3000, [ids[1]!]: 1000 });
    const deltas = settle(h);
    expect(component(deltas[ids[1]!], 'POT')).toBe(47 - 31);
    expect(component(deltas[ids[0]!], 'POT')).toBe(46 - 31);
  });

  it('refunds everybody when nobody is right, and gives the use back', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    for (const id of ids) risk(h, id, { pot: true });
    expect(youOf(h, ids[0]!).powers!.pot).toBe(1);
    answerAll(h, ids, { [ids[0]!]: 'wrong', [ids[1]!]: 'wrong', [ids[2]!]: 'wrong' });
    const items = resolutionItems(h);
    const deltas = settle(h);
    for (const id of ids) expect(component(deltas[id], 'POT')).toBe(0);
    expect(items).toContainEqual(
      expect.objectContaining({ kind: 'POT', refunded: true, size: 90 }),
    );
    expect(h.state.game!.players[ids[0]!]!.powers.pots).toBe(2);
  });

  it('does not run with fewer than three players in: antes come back', () => {
    const { h, ids } = setup(4);
    toRound(h, ids, 1);
    risk(h, ids[0]!, { pot: true });
    risk(h, ids[1]!, { pot: true });
    answerAll(h, ids);
    const items = resolutionItems(h);
    const deltas = settle(h);
    expect(component(deltas[ids[0]!], 'POT')).toBe(0);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'POT', refunded: true }));
    expect(h.state.game!.players[ids[0]!]!.powers.pots).toBe(2);
  });

  it('a participant who is offline at lock is out: the rest may fall under the minimum', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    for (const id of ids) risk(h, id, { pot: true });
    h.runUntil('ANSWERING');
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[2]!, connected: false });
    answerAll(h, ids, { [ids[2]!]: 'none' });
    const items = resolutionItems(h);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'POT', refunded: true }));
    const deltas = settle(h);
    for (const id of ids) expect(component(deltas[id], 'POT')).toBe(0);
  });

  it('needs the ante in hand, a big enough room, and is two per game', () => {
    const { h, ids } = setup(3);
    h.runUntil('RISK_PICK'); // round 1: nobody has a point yet
    expect(refusal(risk(h, ids[0]!, { pot: true }))).toBe('POWER_UNAVAILABLE');
    toRound(h, ids, 1);
    for (const id of ids) risk(h, id, { pot: true });
    answerAll(h, ids, { [ids[2]!]: 'wrong' });
    h.runUntil('SCORE_UPDATE');
    h.runUntil('RISK_PICK');
    for (const id of ids) expect(risk(h, id, { pot: true }).ok).toBe(true);
    answerAll(h, ids, { [ids[2]!]: 'wrong' });
    h.runUntil('SCORE_UPDATE');
    h.runUntil('RISK_PICK');
    expect(refusal(risk(h, ids[0]!, { pot: true }))).toBe('POWER_UNAVAILABLE');

    const small = setup(2);
    toRound(small.h, small.ids, 1);
    expect(refusal(risk(small.h, small.ids[0]!, { pot: true }))).toBe('POWER_UNAVAILABLE');
    expect(riskData(small.h).risks?.pot).toEqual({ ante: 30, minPlayers: 3 });
  });

  it('can be switched off', () => {
    const { h, ids } = setup(3, { powers: { pot: { enabled: false } } });
    toRound(h, ids, 1);
    expect(riskData(h).risks?.pot).toBeNull();
    expect(refusal(risk(h, ids[0]!, { pot: true }))).toBe('POWER_UNAVAILABLE');
  });

  it('is a small item: it goes with any stake, Cover and a Duel', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    expect(risk(h, ids[0]!, { stake: 'HIGH', pot: true }).ok).toBe(true);
    expect(risk(h, ids[1]!, { stake: 'RISK', pot: true, cover: true }).ok).toBe(true);
    expect(risk(h, ids[2]!, { stake: 'RISK', pot: true, duel: { targetId: ids[0]! } }).ok).toBe(
      true,
    );
  });

  it('never sends who anted before the resolution', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    risk(h, ids[0]!, { pot: true });
    h.runUntil('ANSWERING');
    for (const viewer of [
      { role: 'DISPLAY' } as const,
      { role: 'PLAYER', playerId: ids[1]! } as const,
    ]) {
      const json = JSON.stringify(h.view(viewer));
      expect(json).not.toContain('"pot":true');
      expect(scanForbiddenKeys(h.view(viewer))).toEqual([]);
    }
    expect(youOf(h, ids[0]!).commitment).toMatchObject({ pot: true });
  });
});

describe('Duel (Düello)', () => {
  /** ids[0] challenges ids[1]; the rival replies; the others take a plain stake. */
  function challenge(h: Harness, ids: readonly string[], reply: boolean | null) {
    expect(risk(h, ids[0]!, { stake: 'RISK', duel: { targetId: ids[1]! } }).ok).toBe(true);
    if (reply !== null) expect(respondDuel(h, ids[1]!, ids[0]!, reply).ok).toBe(true);
    for (const id of ids.slice(1)) if (!h.round().commitments[id]) risk(h, id);
  }

  it('the challenger is right and the rival wrong: 80 move, both ways round', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    const [a, b] = [scoreOf(h, ids[0]!), scoreOf(h, ids[1]!)];
    challenge(h, ids, true);
    answerAll(h, ids, { [ids[1]!]: 'wrong' });
    const items = resolutionItems(h);
    const deltas = settle(h);
    expect(component(deltas[ids[0]!], 'DUEL')).toBe(80);
    expect(component(deltas[ids[1]!], 'DUEL')).toBe(-80);
    expect(scoreOf(h, ids[1]!)).toBe(b - 80);
    expect(scoreOf(h, ids[0]!)).toBe(a + deltas[ids[0]!]!.delta);
    expect(items).toContainEqual({
      kind: 'DUEL',
      challengerId: ids[0],
      rivalId: ids[1],
      accepted: true,
      winnerId: ids[0],
      points: 80,
    });
  });

  it('the rival is right and the challenger wrong or silent: the rival takes 80', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    challenge(h, ids, true);
    answerAll(h, ids, { [ids[0]!]: 'none' });
    const deltas = settle(h);
    expect(component(deltas[ids[1]!], 'DUEL')).toBe(80);
    expect(component(deltas[ids[0]!], 'DUEL')).toBe(-80);
  });

  it('both right: the faster takes 40; a tie moves nothing', () => {
    const fast = setup(3);
    toRound(fast.h, fast.ids, 1);
    challenge(fast.h, fast.ids, true);
    answerAll(fast.h, fast.ids, {}, { [fast.ids[0]!]: 4000, [fast.ids[1]!]: 1000 });
    const deltas = settle(fast.h);
    expect(component(deltas[fast.ids[1]!], 'DUEL')).toBe(40);
    expect(component(deltas[fast.ids[0]!], 'DUEL')).toBe(-40);

    const tie = setup(3);
    toRound(tie.h, tie.ids, 1);
    challenge(tie.h, tie.ids, true);
    answerAll(tie.h, tie.ids, {}, { [tie.ids[0]!]: 2000, [tie.ids[1]!]: 2000 });
    const tied = settle(tie.h);
    expect(component(tied[tie.ids[0]!], 'DUEL')).toBe(0);
  });

  it('both wrong: nothing moves', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    challenge(h, ids, true);
    answerAll(h, ids, { [ids[0]!]: 'wrong', [ids[1]!]: 'wrong' });
    const deltas = settle(h);
    expect(component(deltas[ids[0]!], 'DUEL')).toBe(0);
    expect(component(deltas[ids[1]!], 'DUEL')).toBe(0);
  });

  it('the transfer is capped by what the loser has: nobody goes below zero', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    // Make the rival poor: 30 points left.
    edit(h, (draft) => {
      draft.game!.players[ids[1]!]!.score = 30;
    });
    challenge(h, ids, true);
    answerAll(h, ids, { [ids[1]!]: 'wrong' });
    const deltas = settle(h);
    expect(component(deltas[ids[0]!], 'DUEL')).toBe(30);
    expect(component(deltas[ids[1]!], 'DUEL')).toBe(-30);
    expect(scoreOf(h, ids[1]!)).toBe(0);
  });

  it('a declined or ignored challenge does nothing at all, and says so on the screen', () => {
    for (const reply of [false, null] as const) {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      challenge(h, ids, reply);
      if (reply === null) {
        // never answered: the phase waits for the rival, and the timer closes it
        expect(h.state.phase).toBe('RISK_PICK');
      }
      answerAll(h, ids, { [ids[1]!]: 'wrong' });
      const items = resolutionItems(h);
      const deltas = settle(h);
      expect(component(deltas[ids[0]!], 'DUEL')).toBe(0);
      expect(component(deltas[ids[1]!], 'DUEL')).toBe(0);
      expect(items).toContainEqual({
        kind: 'DUEL',
        challengerId: ids[0],
        rivalId: ids[1],
        accepted: false,
        winnerId: null,
        points: 0,
      });
    }
  });

  it('two challenges at each other form a duel without any reply', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    risk(h, ids[0]!, { duel: { targetId: ids[1]! } });
    risk(h, ids[1]!, { duel: { targetId: ids[0]! } });
    risk(h, ids[2]!);
    answerAll(h, ids, { [ids[1]!]: 'wrong' });
    const deltas = settle(h);
    expect(component(deltas[ids[0]!], 'DUEL')).toBe(80);
    expect(component(deltas[ids[1]!], 'DUEL')).toBe(-80);
  });

  it('a rival can accept only one of several challenges', () => {
    const { h, ids } = setup(4);
    toRound(h, ids, 1);
    risk(h, ids[0]!, { duel: { targetId: ids[3]! } });
    risk(h, ids[1]!, { duel: { targetId: ids[3]! } });
    expect(respondDuel(h, ids[3]!, ids[0]!, true).ok).toBe(true);
    expect(refusal(respondDuel(h, ids[3]!, ids[1]!, true))).toBe('DUEL_LIMIT');
    expect(respondDuel(h, ids[3]!, ids[1]!, false).ok).toBe(true);
  });

  it('works in a two-player room', () => {
    const { h, ids } = setup(2);
    toRound(h, ids, 1);
    risk(h, ids[0]!, { stake: 'RISK', duel: { targetId: ids[1]! } });
    respondDuel(h, ids[1]!, ids[0]!, true);
    risk(h, ids[1]!);
    answerAll(h, ids, { [ids[1]!]: 'wrong' });
    const deltas = settle(h);
    expect(component(deltas[ids[0]!], 'DUEL')).toBe(80);
  });

  it('the challenger who vanished still loses: offline is not a way out', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    challenge(h, ids, true);
    h.runUntil('ANSWERING');
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[0]!, connected: false });
    answerAll(h, ids, { [ids[0]!]: 'none' });
    const deltas = settle(h);
    expect(component(deltas[ids[1]!], 'DUEL')).toBe(80);
    expect(component(deltas[ids[0]!], 'DUEL')).toBe(-80);
  });

  describe('limits and illegal challenges', () => {
    it.each([
      ['yourself', (ids: string[]) => ids[0]!],
      ['somebody who is not in the room', () => 'nobody'],
    ])('refuses a challenge to %s', (_name, pick) => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      expect(refusal(risk(h, ids[0]!, { duel: { targetId: pick(ids) } }))).toBe('TARGET_INVALID');
      expect(youOf(h, ids[0]!).powers!.duel).toBe(2);
    });

    it('refuses a rival who is offline (the player list shows it)', () => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[1]!, connected: false });
      expect(refusal(risk(h, ids[0]!, { duel: { targetId: ids[1]! } }))).toBe('TARGET_INVALID');
    });

    it('one big gamble per question: not with HIGH, ALL_IN or Double Down', () => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      for (const patch of [{ stake: 'HIGH' as const }, { doubleDown: true }]) {
        expect(refusal(risk(h, ids[0]!, { ...patch, duel: { targetId: ids[1]! } }))).toBe(
          'BIG_GAMBLE_CONFLICT',
        );
      }
      expect(h.round().commitments[ids[0]!]).toBeUndefined();
      expect(youOf(h, ids[0]!).powers).toMatchObject({ duel: 2, doubleDown: 2 });
    });

    it('a rival who took HIGH or Double Down cannot accept, and an accepter cannot go big afterwards', () => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      risk(h, ids[1]!, { stake: 'HIGH' });
      risk(h, ids[0]!, { duel: { targetId: ids[1]! } });
      expect(refusal(respondDuel(h, ids[1]!, ids[0]!, true))).toBe('BIG_GAMBLE_CONFLICT');
      expect(respondDuel(h, ids[1]!, ids[0]!, false).ok).toBe(true);

      const second = setup(3);
      toRound(second.h, second.ids, 1);
      risk(second.h, second.ids[0]!, { duel: { targetId: second.ids[1]! } });
      expect(respondDuel(second.h, second.ids[1]!, second.ids[0]!, true).ok).toBe(true);
      expect(refusal(risk(second.h, second.ids[1]!, { stake: 'HIGH' }))).toBe(
        'BIG_GAMBLE_CONFLICT',
      );
      expect(refusal(risk(second.h, second.ids[1]!, { doubleDown: true }))).toBe(
        'BIG_GAMBLE_CONFLICT',
      );
      expect(risk(second.h, second.ids[1]!, { stake: 'RISK' }).ok).toBe(true);
    });

    it('a challenger cannot also accept somebody else’s challenge', () => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      risk(h, ids[0]!, { duel: { targetId: ids[1]! } });
      risk(h, ids[1]!, { duel: { targetId: ids[2]! } });
      expect(refusal(respondDuel(h, ids[1]!, ids[0]!, true))).toBe('BIG_GAMBLE_CONFLICT');
    });

    it('two per game, and never the same rival twice', () => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      challenge(h, ids, true);
      answerAll(h, ids);
      h.runUntil('SCORE_UPDATE');
      h.runUntil('RISK_PICK');
      expect(refusal(risk(h, ids[0]!, { duel: { targetId: ids[1]! } }))).toBe('DUEL_LIMIT');
      expect(risk(h, ids[0]!, { duel: { targetId: ids[2]! } }).ok).toBe(true);
      respondDuel(h, ids[2]!, ids[0]!, true);
      answerAll(h, ids);
      h.runUntil('SCORE_UPDATE');
      h.runUntil('RISK_PICK');
      expect(refusal(risk(h, ids[0]!, { duel: { targetId: ids[2]! } }))).toBe('POWER_UNAVAILABLE');
      // the rival of a formed duel cannot turn it around either
      expect(refusal(risk(h, ids[1]!, { duel: { targetId: ids[0]! } }))).toBe('DUEL_LIMIT');
    });

    it('a declined challenge is spent but does not block the same rival later', () => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      challenge(h, ids, false);
      answerAll(h, ids);
      h.runUntil('SCORE_UPDATE');
      h.runUntil('RISK_PICK');
      expect(youOf(h, ids[0]!).powers!.duel).toBe(1);
      expect(risk(h, ids[0]!, { duel: { targetId: ids[1]! } }).ok).toBe(true);
    });

    it('can be switched off, or kept for bigger rooms', () => {
      const off = setup(3, { powers: { duel: { enabled: false } } });
      toRound(off.h, off.ids, 1);
      expect(riskData(off.h).risks?.duel).toBeNull();
      expect(refusal(risk(off.h, off.ids[0]!, { duel: { targetId: off.ids[1]! } }))).toBe(
        'POWER_UNAVAILABLE',
      );
      const small = setup(2, { powers: { duel: { minPlayers: 3 } } });
      toRound(small.h, small.ids, 1);
      expect(refusal(risk(small.h, small.ids[0]!, { duel: { targetId: small.ids[1]! } }))).toBe(
        'POWER_UNAVAILABLE',
      );
    });
  });

  describe('replies', () => {
    it('only the challenged player is told, with the challenger’s name; nobody else sees a thing', () => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      risk(h, ids[0]!, { duel: { targetId: ids[1]! } });
      expect(youOf(h, ids[1]!).duelInvites).toEqual([{ challengerId: ids[0], answer: null }]);
      expect(youOf(h, ids[2]!).duelInvites).toBeUndefined();
      expect(youOf(h, ids[0]!).duelInvites).toBeUndefined();
      expect(youOf(h, ids[0]!).commitment!.duel).toEqual({ targetId: ids[1] });
      const display = JSON.stringify(h.view({ role: 'DISPLAY' }).phaseData);
      expect(display).not.toContain(ids[1]!);
      expect(display).not.toMatch(/challenger|targetId|duelInvites/);
      // the one frame that carries the challenge goes to the challenged player alone
      const carriers = h.effects.filter(
        (e) =>
          e.kind === 'emit' &&
          e.event.type === 'PLAYER_STATE' &&
          JSON.stringify(e.event).includes('duelInvites'),
      );
      for (const effect of carriers) {
        expect(effect).toMatchObject({ audience: { to: 'PLAYER', playerId: ids[1] } });
      }
    });

    it('a reply is final and must answer a real challenge', () => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      expect(refusal(respondDuel(h, ids[1]!, ids[0]!, true))).toBe('POWER_UNAVAILABLE'); // forged
      risk(h, ids[0]!, { duel: { targetId: ids[1]! } });
      expect(refusal(respondDuel(h, ids[2]!, ids[0]!, true))).toBe('POWER_UNAVAILABLE'); // not theirs
      expect(refusal(respondDuel(h, ids[0]!, ids[0]!, true))).toBe('POWER_UNAVAILABLE'); // own
      expect(respondDuel(h, ids[1]!, ids[0]!, false).ok).toBe(true);
      expect(refusal(respondDuel(h, ids[1]!, ids[0]!, true))).toBe('ALREADY_COMMITTED'); // replay
      expect(youOf(h, ids[1]!).duelInvites).toEqual([{ challengerId: ids[0], answer: 'DECLINED' }]);
    });

    it('is only legal in RISK_PICK', () => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      risk(h, ids[0]!, { duel: { targetId: ids[1]! } });
      h.runUntil('ANSWERING');
      expect(refusal(respondDuel(h, ids[1]!, ids[0]!, true))).toBe('INVALID_STATE');
    });

    it('the pick phase waits for a challenged rival that is online, not for one that is not', () => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      risk(h, ids[1]!);
      risk(h, ids[2]!);
      risk(h, ids[0]!, { duel: { targetId: ids[1]! } });
      // everybody has confirmed, but ids[1] has a challenge to answer
      expect(h.state.phase).toBe('RISK_PICK');
      expect(riskData(h)).toMatchObject({ committedCount: 2, eligibleCount: 3 });
      respondDuel(h, ids[1]!, ids[0]!, false);
      expect(h.state.phase).not.toBe('RISK_PICK');

      const gone = setup(3);
      toRound(gone.h, gone.ids, 1);
      risk(gone.h, gone.ids[1]!);
      risk(gone.h, gone.ids[2]!);
      risk(gone.h, gone.ids[0]!, { duel: { targetId: gone.ids[1]! } });
      gone.h.apply({ kind: 'PLAYER_CONNECTION', playerId: gone.ids[1]!, connected: false });
      gone.h.tickAt(gone.h.now + 1);
      // the challenged rival dropped: nobody is waited for any more (their unanswered challenge is a no)
      expect(gone.h.state.phase).not.toBe('RISK_PICK');
    });

    it('the TV only ever gets counts while the duel is open', () => {
      const { h, ids } = setup(3);
      toRound(h, ids, 1);
      risk(h, ids[0]!, { duel: { targetId: ids[1]! } });
      respondDuel(h, ids[1]!, ids[0]!, true);
      const progress = h.events('PREP_PROGRESS');
      for (const event of progress)
        expect(Object.keys(event.payload as object).sort()).toEqual([
          'committedCount',
          'eligibleCount',
        ]);
      for (const effect of h.effects) {
        if (effect.kind !== 'emit' || effect.audience.to === 'PLAYER') continue;
        expect(JSON.stringify(effect.event)).not.toMatch(/challenger|targetId|duelInvites/);
      }
    });
  });
});

describe('the interaction table (ADR-0023): one big gamble per question', () => {
  /**
   * BIG = HIGH, ALL_IN, Double Down, Duel. At most one per player per question. Cover and Pot are
   * small items: Pot goes with everything; Cover needs a stake with something to lose and does not go
   * with Double Down (it would waive the extra loss and make the stack nearly free).
   */
  const stakes = ['SAFE', 'RISK', 'HIGH'] as const;
  const bools = [false, true] as const;

  it('accepts and refuses every combination exactly as the table says, never spending on a refusal', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    const me = ids[0]!;
    const state = h.state as Parameters<typeof checkRisk>[0];
    let accepted = 0;
    for (const stake of stakes)
      for (const doubleDown of bools)
        for (const cover of bools)
          for (const pot of bools)
            for (const duel of bools) {
              const violations: ErrorCode[] = [];
              if (doubleDown && stake === 'HIGH') violations.push('DOUBLE_DOWN_STAKE_CONFLICT');
              if (duel && (stake === 'HIGH' || doubleDown)) violations.push('BIG_GAMBLE_CONFLICT');
              if (cover && stake === 'SAFE') violations.push('STAKE_INVALID');
              if (cover && doubleDown) violations.push('BIG_GAMBLE_CONFLICT');
              const verdict = checkRisk(state, me, {
                stake,
                doubleDown,
                ...(cover ? { cover } : {}),
                ...(pot ? { pot } : {}),
                ...(duel ? { duel: { targetId: ids[1]! } } : {}),
              });
              const label = JSON.stringify({ stake, doubleDown, cover, pot, duel });
              if (violations.length === 0) {
                expect(verdict, label).toBeNull();
                accepted += 1;
              } else {
                expect(verdict, label).not.toBeNull();
                expect(violations, label).toContain(verdict);
              }
            }
    expect(accepted).toBeGreaterThan(10);
    // checking never changed anything
    expect(h.round().commitments).toEqual({});
  });

  it('the stacked gain never passes the multiplier ceiling, with every legal combination', () => {
    const { h, ids } = setup(3);
    toRound(h, ids, 1);
    // RISK + Double Down is the biggest legal own-answer stack: 4x becomes the 3x ceiling.
    risk(h, ids[0]!, { stake: 'RISK', doubleDown: true });
    risk(h, ids[1]!, { stake: 'RISK', pot: true, cover: true });
    risk(h, ids[2]!, { stake: 'RISK', pot: true, duel: { targetId: ids[1]! } });
    respondDuel(h, ids[1]!, ids[2]!, true);
    answerAll(h, ids, {}, { [ids[0]!]: 1, [ids[1]!]: 1500, [ids[2]!]: 3000 });
    const deltas = settle(h);
    const own = (id: string) =>
      deltas[id]!.components.filter((c) =>
        ['BASE', 'STAKE', 'SPEED', 'DOUBLE_DOWN', 'CAP', 'FIFTY_FIFTY'].includes(c.kind),
      ).reduce((sum, c) => sum + c.points, 0);
    const baseAndSpeed = (id: string) =>
      deltas[id]!.components.filter((c) => c.kind === 'BASE' || c.kind === 'SPEED').reduce(
        (sum, c) => sum + c.points,
        0,
      );
    expect(own(ids[0]!)).toBeLessThanOrEqual(3 * baseAndSpeed(ids[0]!));
    for (const id of ids) expect(own(id)).toBeLessThanOrEqual(3 * baseAndSpeed(id));
    // transfers sit outside the chain but inside the absolute cap
    for (const id of ids)
      expect(deltas[id]!.delta).toBeLessThanOrEqual(
        h.state.config.scoring.maxGainPerQuestion.STANDARD,
      );
  });
});

describe('Who Said It and personal quizzes', () => {
  it('the author of a statement is never challenged out loud, never joins a pot, and the table cannot tell', () => {
    const h = new Harness({ tier: 'FULL' });
    const ids = h.joinPlayers(3);
    h.apply({ kind: 'SET_CONTENT', mode: 'WHO_SAID_IT', ref: null, title: null, rounds: 10 });
    ids.forEach((id, i) =>
      h.command(h.actor(id), { type: 'SUBMIT_STATEMENT', payload: { text: `söz numara ${i}` } }),
    );
    h.start();
    h.runUntil('RISK_PICK');
    const author = h.state.game!.deck.questions[h.round().questionId]!.authorPlayerId!;
    const others = ids.filter((id) => id !== author);
    // The author is a legal target as far as the challenger can tell: no refusal that would give them away.
    expect(risk(h, others[0]!, { stake: 'RISK', duel: { targetId: author } }).ok).toBe(true);
    expect(youOf(h, author).duelInvites).toBeUndefined();
    expect(refusal(risk(h, author, { pot: true }))).toBe('ANSWER_NOT_ALLOWED');
    expect(refusal(respondDuel(h, author, others[0]!, true))).toBe('ANSWER_NOT_ALLOWED');
    risk(h, others[1]!);
    h.runUntil('ANSWERING');
    for (const id of others) h.answer(id, 'correct');
    const items = resolutionItems(h);
    expect(items).toContainEqual(
      expect.objectContaining({ kind: 'DUEL', rivalId: author, accepted: false }),
    );
    const deltas = settle(h);
    expect(deltas[author]).toBeUndefined();
  });

  it('plays the same on a personal (blind) deck', () => {
    const { h, ids } = setup(3);
    edit(h, (draft) => {
      for (const q of Object.values(draft.game!.deck.questions)) q.source = 'BLIND';
    });
    toRound(h, ids, 1);
    risk(h, ids[0]!, { stake: 'RISK', cover: true });
    answerAll(h, ids, { [ids[0]!]: 'wrong' });
    expect(settle(h)[ids[0]!]!.delta).toBe(-50);
  });
});

describe('old data and config', () => {
  it('a config stored before ADR-0023 parses and every new thing is on', () => {
    const old = JSON.parse(JSON.stringify(DEFAULT_GAME_CONFIG)) as {
      version: number;
      powers: Record<string, unknown>;
    };
    for (const key of ['cover', 'duel', 'pot', 'stakeCap', 'cut', 'blindClock'])
      delete old.powers[key];
    old.version = 2;
    const parsed = GameConfigSchema.parse(old);
    const h = new Harness({ config: parsed });
    const ids = h.joinPlayers(3);
    h.start();
    toRound(h, ids, 1);
    expect(riskData(h).risks).toMatchObject({ cover: true });
    expect(risk(h, ids[0]!, { stake: 'RISK', cover: true }).ok).toBe(true);
  });

  it('a venue can override one switch without touching the rest', () => {
    const { h, ids } = setup(3, { powers: { duel: { enabled: false } } });
    toRound(h, ids, 1);
    expect(h.state.config.powers.duel).toMatchObject({ enabled: false, win: 80 });
    expect(riskData(h).risks).toMatchObject({ cover: true, duel: null });
  });
});
