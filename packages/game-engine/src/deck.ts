import { DIFFICULTIES, type Difficulty } from '@quizparty/protocol';
import type { Rng } from '@quizparty/shared';
import { bucketIndex, levelToBucket } from './director';

/**
 * A deck is the private, pre-selected pool for one game (ADR-0011). It contains correct answers and
 * therefore lives only in server-side engine state; clients never receive it.
 */
export interface DeckQuestion {
  questionId: string;
  source: 'BANK' | 'BLIND' | 'WHO_SAID_IT' | 'CUSTOM';
  category: { id: string; label: string };
  difficulty: Difficulty;
  text: string;
  explanation: string | null;
  /** `key` is a stable internal key (never sent); exactly one option is correct. */
  options: { key: string; text: string; correct: boolean }[];
}

export interface Deck {
  questions: Record<string, DeckQuestion>;
  remaining: Record<Difficulty, string[]>;
}

export function buildDeckIndex(questions: readonly DeckQuestion[]): Deck {
  const deck: Deck = {
    questions: {},
    remaining: { EASY: [], MEDIUM: [], HARD: [], EXPERT: [] },
  };
  for (const question of questions) {
    if (deck.questions[question.questionId]) continue;
    if (question.options.filter((option) => option.correct).length !== 1) {
      throw new Error(`Question ${question.questionId} must have exactly one correct option`);
    }
    deck.questions[question.questionId] = question;
    deck.remaining[question.difficulty].push(question.questionId);
  }
  return deck;
}

export function deckSize(deck: Deck): number {
  return DIFFICULTIES.reduce((total, bucket) => total + deck.remaining[bucket].length, 0);
}

export interface SelectionParams {
  bucket: Difficulty;
  varianceBuckets: 0 | 1;
  corridor: readonly [number, number];
  prevCategory: string | null;
  categoryCounts: Readonly<Record<string, number>>;
}

/**
 * Chooses the next question id without mutating the deck. The caller removes the id from
 * `deck.remaining`. Returns null only when the deck is exhausted.
 */
export function selectQuestionId(deck: Deck, params: SelectionParams, rng: Rng): string | null {
  const target = bucketIndex(params.bucket);
  const corridorLow = bucketIndex(levelToBucket(params.corridor[0]));
  const corridorHigh = bucketIndex(levelToBucket(params.corridor[1]));

  const candidates = DIFFICULTIES.map((bucket, index) => ({ bucket, index })).filter(
    ({ bucket }) => deck.remaining[bucket].length > 0,
  );
  if (candidates.length === 0) return null;

  const weighted = candidates.map(({ index }) => {
    const distance = Math.abs(index - target);
    const inCorridor = index >= corridorLow && index <= corridorHigh;
    if (distance === 0) return 100;
    if (distance === 1 && params.varianceBuckets === 1 && inCorridor) return 20;
    return 0;
  });

  let chosen: Difficulty;
  if (weighted.some((weight) => weight > 0)) {
    chosen = candidates[rng.weightedIndex(weighted)]!.bucket;
  } else {
    // Nothing near the target: fall back to the closest non-empty bucket, preferring the corridor,
    // then the easier side (a too-easy question is never unplayable, a too-hard one can be).
    const ranked = candidates
      .map(({ bucket, index }) => ({
        bucket,
        distance:
          Math.abs(index - target) + (index >= corridorLow && index <= corridorHigh ? 0 : 10),
        index,
      }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index);
    chosen = ranked[0]!.bucket;
  }

  const ids = deck.remaining[chosen];
  const preferred = ids.filter((id) => deck.questions[id]!.category.id !== params.prevCategory);
  const pool = preferred.length > 0 ? preferred : ids;
  const weights = pool.map((id) => {
    const count = params.categoryCounts[deck.questions[id]!.category.id] ?? 0;
    return Math.max(1, Math.floor(1000 / (1 + count)));
  });
  return pool[rng.weightedIndex(weights)]!;
}
