import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveDuel, settlePot, type DuelSide, type PotEntry } from './risks';

/**
 * ADR-0023: the pure settlement rules behind Pot (R5) and Duel (R2). Both move points between players
 * and never create any, so every property here is a conservation law.
 */
const entry = (playerId: string, correct: boolean, offsetMs: number, joinIndex = 0): PotEntry => ({
  playerId,
  correct,
  offsetMs,
  joinIndex,
});

describe('settlePot', () => {
  it('splits the pot equally between the right answers', () => {
    const result = settlePot([entry('a', true, 1), entry('b', true, 2), entry('c', false, 3)], 30);
    expect(result.size).toBe(90);
    expect(result.refunded).toBe(false);
    expect(result.payouts).toEqual({ a: 45, b: 45, c: 0 });
    expect(result.winnerIds).toEqual(['a', 'b']);
  });

  it('gives the remainder to the fastest right answer', () => {
    const result = settlePot(
      [entry('a', true, 900), entry('b', true, 100), entry('c', true, 500), entry('d', false, 1)],
      31,
    );
    // 124 / 3 = 41 remainder 1 -> b is fastest
    expect(result.payouts).toEqual({ a: 41, b: 42, c: 41, d: 0 });
  });

  it('breaks a speed tie by seat', () => {
    const result = settlePot(
      [entry('a', true, 100, 2), entry('b', true, 100, 1), entry('c', false, 1, 3)],
      31,
    );
    // 93 / 2 = 46 remainder 1 -> b (lower join index)
    expect(result.payouts).toEqual({ a: 46, b: 47, c: 0 });
  });

  it('refunds everybody when nobody is right', () => {
    const result = settlePot(
      [entry('a', false, 1), entry('b', false, 2), entry('c', false, 3)],
      30,
    );
    expect(result.refunded).toBe(true);
    expect(result.payouts).toEqual({ a: 30, b: 30, c: 30 });
    expect(result.winnerIds).toEqual([]);
  });

  it('one right answer takes the whole pot', () => {
    const result = settlePot([entry('a', true, 1), entry('b', false, 2), entry('c', false, 3)], 30);
    expect(result.payouts).toEqual({ a: 90, b: 0, c: 0 });
  });

  it('conserves points for any field', () => {
    const field = fc.array(
      fc.record({ correct: fc.boolean(), offsetMs: fc.integer({ min: 0, max: 30_000 }) }),
      { minLength: 2, maxLength: 8 },
    );
    fc.assert(
      fc.property(field, fc.integer({ min: 1, max: 500 }), (players, ante) => {
        const entries = players.map((p, i) => entry(`p${i}`, p.correct, p.offsetMs, i));
        const result = settlePot(entries, ante);
        const paid = Object.values(result.payouts).reduce((sum, n) => sum + n, 0);
        expect(paid).toBe(ante * entries.length);
        expect(result.size).toBe(paid);
        for (const n of Object.values(result.payouts)) expect(n).toBeGreaterThanOrEqual(0);
        // A wrong answer never profits from the pot.
        for (const e of entries)
          if (!e.correct && !result.refunded) expect(result.payouts[e.playerId]).toBe(0);
      }),
      { numRuns: 300 },
    );
  });
});

const side = (playerId: string, correct: boolean, offsetMs: number | null): DuelSide => ({
  playerId,
  correct,
  offsetMs,
});
const rules = { win: 80, bothRight: 40 };

describe('resolveDuel', () => {
  it('the right one takes 80 from the wrong one, either way round', () => {
    expect(resolveDuel(side('a', true, 5), side('b', false, 5), rules)).toEqual({
      winnerId: 'a',
      points: 80,
    });
    expect(resolveDuel(side('a', false, 5), side('b', true, 5), rules)).toEqual({
      winnerId: 'b',
      points: 80,
    });
  });

  it('an unanswered duel counts as wrong, even for a challenger who vanished', () => {
    expect(resolveDuel(side('a', false, null), side('b', true, 9), rules)).toEqual({
      winnerId: 'b',
      points: 80,
    });
  });

  it('both right: the faster takes 40; a tie moves nothing', () => {
    expect(resolveDuel(side('a', true, 900), side('b', true, 400), rules)).toEqual({
      winnerId: 'b',
      points: 40,
    });
    expect(resolveDuel(side('a', true, 400), side('b', true, 400), rules)).toEqual({
      winnerId: null,
      points: 0,
    });
  });

  it('both wrong: nothing', () => {
    expect(resolveDuel(side('a', false, 1), side('b', false, 2), rules)).toEqual({
      winnerId: null,
      points: 0,
    });
  });

  it('never moves more than the configured amounts and always names one of the two', () => {
    const one = fc.record({
      correct: fc.boolean(),
      offsetMs: fc.option(fc.integer({ min: 0, max: 30_000 }), { nil: null }),
    });
    fc.assert(
      fc.property(one, one, (x, y) => {
        const result = resolveDuel(
          side('a', x.correct, x.offsetMs),
          side('b', y.correct, y.offsetMs),
          rules,
        );
        expect(result.points).toBeLessThanOrEqual(80);
        expect(['a', 'b', null]).toContain(result.winnerId);
        expect(result.points === 0).toBe(result.winnerId === null);
      }),
      { numRuns: 300 },
    );
  });

  // Research R2: between equals the Duel is worth nothing on average; the stronger player gains.
  it('expected value is zero between equals and positive for the stronger player', () => {
    const evForA = (pa: number, pb: number): number => {
      let total = 0;
      for (const [aRight, bRight] of [
        [true, true],
        [true, false],
        [false, true],
        [false, false],
      ] as const) {
        const probability = (aRight ? pa : 1 - pa) * (bRight ? pb : 1 - pb);
        // Equal speed in the "both right" case, so the faster-takes-40 branch averages out.
        const result = resolveDuel(side('a', aRight, 500), side('b', bRight, 500), rules);
        const sign = result.winnerId === 'a' ? 1 : result.winnerId === 'b' ? -1 : 0;
        total += probability * sign * result.points;
      }
      return total;
    };
    expect(evForA(0.6, 0.6)).toBeCloseTo(0);
    expect(evForA(0.7, 0.5)).toBeCloseTo(16);
  });
});
