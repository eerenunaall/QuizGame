import { describe, expect, it } from 'vitest';
import type { PhaseDataOf } from '@quizparty/protocol';
import { player, ROUND, you } from './fixtures';
import {
  ORIGINAL_SABOTAGES,
  acceptBlock,
  coverBlock,
  coverFee,
  cutBlock,
  duelBlock,
  duelRivals,
  potBlock,
  sabotageKinds,
  stakeCapOf,
  stakeCapped,
} from './powers';

/** ADR-0023: the pure rules both phone apps share for the new risks and sabotages. */
const data: PhaseDataOf<'RISK_PICK'> = {
  phase: 'RISK_PICK',
  round: ROUND,
  category: { id: 'sports', label: 'Spor' },
  difficulty: 'MEDIUM',
  riskLadder: [
    { tier: 'SAFE', multiplier: 1, loss: 0, coverFee: 0 },
    { tier: 'RISK', multiplier: 2, loss: 100, coverFee: 50 },
    { tier: 'HIGH', multiplier: 3, loss: 200, coverFee: 100 },
  ],
  stakeMandatory: false,
  doubleDownEnabled: true,
  doubleDownExcludedStakes: ['HIGH', 'ALL_IN'],
  sabotageEnabled: true,
  risks: { cover: true, duel: { win: 80, bothRight: 40 }, pot: { ante: 30, minPlayers: 3 } },
  committedCount: 0,
  eligibleCount: 3,
};
const powers = (patch: Record<string, unknown> = {}) => ({
  fiftyFifty: 1,
  doubleDown: 2,
  shield: 1,
  sabotageTokens: 1,
  nextTokenAtStreak: null,
  lockedJoker: null,
  cover: 1,
  duel: 2,
  pot: 2,
  ...patch,
});
const me = (patch: Record<string, unknown> = {}) => you('p1', { powers: powers(patch) });
const choice = (stake: 'SAFE' | 'RISK' | 'HIGH', doubleDown = false) => ({ stake, doubleDown });

describe('coverBlock', () => {
  it('is free on RISK and HIGH and says why not on SAFE, with Double Down or when used up', () => {
    expect(coverBlock(data, me(), choice('RISK'))).toBeNull();
    expect(coverBlock(data, me(), choice('HIGH'))).toBeNull();
    expect(coverBlock(data, me(), choice('SAFE'))).toBe('NEEDS_STAKE');
    expect(coverBlock(data, me(), choice('RISK', true))).toBe('BIG_GAMBLE');
    expect(coverBlock(data, me({ cover: 0 }), choice('RISK'))).toBe('NONE_LEFT');
  });

  it('is off when the venue does not offer it, and on older servers', () => {
    expect(
      coverBlock({ ...data, risks: { ...data.risks!, cover: false } }, me(), choice('RISK')),
    ).toBe('OFF');
    const old = { ...data };
    delete old.risks;
    expect(coverBlock(old, me(), choice('RISK'))).toBe('OFF');
  });

  it('knows the fee of the chosen rung', () => {
    expect(coverFee(data, choice('RISK'))).toBe(50);
    expect(coverFee(data, choice('HIGH'))).toBe(100);
  });
});

describe('potBlock', () => {
  it('needs a use, the ante and enough players', () => {
    expect(potBlock(data, me(), 100, 3)).toBeNull();
    expect(potBlock(data, me(), 29, 3)).toBe('POINTS');
    expect(potBlock(data, me(), 100, 2)).toBe('ROOM_SIZE');
    expect(potBlock(data, me({ pot: 0 }), 100, 3)).toBe('NONE_LEFT');
  });
});

describe('duelBlock and acceptBlock', () => {
  it('one big gamble: not with HIGH or Double Down, and needs a rival online', () => {
    expect(duelBlock(data, me(), choice('RISK'), 2, 3)).toBeNull();
    expect(duelBlock(data, me(), choice('HIGH'), 2, 3)).toBe('BIG_GAMBLE');
    expect(duelBlock(data, me(), choice('RISK', true), 2, 3)).toBe('BIG_GAMBLE');
    expect(duelBlock(data, me(), choice('RISK'), 0, 3)).toBe('NO_RIVAL');
    expect(duelBlock(data, me({ duel: 0 }), choice('RISK'), 2, 3)).toBe('NONE_LEFT');
  });

  it('accepting is refused when this player already holds a big gamble or another accepted duel', () => {
    expect(acceptBlock(data, me(), null)).toBeNull();
    expect(acceptBlock(data, me(), { stake: 'RISK', doubleDown: false })).toBeNull();
    expect(acceptBlock(data, me(), { stake: 'HIGH', doubleDown: false })).toBe('BIG_GAMBLE');
    expect(acceptBlock(data, me(), { stake: 'RISK', doubleDown: true })).toBe('BIG_GAMBLE');
    expect(acceptBlock(data, me(), { stake: 'RISK', doubleDown: false, duel: {} })).toBe(
      'BIG_GAMBLE',
    );
    const accepted = you('p1', {
      powers: powers(),
      duelInvites: [{ challengerId: 'p0', answer: 'ACCEPTED' }],
    });
    expect(acceptBlock(data, accepted, null)).toBe('NONE_LEFT');
  });

  it('rivals are the other players who are online', () => {
    const players = [player(0), player(1, { connection: 'DISCONNECTED' }), player(2), player(3)];
    expect(duelRivals(players, 'p3').map((p) => p.playerId)).toEqual(['p0', 'p2']);
  });
});

describe('Stake Cap', () => {
  it('closes every rung above the cap', () => {
    const capped = me({ stakeCap: 'RISK' });
    expect(stakeCapOf(capped)).toBe('RISK');
    expect(stakeCapped(capped, 'SAFE')).toBe(false);
    expect(stakeCapped(capped, 'RISK')).toBe(false);
    expect(stakeCapped(capped, 'HIGH')).toBe(true);
    expect(stakeCapped(capped, 'ALL_IN')).toBe(true);
    expect(stakeCapped(me(), 'HIGH')).toBe(false);
    expect(stakeCapped(null, 'HIGH')).toBe(false);
  });
});

describe('cutBlock', () => {
  const board = [
    { playerId: 'a', score: 400, rank: 1 },
    { playerId: 'b', score: 250, rank: 2 },
    { playerId: 'c', score: 0, rank: 3 },
  ];
  it('never the leader, never somebody with no points', () => {
    expect(cutBlock(board, 'a')).toBe('LEADER');
    expect(cutBlock(board, 'c')).toBe('NO_POINTS');
    expect(cutBlock(board, 'b')).toBeNull();
    expect(cutBlock(board, 'unknown')).toBeNull();
  });
});

describe('sabotageKinds', () => {
  it('is the server menu, or the original five from an older server', () => {
    const menu: PhaseDataOf<'SABOTAGE_PICK'> = {
      phase: 'SABOTAGE_PICK',
      round: ROUND,
      category: { id: 'x', label: 'X' },
      difficulty: 'EASY',
      offered: ['JAM', 'CUT'],
      committedCount: 0,
      eligibleCount: 2,
    };
    expect(sabotageKinds(menu)).toEqual(['JAM', 'CUT']);
    const { offered: _offered, ...old } = menu;
    expect(sabotageKinds(old)).toEqual(ORIGINAL_SABOTAGES);
    expect(sabotageKinds(null)).toEqual(ORIGINAL_SABOTAGES);
  });
});
