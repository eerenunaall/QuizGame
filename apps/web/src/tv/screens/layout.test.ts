import { describe, expect, it } from 'vitest';
import {
  answerFontSize,
  crowdSummary,
  explanationFontSize,
  questionFontSize,
  votePercent,
} from './TvQuestion';
import { isCrowned, rowHeightFor } from './TvScore';

const nonIncreasing = (sizes: number[]): boolean =>
  sizes.every((s, i) => i === 0 || s <= sizes[i - 1]!);

describe('TV text sizing', () => {
  const lengths = [1, 10, 17, 18, 24, 25, 36, 37, 48, 49, 60, 61, 80, 81, 120, 200, 400, 600];

  it('never grows with longer text', () => {
    for (const compact of [false, true])
      expect(nonIncreasing(lengths.map((n) => answerFontSize('x'.repeat(n), compact)))).toBe(true);
    expect(nonIncreasing(lengths.map((n) => questionFontSize('x'.repeat(n))))).toBe(true);
    expect(nonIncreasing(lengths.map((n) => explanationFontSize('x'.repeat(n))))).toBe(true);
  });

  it('keeps answers readable from the sofa (28 px and up at 1080p) and compact never larger', () => {
    for (const n of lengths) {
      const roomy = answerFontSize('x'.repeat(n), false);
      const compact = answerFontSize('x'.repeat(n), true);
      expect(compact).toBeGreaterThanOrEqual(28);
      expect(compact).toBeLessThanOrEqual(roomy);
    }
    expect(questionFontSize('x'.repeat(600))).toBeGreaterThanOrEqual(40);
    expect(explanationFontSize('x'.repeat(600))).toBeGreaterThanOrEqual(28);
  });

  it('fits the longest answer the question rubric allows on a 160 px card', () => {
    // Baloo 2 ExtraBold averages about 0.52 em per glyph; the text box is 600 px (420 px when
    // faces take room). Count the wrapped lines and check them against the 136 px of inner height.
    const linesNeeded = (text: string, size: number, width: number): number =>
      Math.ceil((text.length * size * 0.52) / width);
    for (const n of [12, 24, 40, 60, 80, 100]) {
      const text = 'x'.repeat(n);
      for (const [compact, width] of [
        [false, 600],
        [true, 420],
      ] as const) {
        const size = answerFontSize(text, compact);
        if (n <= 80)
          expect(linesNeeded(text, size, width) * size * 1.12).toBeLessThanOrEqual(136 + 1);
      }
    }
  });
});

describe('score rows', () => {
  it('fit eight players inside the stage and stay at full size for a few', () => {
    expect(rowHeightFor(3)).toBe(100);
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const height = rowHeightFor(count);
      expect(height).toBeGreaterThanOrEqual(80);
      expect(250 + count * (height + 14)).toBeLessThanOrEqual(1080);
    }
  });

  const delta = (patch: Partial<Parameters<typeof isCrowned>[0]>) => ({
    playerId: 'p0',
    delta: 0,
    total: 0,
    rank: 1,
    previousRank: 1,
    components: [],
    ...patch,
  });

  it('crowns only a leader who has points, before and after the reorder', () => {
    // Everyone tied on 0: nobody leads yet.
    expect(isCrowned(delta({}), false)).toBe(false);
    expect(isCrowned(delta({}), true)).toBe(false);
    // First round: p0 earns 180 and takes the lead; before settling they have 0 and no crown.
    const gainer = delta({ delta: 180, total: 180, rank: 1, previousRank: 2 });
    expect(isCrowned(gainer, false)).toBe(false);
    expect(isCrowned(gainer, true)).toBe(true);
    // The old leader is crowned until the rows settle, then loses it.
    const loser = delta({ delta: 0, total: 300, rank: 2, previousRank: 1 });
    expect(isCrowned(loser, false)).toBe(true);
    expect(isCrowned(loser, true)).toBe(false);
  });
});

describe('crowd rounds', () => {
  it('summarises what the room thought, and whether it was right', () => {
    const votes = (counts: number[]) =>
      counts.map((count, index) => ({ optionId: `o${index}`, count }));
    expect(crowdSummary(votes([0, 0, 0, 0]), 'o0')).toBeNull();
    expect(crowdSummary(votes([3, 1, 0, 0]), 'o0')).toEqual({
      kind: 'majority',
      optionId: 'o0',
      right: true,
    });
    expect(crowdSummary(votes([1, 3, 0, 0]), 'o0')).toEqual({
      kind: 'majority',
      optionId: 'o1',
      right: false,
    });
    expect(crowdSummary(votes([2, 2, 0, 0]), 'o0')).toEqual({ kind: 'split' });
  });

  it('turns counts into whole percentages', () => {
    expect(votePercent(0, 0)).toBe(0);
    expect(votePercent(1, 3)).toBe(33);
    expect(votePercent(2, 3)).toBe(67);
    expect(votePercent(4, 4)).toBe(100);
  });
});
