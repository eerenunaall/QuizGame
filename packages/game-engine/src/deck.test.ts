import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Rng, rngStateFromSeed } from '@quizparty/shared';
import { buildDeckIndex, deckSize, selectQuestionId, type DeckQuestion } from './deck';
import { makeDeck } from './testing';

const rng = (seed = 'deck') => new Rng(rngStateFromSeed(seed));
const params = (over: Partial<Parameters<typeof selectQuestionId>[1]> = {}) => ({
  bucket: 'MEDIUM' as const,
  varianceBuckets: 0 as const,
  corridor: [1000, 4000] as const,
  prevCategory: null,
  categoryCounts: {},
  ...over,
});

describe('buildDeckIndex', () => {
  it('rejects questions without exactly one correct option', () => {
    const bad: DeckQuestion = {
      questionId: 'x',
      source: 'BANK',
      category: { id: 'c', label: 'C' },
      difficulty: 'EASY',
      text: 't',
      explanation: null,
      options: [
        { key: 'a', text: 'a', correct: true },
        { key: 'b', text: 'b', correct: true },
      ],
    };
    expect(() => buildDeckIndex([bad])).toThrow(/exactly one correct/);
  });

  it('ignores duplicate ids', () => {
    const deck = makeDeck(4);
    const first = Object.values(deck.questions)[0]!;
    expect(deckSize(buildDeckIndex([first, first]))).toBe(1);
  });
});

describe('selectQuestionId', () => {
  it('prefers the target bucket', () => {
    const deck = makeDeck(24);
    for (let i = 0; i < 30; i++) {
      const id = selectQuestionId(deck, params({ bucket: 'HARD' }), rng(`s${i}`))!;
      expect(deck.questions[id]!.difficulty).toBe('HARD');
    }
  });

  it('falls back to the closest bucket when the target is empty and returns null when the deck is empty', () => {
    const deck = makeDeck(24);
    deck.remaining.HARD = [];
    const id = selectQuestionId(deck, params({ bucket: 'HARD' }), rng())!;
    expect(['MEDIUM', 'EXPERT']).toContain(deck.questions[id]!.difficulty);
    for (const bucket of ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const) deck.remaining[bucket] = [];
    expect(selectQuestionId(deck, params(), rng())).toBeNull();
  });

  it('avoids the previous category when alternatives exist', () => {
    const deck = makeDeck(24);
    for (let i = 0; i < 40; i++) {
      const id = selectQuestionId(deck, params({ prevCategory: 'history' }), rng(`c${i}`))!;
      expect(deck.questions[id]!.category.id).not.toBe('history');
    }
  });

  it('still answers when only the previous category is left', () => {
    const deck = makeDeck(24);
    for (const bucket of ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const) {
      deck.remaining[bucket] = deck.remaining[bucket].filter(
        (id) => deck.questions[id]!.category.id === 'history',
      );
    }
    const id = selectQuestionId(deck, params({ prevCategory: 'history', bucket: 'EASY' }), rng());
    expect(id).not.toBeNull();
  });

  it('balances categories by down-weighting those already played', () => {
    const deck = makeDeck(60);
    const counts = { history: 20, geography: 0 } as Record<string, number>;
    const tally: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      const id = selectQuestionId(
        deck,
        params({ bucket: 'EASY', categoryCounts: counts }),
        rng(`b${i}`),
      )!;
      const category = deck.questions[id]!.category.id;
      tally[category] = (tally[category] ?? 0) + 1;
    }
    expect(tally.geography ?? 0).toBeGreaterThan(tally.history ?? 0);
  });

  it('variance lets a surprise bucket appear only inside the corridor', () => {
    const deck = makeDeck(60);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const id = selectQuestionId(
        deck,
        params({ bucket: 'MEDIUM', varianceBuckets: 1, corridor: [1000, 2200] }),
        rng(`v${i}`),
      )!;
      seen.add(deck.questions[id]!.difficulty);
    }
    expect(seen.has('MEDIUM')).toBe(true);
    expect(seen.has('EASY')).toBe(true);
    expect(seen.has('HARD')).toBe(false);
    expect(seen.has('EXPERT')).toBe(false);
  });

  it('drawing repeatedly (removing each pick) yields every question exactly once', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.string(), (count, seed) => {
        const deck = makeDeck(count);
        const generator = rng(seed);
        const seen = new Set<string>();
        for (let i = 0; i < count; i++) {
          const id = selectQuestionId(
            deck,
            params({ bucket: 'MEDIUM', varianceBuckets: 1 }),
            generator,
          );
          expect(id).not.toBeNull();
          expect(seen.has(id!)).toBe(false);
          seen.add(id!);
          const bucket = deck.questions[id!]!.difficulty;
          deck.remaining[bucket] = deck.remaining[bucket].filter((x) => x !== id);
        }
        expect(selectQuestionId(deck, params(), generator)).toBeNull();
      }),
      { numRuns: 60 },
    );
  });
});
