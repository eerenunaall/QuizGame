import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RISK_TIERS, ROUND_KINDS } from '@quizparty/protocol';
import { DEFAULT_GAME_CONFIG, maxTotalMultiplierFor, resolveGameConfig } from './config';
import { computeScore, sumComponents, type ScoreInput } from './scoring';

/**
 * ADR-0023: Cover (a fee now, a miss costs nothing) and Cut (a share of the next gain moves to the
 * attacker) inside the pure score. Numbers are the research doc's tables (docs/RISK_SABOTAGE_RESEARCH.md
 * R1 and S4) on the default config: base 100, speed 0..100, RISK x2 / loss 100, HIGH x3 / loss 200.
 */
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

describe('Cover — fee and waived loss', () => {
  it.each([
    ['RISK', 50],
    ['HIGH', 100],
  ] as const)('%s costs half the stake loss (%i) even when the answer is right', (tier, fee) => {
    const plain = score({ stake: tier });
    const covered = score({ stake: tier, cover: true });
    expect(covered.delta).toBe(plain.delta - fee);
    expect(covered.coverFee).toBe(fee);
    expect(covered.components).toContainEqual({ kind: 'COVER_FEE', points: -fee });
    expect(sumComponents(covered.components)).toBe(covered.delta);
  });

  it.each([
    ['RISK', 100, 50],
    ['HIGH', 200, 100],
  ] as const)('%s: a wrong answer loses only the fee, not %i', (tier, loss, fee) => {
    const result = score({ stake: tier, correct: false, cover: true });
    expect(result.outcome).toBe('INCORRECT');
    expect(result.delta).toBe(-fee);
    expect(result.coverSaved).toBe(loss);
    // The stake's PENALTY is waived, so the audit trail holds the fee alone.
    expect(result.components).toEqual([{ kind: 'COVER_FEE', points: -fee }]);
  });

  it('a missing answer from a connected player is covered too; an offline one pays nothing at all', () => {
    const missing = score({ stake: 'RISK', answered: false, correct: false, cover: true });
    expect(missing.outcome).toBe('NO_ANSWER');
    expect(missing.delta).toBe(-50);
    const offline = score({
      stake: 'RISK',
      answered: false,
      correct: false,
      cover: true,
      connectedAtLock: false,
    });
    expect(offline.delta).toBe(0);
    expect(offline.components).toEqual([]);
  });

  it('the fee is capped by what the player has: scores never go below zero', () => {
    const poor = score({ stake: 'RISK', correct: false, cover: true, currentScore: 20 });
    expect(poor.delta).toBe(-20);
    expect(sumComponents(poor.components)).toBe(-20);
    const broke = score({ stake: 'RISK', correct: false, cover: true, currentScore: 0 });
    expect(broke.delta).toBe(0);
  });

  it('a correct answer can pay the fee out of the same gain even from zero points', () => {
    const result = score({ stake: 'RISK', cover: true, currentScore: 0 });
    expect(result.delta).toBe(300 - 50);
  });

  it('does nothing on SAFE (nothing to insure) and nothing changes without the flag', () => {
    const safe = score({ stake: 'SAFE', cover: true });
    expect(safe.coverFee).toBe(0);
    expect(safe.delta).toBe(score({ stake: 'SAFE' }).delta);
    expect(score({ stake: 'RISK' }).coverFee).toBe(0);
  });

  it('FINAL ALL_IN: fee 200 against a loss of 400', () => {
    const wrong = score({ roundKind: 'FINAL', stake: 'ALL_IN', correct: false, cover: true });
    expect(wrong.delta).toBe(-200);
    expect(wrong.coverSaved).toBe(400);
  });

  it('when allowed with Double Down it waives the extra loss as well (research R1)', () => {
    const result = score({ stake: 'RISK', doubleDown: true, correct: false, cover: true });
    expect(result.delta).toBe(-50);
    expect(result.coverSaved).toBe(100 + 200);
  });

  it('the fee follows the configured share', () => {
    const cfg = resolveGameConfig({ powers: { cover: { feePermille: 250 } } });
    expect(score({ stake: 'HIGH', correct: false, cover: true }, cfg).delta).toBe(-50);
  });

  // Research R1: Cover beats no cover exactly when the player misses more often than half the time.
  it.each([
    [0.4, 'RISK', true],
    [0.6, 'RISK', false],
    [0.4, 'HIGH', true],
    [0.6, 'HIGH', false],
  ] as const)('EV: p=%d %s -> cover better is %s', (p, tier, coverBetter) => {
    const ev = (cover: boolean) =>
      p * score({ stake: tier, cover, remainingMs: 7_500 }).delta +
      (1 - p) * score({ stake: tier, cover, correct: false }).delta;
    expect(ev(true) > ev(false)).toBe(coverBetter);
  });
});

