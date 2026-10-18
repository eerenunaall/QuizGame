import type { Deck, DeckQuestion } from './deck';
import { buildDeckIndex } from './deck';
import type { GameState } from './types';

/**
 * Who Said It (GDD §7.9, ADR-0015). One question per statement: the statement is the question text,
 * the options are the players (key = player id), the author is the one correct option. The author
 * sits their own question out: they cannot answer, are not waited for and score nothing for it.
 */
export function buildWhoSaidItDeck(input: {
  players: readonly { playerId: string; nickname: string }[];
  statements: readonly { playerId: string; text: string }[];
  categoryLabel: string;
  /** Opaque, unique per question; must not be a bank question id. */
  newQuestionId: () => string;
}): Deck {
  const known = new Set(input.players.map((p) => p.playerId));
  const questions: DeckQuestion[] = input.statements
    .filter((s) => known.has(s.playerId))
    .map((statement) => ({
      questionId: input.newQuestionId(),
      source: 'WHO_SAID_IT' as const,
      category: { id: 'who-said-it', label: input.categoryLabel },
      difficulty: 'MEDIUM' as const,
      text: statement.text,
      explanation: null,
      authorPlayerId: statement.playerId,
      options: input.players.map((player) => ({
        key: player.playerId,
        text: player.nickname,
        correct: player.playerId === statement.playerId,
      })),
    }));
  return buildDeckIndex(questions);
}

/** The player who must not answer the round's question (its author), or null in every other mode. */
export function exemptPlayerId(game: Pick<GameState, 'deck' | 'round'> | null): string | null {
  const round = game?.round;
  if (!game || !round) return null;
  return game.deck.questions[round.questionId]?.authorPlayerId ?? null;
}
