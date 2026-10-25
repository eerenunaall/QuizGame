import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rankFresh, recentIds, type FreshHistoryEntry } from './freshness';

/** A small deterministic generator (mulberry32), the "injected randomness" of these tests. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pool = (n: number, category = 'c'): { id: string; category: string }[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${category}${i}`, category }));

describe('recentIds', () => {
  it('keeps the N most recently played per category, each category on its own', () => {
    const history: FreshHistoryEntry[] = [
      { id: 'a1', category: 'a', playedAt: 1 },
      { id: 'a2', category: 'a', playedAt: 2 },
      { id: 'a3', category: 'a', playedAt: 3 },
      { id: 'b1', category: 'b', playedAt: 0 },
    ];
    expect([...recentIds(history, 2).keys()].sort()).toEqual(['a2', 'a3', 'b1']);
    expect(recentIds(history, 0).size).toBe(0);
  });
});

describe('rankFresh', () => {
  it('puts unseen questions first and the longest unplayed seen ones next', () => {
    const history: FreshHistoryEntry[] = [
      { id: 'c0', category: 'c', playedAt: 30 },
      { id: 'c1', category: 'c', playedAt: 10 },
      { id: 'c2', category: 'c', playedAt: 20 },
    ];
    const ranked = rankFresh(pool(5), history, { window: 300, random: seeded(1) });
    expect(ranked.slice(0, 2).sort()).toEqual(['c3', 'c4']);
    expect(ranked.slice(2)).toEqual(['c1', 'c2', 'c0']);
  });

  it('does not count a question as recent once it fell out of the window', () => {
    const history: FreshHistoryEntry[] = [
      { id: 'c0', category: 'c', playedAt: 1 }, // oldest: out of a window of 2
      { id: 'c1', category: 'c', playedAt: 2 },
      { id: 'c2', category: 'c', playedAt: 3 },
    ];
    const ranked = rankFresh(pool(3), history, { window: 2, random: seeded(2) });
    expect(ranked[0]).toBe('c0');
    expect(ranked.slice(1)).toEqual(['c1', 'c2']);
  });

  it('always returns every candidate: a small pool never blocks a game', () => {
    const all = pool(4);
    const history: FreshHistoryEntry[] = all.map((c, i) => ({ ...c, playedAt: i }));
    const ranked = rankFresh(all, history, { window: 300, random: seeded(3) });
    expect([...ranked].sort()).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(rankFresh([], history, { window: 300, random: seeded(3) })).toEqual([]);
  });

  it('is deterministic for a given random source and differs between sources', () => {
    const a = rankFresh(pool(30), [], { window: 300, random: seeded(7) });
    const b = rankFresh(pool(30), [], { window: 300, random: seeded(7) });
    const c = rankFresh(pool(30), [], { window: 300, random: seeded(8) });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

/** Plays `games` decks of `perGame` questions and returns the picks in order (the clock ticks per game). */
function simulate(size: number, perGame: number, games: number, window: number, seed: number) {
  const candidates = pool(size);
  const random = seeded(seed);
  const history = new Map<string, FreshHistoryEntry>();
  const picks: string[] = [];
  let clock = 1_000;
  for (let game = 0; game < games; game++) {
    const deck = rankFresh(candidates, [...history.values()], { window, random }).slice(0, perGame);
    clock += 60_000;
    deck.forEach((id, i) => {
      picks.push(id);
      history.set(id, { id, category: 'c', playedAt: clock + i });
    });
  }
  return picks;
}

describe('over many simulated games in a 100-question category', () => {
  it('no question repeats before the pool is exhausted (window larger than the pool)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 ** 31 }),
        fc.integer({ min: 5, max: 20 }),
        fc.integer({ min: 100, max: 500 }),
        (seed, perGame, window) => {
          const picks = simulate(100, perGame, Math.ceil(100 / perGame) + 6, window, seed);
          expect(new Set(picks.slice(0, 100)).size).toBe(100);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('with a window smaller than the pool, a question waits at least a window of plays', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 ** 31 }),
        fc.integer({ min: 20, max: 60 }),
        (seed, window) => {
          const picks = simulate(100, 12, 40, window, seed);
          const last = new Map<string, number>();
          picks.forEach((id, position) => {
            const before = last.get(id);
            if (before !== undefined) expect(position - before).toBeGreaterThanOrEqual(window);
            last.set(id, position);
          });
        },
      ),
      { numRuns: 40 },
    );
  });

  it('every question gets played about equally often over a long evening', () => {
    const picks = simulate(100, 12, 100, 300, 42);
    const counts = new Map<string, number>();
    for (const id of picks) counts.set(id, (counts.get(id) ?? 0) + 1);
    const values = [...counts.values()];
    expect(counts.size).toBe(100);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });
});