describe('Cut — a share of the next gain moves to the attacker', () => {
  it('takes 20 % of the gain, at most 30 points', () => {
    const big = score({ stake: 'RISK', cutPending: true }); // gain 300 -> 20 % = 60 -> capped at 30
    expect(big.cutAmount).toBe(30);
    expect(big.delta).toBe(270);
    const small = score({ remainingMs: 0, cutPending: true }); // gain 100 -> 20
    expect(small.cutAmount).toBe(20);
    expect(small.delta).toBe(80);
    expect(small.components).toContainEqual({ kind: 'CUT', points: -20 });
    expect(sumComponents(small.components)).toBe(small.delta);
  });

  it('is consumed by a gain, never by a miss', () => {
    expect(score({ cutPending: true }).consumedCut).toBe(true);
    const miss = score({ cutPending: true, correct: false, stake: 'RISK' });
    expect(miss.consumedCut).toBe(false);
    expect(miss.cutAmount).toBe(0);
  });

  it('takes its share of what is left after POINT_TAX, and after the caps', () => {
    const both = score({ remainingMs: 0, pointTaxPending: true, cutPending: true });
    // gain 100 -> tax 25 -> 75 -> cut floor(15) = 15
    expect(both.cutAmount).toBe(15);
    expect(both.delta).toBe(60);
    const capped = resolveGameConfig({ scoring: { maxGainPerQuestion: { STANDARD: 150 } } });
    expect(score({ stake: 'HIGH', cutPending: true }, capped).cutAmount).toBe(30);
    expect(score({ stake: 'HIGH', cutPending: true }, capped).delta).toBe(120);
  });

  it('follows the configured share and ceiling', () => {
    const cfg = resolveGameConfig({ powers: { cut: { permille: 100, maxPoints: 5 } } });
    expect(score({ remainingMs: 0, cutPending: true }, cfg).cutAmount).toBe(5);
  });

  it('Cover and Cut together: both appear in the audit trail and add up', () => {
    const result = score({ stake: 'RISK', cover: true, cutPending: true });
    expect(result.delta).toBe(300 - 30 - 50);
    expect(sumComponents(result.components)).toBe(result.delta);
  });
});

describe('Cover and Cut — properties', () => {
  const input = fc.record({
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
    currentScore: fc.integer({ min: 0, max: 100_000 }),
    cover: fc.boolean(),
    cutPending: fc.boolean(),
  });

  it('the audit trail always adds up and nobody ends below zero', () => {
    fc.assert(
      fc.property(input, (i) => {
        const result = computeScore(i, config);
        expect(sumComponents(result.components)).toBe(result.delta);
        expect(i.currentScore + result.delta).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 400 },
    );
  });

  it('a gain never exceeds the multiplier ceiling nor the absolute cap, whatever is stacked', () => {
    fc.assert(
      fc.property(input, (i) => {
        const result = computeScore(i, config);
        if (result.outcome !== 'CORRECT') return;
        const kind = i.roundKind;
        const baseAndSpeed = result.components
          .filter((c) => c.kind === 'BASE' || c.kind === 'SPEED')
          .reduce((sum, c) => sum + c.points, 0);
        // Cut and the Cover fee only ever subtract from a gain: they cannot push it past the limits.
        expect(result.delta).toBeLessThanOrEqual(
          maxTotalMultiplierFor(config, kind) * baseAndSpeed,
        );
        expect(result.delta).toBeLessThanOrEqual(config.scoring.maxGainPerQuestion[kind]);
      }),
      { numRuns: 400 },
    );
  });

  it('Cover never makes a loss bigger than the uncovered loss, and never turns a loss into a gain', () => {
    fc.assert(
      fc.property(input, (i) => {
        if (i.correct && i.answered) return;
        const plain = computeScore({ ...i, cover: false }, config);
        const covered = computeScore({ ...i, cover: true }, config);
        expect(covered.delta).toBeLessThanOrEqual(0);
        expect(covered.delta).toBeGreaterThanOrEqual(plain.delta);
      }),
      { numRuns: 400 },
    );
  });

  it('the Cut amount never exceeds its ceiling or the gain', () => {
    fc.assert(
      fc.property(input, (i) => {
        const result = computeScore({ ...i, cutPending: true }, config);
        expect(result.cutAmount).toBeLessThanOrEqual(config.powers.cut!.maxPoints);
        if (result.outcome !== 'CORRECT') expect(result.cutAmount).toBe(0);
      }),
      { numRuns: 300 },
    );
  });
});
