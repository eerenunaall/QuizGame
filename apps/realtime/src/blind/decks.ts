import { randomBytes } from 'node:crypto';
import type { Database } from '@quizparty/db';
import {
  buildDeckIndex,
  type Deck,
  type DeckQuestion,
  type DeckRequest,
} from '@quizparty/game-engine';
import { translate } from '@quizparty/i18n';
import { NotEnoughQuestionsError } from '../rooms/deck-builder';
import type { BlindVault } from './vault';

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomBytes(2).readUInt16BE() % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Decks for the personal modes (ADR-0015). A Blind Quiz deck is built by the vault, which is the only
 * thing allowed to open the answers; a Custom Quiz deck comes straight from the author's questions.
 * Both are all one difficulty: the game's pacing for them comes from the rounds, not from levels.
 */
export class PersonalDecks {
  private readonly db: Database;
  private readonly vault: BlindVault;

  constructor(deps: { db: Database; vault: BlindVault }) {
    this.db = deps.db;
    this.vault = deps.vault;
  }

  async build(request: DeckRequest): Promise<Deck> {
    if (!request.contentRef) throw new NotEnoughQuestionsError(0, request.rounds);
    let questions: DeckQuestion[];
    if (request.mode === 'BLIND') {
      questions = await this.vault.playableForGame(request.contentRef);
      if (questions.length >= request.rounds) await this.vault.markUsed(request.contentRef);
    } else if (request.mode === 'CUSTOM') {
      questions = await this.custom(request.contentRef);
    } else {
      throw new NotEnoughQuestionsError(0, request.rounds);
    }
    if (questions.length < request.rounds)
      throw new NotEnoughQuestionsError(questions.length, request.rounds);
    return buildDeckIndex(shuffle(questions));
  }

  private async custom(quizId: string): Promise<DeckQuestion[]> {
    const quiz = await this.db
      .selectFrom('personal_quizzes')
      .select('language')
      .where('id', '=', quizId)
      .where('kind', '=', 'CUSTOM')
      .executeTakeFirst();
    if (!quiz) return [];
    const rows = await this.db
      .selectFrom('custom_questions')
      .select(['id', 'text', 'options', 'correct_index', 'explanation'])
      .where('quiz_id', '=', quizId)
      .execute();
    const label = translate(quiz.language as 'tr' | 'en', 'blind.custom.category');
    await this.db
      .updateTable('personal_quizzes')
      .set({ last_used_at: new Date() })
      .where('id', '=', quizId)
      .execute();
    return rows.map((row) => {
      const options = (row.options as string[]).map((text, index) => ({
        key: `${row.id}:${index}`,
        text,
        correct: index === row.correct_index,
      }));
      return {
        questionId: row.id,
        source: 'CUSTOM' as const,
        category: { id: 'custom', label },
        difficulty: 'MEDIUM' as const,
        text: row.text,
        explanation: row.explanation,
        options: shuffle(options),
      };
    });
  }
}
