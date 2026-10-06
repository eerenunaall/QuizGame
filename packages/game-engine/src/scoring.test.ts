import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RISK_TIERS, ROUND_KINDS } from '@quizparty/protocol';
import { DEFAULT_GAME_CONFIG, resolveGameConfig } from './config';
import { computeScore, speedBonus, sumComponents, type ScoreInput } from './scoring';

const config = DEFAULT_GAME_CONFIG;

const base: ScoreInput = {
  roundKind: 'STANDARD',
  answered: true,
  correct: true,
  remainingMs: 15_000,
  answerMs: 15_000,
  stake: undefined,
  doubleDown: false,
  fiftyFifty: false,
  pointTaxPending: false,
  connectedAtLock: true,
  currentScore: 500,
};
const score = (override: Partial<ScoreInput>, cfg = config) =>
  computeScore({ ...base, ...override }, cfg);

describe('speedBonus', () => {
  it('is linear, floored and clamped at the boundaries', () => {
    expect(speedBonus(100, 15_000, 15_000)).toBe(100);
    expect(speedBonus(100, 0, 15_000)).toBe(0);
    expect(speedBonus(100, 7_500, 15_000)).toBe(50);
    expect(speedBonus(100, 14_999, 15_000)).toBe(99);
    expect(speedBonus(100, 1, 15_000)).toBe(0);
    expect(speedBonus(100, -5, 15_000)).toBe(0);
    expect(speedBonus(100, 99_999, 15_000)).toBe(100);
  });

  it('tolerates a zero-length window', () => {
    expect(speedBonus(100, 10, 0)).toBe(0);
  });
});

describe('computeScore — gains', () => {
  it.each([
    ['instant answer', { remainingMs: 15_000 }, 200],
    ['last-moment answer', { remainingMs: 0 }, 100],
    ['half the clock left', { remainingMs: 7_500 }, 150],
    ['one ms into the window', { remainingMs: 14_999 }, 199],
    ['RISK stake', { stake: 'RISK' as const, remainingMs: 0 }, 200],
    ['HIGH stake with speed', { stake: 'HIGH' as const, remainingMs: 15_000 }, 400],
    ['double down', { doubleDown: true, remainingMs: 15_000 }, 400],
    ['50/50 halves the gain (default rule)', { fiftyFifty: true, remainingMs: 15_000 }, 100],
    ['double down + 50/50', { doubleDown: true, fiftyFifty: true, remainingMs: 15_000 }, 200],
    ['point tax removes 25 %', { pointTaxPending: true, remainingMs: 15_000 }, 150],
  ])('%s', (_name, override, expected) => {
    const result = score(override);
    expect(result.outcome).toBe('CORRECT');
    expect(result.delta).toBe(expected);
    expect(sumComponents(result.components)).toBe(result.delta);
  });

  it('consumes the point tax only when a gain is taxed', () => {
    expect(score({ pointTaxPending: true }).consumedPointTax).toBe(true);
    expect(score({ pointTaxPending: true, correct: false }).consumedPointTax).toBe(false);
  });

  it('applies the per-question cap and records it', () => {
    const capped = resolveGameConfig({ scoring: { maxGainPerQuestion: { STANDARD: 250 } } });
    const result = score({ stake: 'HIGH', doubleDown: true }, capped);
    expect(result.delta).toBe(250);
    expect(result.components.at(-1)).toEqual({ kind: 'CAP', points: expect.any(Number) });
    expect(sumComponents(result.components)).toBe(250);
  });

  it('speed round pays a larger speed bonus on a shorter clock', () => {
    const result = score({ roundKind: 'SPEED', answerMs: 8_000, remainingMs: 8_000 });
    expect(result.delta).toBe(100 + 200);
  });

  it('final round has no safe tier: the default is the lowest offered stake', () => {
    const result = score({ roundKind: 'FINAL', answerMs: 12_000, remainingMs: 0 });
    expect(result.delta).toBe(200 * 2);
  });

  it('final ALL_IN with double down stays under the final cap', () => {
    const result = score({
      roundKind: 'FINAL',
      stake: 'ALL_IN',
      doubleDown: true,
      answerMs: 12_000,
      remainingMs: 12_000,
    });
    expect(result.delta).toBe((200 * 5 + 200) * 2);
    expect(result.delta).toBeLessThanOrEqual(config.scoring.maxGainPerQuestion.FINAL);
  });

  it('falls back to the default tier when a stake is not on the ladder', () => {
    expect(score({ stake: 'ALL_IN', remainingMs: 0 }).delta).toBe(100);
  });
});

