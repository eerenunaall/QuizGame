import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Rng, rngStateFromSeed } from './rng';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(rngStateFromSeed('room-1'));
    const b = new Rng(rngStateFromSeed('room-1'));
    expect(Array.from({ length: 20 }, () => a.nextU32())).toEqual(
      Array.from({ length: 20 }, () => b.nextU32()),
    );
  });

  it('produces different streams for different seeds', () => {
    const a = new Rng(rngStateFromSeed('a'));
    const b = new Rng(rngStateFromSeed('b'));
    expect(a.nextU32()).not.toBe(b.nextU32());
  });

  it('resumes exactly from a serialized state (crash-recovery replay)', () => {
    const rng = new Rng(rngStateFromSeed('resume'));
    for (let i = 0; i < 7; i++) rng.nextU32();
    const saved = JSON.parse(JSON.stringify(rng.state())) as ReturnType<Rng['state']>;
    const expected = Array.from({ length: 10 }, () => rng.nextU32());
    const resumed = new Rng(saved);
    expect(Array.from({ length: 10 }, () => resumed.nextU32())).toEqual(expected);
  });

  it('int() stays in range and covers it', () => {
    const rng = new Rng(rngStateFromSeed('range'));
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('int() is roughly uniform', () => {
    const rng = new Rng(rngStateFromSeed('uniform'));
    const counts = Array.from({ length: 4 }, () => 0);
    const n = 40_000;
    for (let i = 0; i < n; i++) counts[rng.int(4)]! += 1;
    for (const c of counts) expect(Math.abs(c - n / 4)).toBeLessThan(n * 0.02);
  });

  it('rejects invalid bounds', () => {
    const rng = new Rng(rngStateFromSeed('x'));
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(1.5)).toThrow(RangeError);
    expect(rng.int(1)).toBe(0);
  });

  it('shuffle returns a permutation and does not mutate its input', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 40 }), fc.string(), (items, seed) => {
        const input = items.slice();
        const out = new Rng(rngStateFromSeed(seed)).shuffle(input);
        expect(input).toEqual(items);
        expect(out.slice().sort((x, y) => x - y)).toEqual(items.slice().sort((x, y) => x - y));
      }),
    );
  });

  it('weightedIndex honours zero weights and falls back to uniform when all are zero', () => {
    const rng = new Rng(rngStateFromSeed('w'));
    for (let i = 0; i < 500; i++) expect(rng.weightedIndex([0, 5, 0, 1])).not.toBe(0);
    const seen = new Set(Array.from({ length: 200 }, () => rng.weightedIndex([0, 0, 0])));
    expect(seen.size).toBe(3);
    expect(() => rng.weightedIndex([1, -1])).toThrow(RangeError);
  });

  it('chance() handles the permille boundaries exactly', () => {
    const rng = new Rng(rngStateFromSeed('c'));
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1000)).toBe(true);
    }
  });
});
