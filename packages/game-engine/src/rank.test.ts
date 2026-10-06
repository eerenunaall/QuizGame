import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rankPlayers } from './rank';

const p = (
  playerId: string,
  score: number,
  correctCount = 0,
  totalRemainingMs = 0,
  joinIndex = 0,
) => ({
  playerId,
  score,
  correctCount,
  totalRemainingMs,
  joinIndex,
});

describe('rankPlayers', () => {
  it('orders by score, then correct answers, then time left, then join order', () => {
    const ranked = rankPlayers([
      p('a', 100, 1, 0, 3),
      p('b', 300, 1, 0, 2),
      p('c', 100, 2, 0, 1),
      p('d', 100, 2, 5_000, 0),
    ]);
    expect(ranked.map((r) => r.playerId)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('gives tied players a shared rank and skips the next (1, 1, 3)', () => {
    const ranked = rankPlayers([
      p('a', 200, 2, 10, 0),
      p('b', 200, 2, 10, 1),
      p('c', 100, 1, 5, 2),
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(ranked.map((r) => r.playerId)).toEqual(['a', 'b', 'c']);
  });

  it('is a total order with ranks 1..n and no gaps before a tie', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 5 }),
            fc.integer({ min: 0, max: 3 }),
            fc.integer({ min: 0, max: 3 }),
          ),
          {
            maxLength: 8,
          },
        ),
        (rows) => {
          const ranked = rankPlayers(
            rows.map(([s, c, t], i) => p(`p${i}`, s * 100, c, t * 100, i)),
          );
          expect(ranked).toHaveLength(rows.length);
          for (let i = 0; i < ranked.length; i++) {
            expect(ranked[i]!.rank).toBeGreaterThanOrEqual(1);
            expect(ranked[i]!.rank).toBeLessThanOrEqual(i + 1);
            if (i > 0) expect(ranked[i]!.rank).toBeGreaterThanOrEqual(ranked[i - 1]!.rank);
          }
        },
      ),
    );
  });
});