describe('computeScore — losses', () => {
  it.each([
    ['SAFE costs nothing', { stake: 'SAFE' as const }, 0, 500],
    ['RISK loses 100', { stake: 'RISK' as const }, -100, 500],
    ['HIGH loses 200', { stake: 'HIGH' as const }, -200, 500],
    ['double down adds 100', { doubleDown: true }, -100, 500],
    ['HIGH + double down loses 300', { stake: 'HIGH' as const, doubleDown: true }, -300, 500],
    ['loss never takes the score below zero', { stake: 'HIGH' as const }, -50, 50],
    ['zero score loses nothing', { stake: 'HIGH' as const }, 0, 0],
  ])('wrong answer: %s', (_name, override, expected, currentScore) => {
    const result = score({ correct: false, currentScore, ...override });
    expect(result.outcome).toBe('INCORRECT');
    expect(result.delta).toBe(expected);
    expect(sumComponents(result.components)).toBe(result.delta);
  });

  it('50/50 adds no extra penalty', () => {
    expect(score({ correct: false, fiftyFifty: true }).delta).toBe(0);
    expect(score({ correct: false, fiftyFifty: true, stake: 'RISK' }).delta).toBe(-100);
  });

  it('RISK rounds are symmetric ("stake lost")', () => {
    expect(score({ roundKind: 'RISK', correct: false, stake: 'HIGH' }).delta).toBe(-300);
  });

  it('no answer: free when nothing is at stake', () => {
    const result = score({ answered: false, correct: false });
    expect(result).toMatchObject({ outcome: 'NO_ANSWER', delta: 0 });
  });

  it('no answer with a stake costs the stake while online, nothing while offline', () => {
    expect(score({ answered: false, correct: false, stake: 'RISK' }).delta).toBe(-100);
    expect(
      score({ answered: false, correct: false, stake: 'RISK', connectedAtLock: false }).delta,
    ).toBe(0);
  });

  it('final: not answering is penalised at the default mandatory tier', () => {
    expect(score({ roundKind: 'FINAL', answered: false, correct: false }).delta).toBe(-150);
  });
});

describe('computeScore — properties', () => {
  const arbitraryInput = fc.record({
    roundKind: fc.constantFrom(...ROUND_KINDS),
    answered: fc.boolean(),
    correct: fc.boolean(),
    remainingMs: fc.integer({ min: -1_000, max: 70_000 }),
    answerMs: fc.integer({ min: 1_000, max: 60_000 }),
    stake: fc.option(fc.constantFrom(...RISK_TIERS), { nil: undefined }),
    doubleDown: fc.boolean(),
    fiftyFifty: fc.boolean(),
    pointTaxPending: fc.boolean(),
    connectedAtLock: fc.boolean(),
    currentScore: fc.integer({ min: 0, max: 1_000_000 }),
  });

  it('always yields a safe integer, never drives the score negative, respects the cap', () => {
    fc.assert(
      fc.property(arbitraryInput, (input) => {
        const result = computeScore(input, config);
        expect(Number.isSafeInteger(result.delta)).toBe(true);
        expect(input.currentScore + result.delta).toBeGreaterThanOrEqual(0);
        expect(result.delta).toBeLessThanOrEqual(
          config.scoring.maxGainPerQuestion[input.roundKind],
        );
        expect(sumComponents(result.components)).toBe(result.delta);
        expect(result.components.every((c) => Number.isSafeInteger(c.points))).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('only correct answers gain and only non-correct answers lose', () => {
    fc.assert(
      fc.property(arbitraryInput, (input) => {
        const result = computeScore(input, config);
        if (result.outcome === 'CORRECT') expect(result.delta).toBeGreaterThan(0);
        else expect(result.delta).toBeLessThanOrEqual(0);
      }),
      { numRuns: 500 },
    );
  });

  it('is monotonic in time left (answering sooner never pays less)', () => {
    fc.assert(
      fc.property(
        arbitraryInput,
        fc.integer({ min: 0, max: 60_000 }),
        fc.integer({ min: 0, max: 60_000 }),
        (input, a, b) => {
          const low = Math.min(a, b);
          const high = Math.max(a, b);
          const slow = computeScore(
            { ...input, answered: true, correct: true, remainingMs: low },
            config,
          );
          const fast = computeScore(
            { ...input, answered: true, correct: true, remainingMs: high },
            config,
          );
          expect(fast.delta).toBeGreaterThanOrEqual(slow.delta);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('50/50 never increases a gain under the default rule', () => {
    fc.assert(
      fc.property(arbitraryInput, (input) => {
        const without = computeScore(
          { ...input, answered: true, correct: true, fiftyFifty: false },
          config,
        );
        const withIt = computeScore(
          { ...input, answered: true, correct: true, fiftyFifty: true },
          config,
        );
        expect(withIt.delta).toBeLessThanOrEqual(without.delta);
      }),
      { numRuns: 300 },
    );
  });
});
