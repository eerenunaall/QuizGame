import { describe, expect, it } from 'vitest';
import type { PhaseDataOf } from '@quizparty/protocol';
import { player, ROUND, you } from '@quizparty/controller-client/fixtures';
import {
  defaultStake,
  doubleDownState,
  fiftyFiftyState,
  isFogged,
  isRemoved,
  jamSeconds,
  orderedOptions,
  personalDeadline,
  sabotageState,
  sabotageTargets,
} from './powers';

const prep = (patch: Partial<PhaseDataOf<'QUESTION_PREP'>> = {}): PhaseDataOf<'QUESTION_PREP'> => ({
  phase: 'QUESTION_PREP',
  round: ROUND,
  category: { id: 'sports', label: 'Spor' },
  difficulty: 'MEDIUM',
  riskLadder: [
    { tier: 'SAFE', multiplier: 1, loss: 0 },
    { tier: 'RISK', multiplier: 2, loss: 100 },
  ],
  stakeMandatory: false,
  doubleDownEnabled: true,
  sabotageEnabled: true,
  committedCount: 0,
  eligibleCount: 3,
  ...patch,
});

const holding = (patch: Record<string, unknown> = {}) =>
  you('p1', {
    powers: {
      fiftyFifty: 1,
      doubleDown: 2,
      shield: 1,
      sabotageTokens: 1,
      nextTokenAtStreak: 3,
      lockedJoker: null,
      ...patch,
    },
  });

describe('what a player may use', () => {
  it('Double Down: open, used up, locked out, or not offered', () => {
    expect(doubleDownState(prep(), holding())).toBeNull();
    expect(doubleDownState(prep(), holding({ doubleDown: 0 }))).toBe('NONE_LEFT');
    expect(doubleDownState(prep(), holding({ lockedJoker: 'DOUBLE_DOWN' }))).toBe('LOCKED');
    expect(doubleDownState(prep({ doubleDownEnabled: false }), holding())).toBe('CLOSED');
    expect(doubleDownState(prep(), you('p1'))).toBe('CLOSED'); // no game state yet
  });

  it('sabotage: open, no token, or closed this round', () => {
    expect(sabotageState(prep(), holding())).toBeNull();
    expect(sabotageState(prep(), holding({ sabotageTokens: 0 }))).toBe('NO_TOKEN');
    expect(sabotageState(prep({ sabotageEnabled: false }), holding())).toBe('CLOSED');
  });

  it('50/50: open, used up, or locked out', () => {
    expect(fiftyFiftyState(holding())).toBeNull();
    expect(fiftyFiftyState(holding({ fiftyFifty: 0 }))).toBe('NONE_LEFT');
    expect(fiftyFiftyState(holding({ lockedJoker: 'FIFTY_FIFTY' }))).toBe('LOCKED');
  });

  it('starts from the lowest rung, which is not SAFE on the very last question', () => {
    expect(defaultStake(prep())).toBe('SAFE');
    expect(
      defaultStake(
        prep({
          stakeMandatory: true,
          riskLadder: [
            { tier: 'RISK', multiplier: 2, loss: 150 },
            { tier: 'ALL_IN', multiplier: 5, loss: 400 },
          ],
        }),
      ),
    ).toBe('RISK');
  });

  it('targets are everyone but me', () => {
    const players = [player(0), player(1), player(2)];
    expect(sabotageTargets(players, 'p1').map((p) => p.playerId)).toEqual(['p0', 'p2']);
  });
});

describe('what sabotage does to one phone', () => {
  const options = ['a', 'b', 'c', 'd'].map((id) => ({ optionId: id, text: id.toUpperCase() }));

  it('lists options in the shuffled order, tolerating unknown and missing ids', () => {
    expect(orderedOptions(options, null).map((o) => o.optionId)).toEqual(['a', 'b', 'c', 'd']);
    expect(orderedOptions(options, ['c', 'a', 'd', 'b']).map((o) => o.optionId)).toEqual([
      'c',
      'a',
      'd',
      'b',
    ]);
    expect(orderedOptions(options, ['c', 'zzz', 'a']).map((o) => o.optionId)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });

  it('removes the options 50/50 took away', () => {
    expect(isRemoved('a', undefined)).toBe(false);
    expect(isRemoved('a', ['b', 'c'])).toBe(true);
    expect(isRemoved('b', ['b', 'c'])).toBe(false);
  });

  it('fogs one option only at the start of the window', () => {
    const fx = { jamMs: 0, order: null, fogOptionId: 'b', fogMs: 1500 };
    expect(isFogged('b', fx, 10_000, 10_500)).toBe(true);
    expect(isFogged('b', fx, 10_000, 11_500)).toBe(false);
    expect(isFogged('a', fx, 10_000, 10_500)).toBe(false);
    expect(isFogged('b', null, 10_000, 10_500)).toBe(false);
  });

  it('cuts the personal window by the jam and speaks in whole seconds', () => {
    expect(personalDeadline(25_000, null)).toBe(25_000);
    expect(
      personalDeadline(25_000, { jamMs: 2000, order: null, fogOptionId: null, fogMs: 0 }),
    ).toBe(23_000);
    expect(jamSeconds(0)).toBe(0);
    expect(jamSeconds(400)).toBe(1);
    expect(jamSeconds(2000)).toBe(2);
    expect(jamSeconds(1500)).toBe(2);
  });
});
