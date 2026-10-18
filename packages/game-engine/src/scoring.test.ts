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
    // (1000 + 200) × 2 = 2400 would be 6× the base+speed of 400; the 5× ceiling holds it at 2000.
    expect(result.delta).toBe(5 * (200 + 200));
    expect(result.components.map((c) => c.kind)).toContain('CAP');
    expect(sumComponents(result.components)).toBe(result.delta);
    expect(result.delta).toBeLessThanOrEqual(config.scoring.maxGainPerQuestion.FINAL);
  });

  it('falls back to the default tier when a stake is not on the ladder', () => {
    expect(score({ stake: 'ALL_IN', remainingMs: 0 }).delta).toBe(100);
  });
});

describe('computeScore — total multiplier ceiling (ADR-0021)', () => {
  it('leaves combinations under the ceiling untouched', () => {
    // SAFE + Double Down at full speed: 2 × 200 = 400, ceiling 3 × 200 = 600.
    const result = score({ doubleDown: true });
    expect(result.delta).toBe(400);
    expect(result.components.map((c) => c.kind)).not.toContain('CAP');
  });

  it('holds RISK + Double Down at 3x (base + speed) and records the CAP component', () => {
    // (200 + 100) × 2 = 600 at full speed is under 3 × 200; with no speed, 400 > 3 × 100.
    expect(score({ stake: 'RISK', doubleDown: true, remainingMs: 15_000 }).delta).toBe(600);
    const slow = score({ stake: 'RISK', doubleDown: true, remainingMs: 0 });
    expect(slow.delta).toBe(300);
    expect(slow.components.at(-1)).toEqual({ kind: 'CAP', points: -100 });
    expect(sumComponents(slow.components)).toBe(300);
  });

  it('the owner example: HIGH 3x + Double Down no longer pays 800', () => {
    const result = score({ stake: 'HIGH', doubleDown: true, remainingMs: 15_000 });
    expect(result.delta).toBe(600);
    expect(result.delta).toBeLessThan(800);
  });

  it('is config-driven and falls back to the defaults when an old snapshot has no ceiling', () => {
    const tight = resolveGameConfig({ scoring: { maxTotalMultiplier: { STANDARD: 2 } } });
    expect(score({ stake: 'HIGH', remainingMs: 15_000 }, tight).delta).toBe(400);
    const legacy = JSON.parse(JSON.stringify(config)) as typeof config;
    delete (legacy.scoring as { maxTotalMultiplier?: unknown }).maxTotalMultiplier;
    expect(score({ stake: 'RISK', doubleDown: true, remainingMs: 0 }, legacy).delta).toBe(300);
  });
});

describe('computeScore — losses', () => {
  it.each([
    ['SAFE costs nothing', { stake: 'SAFE' as const }, 0, 500],
    ['RISK loses 100', { stake: 'RISK' as const }, -100, 500],
    ['HIGH loses 200', { stake: 'HIGH' as const }, -200, 500],
    ['double down adds 200', { doubleDown: true }, -200, 500],
    ['RISK + double down loses 300', { stake: 'RISK' as const, doubleDown: true }, -300, 500],
    ['HIGH + double down loses 400', { stake: 'HIGH' as const, doubleDown: true }, -400, 500],
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

  it('no gain ever exceeds ceiling x (base + speed), for any input', () => {
    fc.assert(
      fc.property(arbitraryInput, (input) => {
        const result = computeScore({ ...input, answered: true, correct: true }, config);
        const speed = speedBonus(
          config.scoring.speedMax[input.roundKind],
          input.remainingMs,
          input.answerMs,
        );
        const ceiling = config.scoring.maxTotalMultiplier![input.roundKind];
        expect(result.delta).toBeLessThanOrEqual(
          ceiling * (config.scoring.basePoints[input.roundKind] + speed),
        );
        expect(sumComponents(result.components)).toBe(result.delta);
      }),
      { numRuns: 1000 },
    );
  });

  it('Double Down alone breaks even at 40 % accuracy on SAFE and RISK (ADR-0021)', () => {
    // Expected value of a question with Double Down at accuracy p, over uniform speed, vs. the same
    // question without it: the joker must not be a free roll, nor a trap.
    const avg = (stake: 'SAFE' | 'RISK', doubleDown: boolean, correct: boolean): number => {
      let total = 0;
      const steps = 100;
      for (let i = 0; i <= steps; i++) {
        const r = computeScore(
          { ...base, stake, doubleDown, correct, remainingMs: (15_000 * i) / steps },
          config,
        );
        total += r.delta;
      }
      return total / (steps + 1);
    };
    for (const stake of ['SAFE', 'RISK'] as const) {
      const win = avg(stake, true, true);
      const loss = -avg(stake, true, false);
      const breakEven = loss / (win + loss);
      expect(breakEven).toBeGreaterThanOrEqual(0.38);
      expect(breakEven).toBeLessThanOrEqual(0.45);
    }
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
