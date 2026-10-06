import type { DeckRequest, Deck, DeckQuestion } from '@quizparty/game-engine';
import { buildDeckIndex } from '@quizparty/game-engine';
import type { Database } from '@quizparty/db';
import { DIFFICULTIES, type Difficulty } from '@quizparty/protocol';
import type { Clock } from '../util/clock';

export class NotEnoughQuestionsError extends Error {
  constructor(
    readonly available: number,
    readonly needed: number,
  ) {
    super(`deck has ${available} questions, ${needed} needed`);
  }
}

/** Share of the deck drawn from each difficulty bucket (the Director picks among them per round). */
const BUCKET_WEIGHTS: Record<Difficulty, number> = {
  EASY: 0.3,
  MEDIUM: 0.35,
  HARD: 0.25,
  EXPERT: 0.1,
};

/** ISO-8601 year/week of a UTC instant, used to rotate the free category weekly. */
export function isoWeek(timestamp: number): { year: number; week: number } {
  const date = new Date(timestamp);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(target.getUTCFullYear(), 0, 1);
  return {
    year: target.getUTCFullYear(),
    week: Math.ceil(((target.getTime() - yearStart) / 86_400_000 + 1) / 7),
  };
}

/**
 * Builds the private per-game deck from ACTIVE questions (ADR-0011, ADR-0014). Questions are never
 * generated at play time. Dev-seed content is only served when explicitly allowed (never in
 * production). Free-tier hosts get the weekly rotating free category only (ADR-0013).
 */
export class DeckBuilder {
  constructor(
    private readonly db: Database,
    private readonly options: { allowDevSeed: boolean; clock: Clock },
  ) {}

  async freeCategoryId(): Promise<string | null> {
    const rows = await this.db
      .selectFrom('categories')
      .select('id')
      .where('enabled', '=', true)
      .where('free_rotation', '=', true)
      .orderBy('sort_order')
      .orderBy('id')
      .execute();
    if (rows.length === 0) return null;
    const { year, week } = isoWeek(this.options.clock.now());
    return rows[(year * 53 + week) % rows.length]!.id;
  }

  async build(request: DeckRequest): Promise<Deck> {
    let categoryIds: string[];
    if (request.tier === 'FREE') {
      const free = await this.freeCategoryId();
      categoryIds = free ? [free] : [];
    } else {
      const query = this.db.selectFrom('categories').select('id').where('enabled', '=', true);
      const rows = await (
        request.categories === 'ALL' ? query : query.where('id', 'in', request.categories)
      ).execute();
      categoryIds = rows.map((row) => row.id);
    }
    if (categoryIds.length === 0) throw new NotEnoughQuestionsError(0, request.rounds);

    const target = Math.max(request.rounds * 3, 12);
    const picked: { id: string; difficulty: Difficulty }[] = [];
    for (const bucket of DIFFICULTIES) {
      const limit = Math.max(2, Math.ceil(target * BUCKET_WEIGHTS[bucket]));
      let query = this.db
        .selectFrom('questions')
        .select(['id', 'difficulty'])
        .where('status', '=', 'ACTIVE')
        .where('language', '=', request.language)
        .where('difficulty', '=', bucket)
        .where('category_id', 'in', categoryIds)
        .where((eb) =>
          eb.or([
            eb('expires_at', 'is', null),
            eb('expires_at', '>', new Date(this.options.clock.now())),
          ]),
        );
      if (!this.options.allowDevSeed) query = query.where('is_dev_seed', '=', false);
      const rows = await query
        .orderBy((eb) => eb.fn.coalesce('last_used_at', eb.val(new Date(0))))
        .orderBy((eb) => eb.fn('random'))
        .limit(limit)
        .execute();
      for (const row of rows) picked.push({ id: row.id, difficulty: row.difficulty as Difficulty });
    }
    if (picked.length < request.rounds)
      throw new NotEnoughQuestionsError(picked.length, request.rounds);

    const ids = picked.map((row) => row.id);
    const questions = await this.db
      .selectFrom('questions')
      .innerJoin('categories', 'categories.id', 'questions.category_id')
      .select([
        'questions.id as id',
        'questions.text as text',
        'questions.explanation as explanation',
        'questions.difficulty as difficulty',
        'categories.id as category_id',
        'categories.label_tr as label_tr',
        'categories.label_en as label_en',
      ])
      .where('questions.id', 'in', ids)
      .execute();
    const options = await this.db
      .selectFrom('question_options')
      .select(['id', 'question_id', 'position', 'text', 'is_correct'])
      .where('question_id', 'in', ids)
      .orderBy('question_id')
      .orderBy('position')
      .execute();
    const optionsByQuestion = new Map<string, typeof options>();
    for (const option of options) {
      const list = optionsByQuestion.get(option.question_id) ?? [];
      list.push(option);
      optionsByQuestion.set(option.question_id, list);
    }

    const deckQuestions: DeckQuestion[] = [];
    for (const question of questions) {
      const list = optionsByQuestion.get(question.id) ?? [];
      if (list.length < 2 || list.filter((option) => option.is_correct).length !== 1) continue; // never serve a malformed question
      deckQuestions.push({
        questionId: question.id,
        source: 'BANK',
        category: {
          id: question.category_id,
          label: request.language === 'tr' ? question.label_tr : question.label_en,
        },
        difficulty: question.difficulty as Difficulty,
        text: question.text,
        explanation: question.explanation,
        options: list.map((option) => ({
          key: option.id,
          text: option.text,
          correct: option.is_correct,
        })),
      });
    }
    if (deckQuestions.length < request.rounds)
      throw new NotEnoughQuestionsError(deckQuestions.length, request.rounds);
    return buildDeckIndex(deckQuestions);
  }
}
