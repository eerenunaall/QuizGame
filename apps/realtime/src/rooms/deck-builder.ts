import type { DeckRequest, Deck, DeckQuestion } from '@quizparty/game-engine';
import { buildDeckIndex } from '@quizparty/game-engine';
import type { Database } from '@quizparty/db';
import { DIFFICULTIES, type Difficulty } from '@quizparty/protocol';
import { sql } from 'kysely';
import type { FeatureFlags } from '../flags/service';
import { readSettings, type VenueSettings } from '../venue/settings';
import type { Clock } from '../util/clock';
import { rankFresh, type FreshHistoryEntry } from './freshness';

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

/** Candidates a venue draw ranks per difficulty bucket (the pool is sampled, not loaded whole). */
const FRESH_CANDIDATE_CAP = 4000;
export const DEFAULT_FRESH_WINDOW = 300;

/** The venue a room is a metered table of, and how its decks are mixed (ADR-0025 §8). */
interface VenueContext {
  venueId: string;
  settings: VenueSettings;
}

/**
 * Builds the private per-game deck from ACTIVE questions (ADR-0011, ADR-0014). Questions are never
 * generated at play time. Dev-seed content is only served when explicitly allowed (never in
 * production). Free-tier hosts get the weekly rotating free category only (ADR-0013).
 *
 * A room with an open venue table (ADR-0024) also gets the venue's own questions according to the venue's
 * setting, and a freshness ranking over what that venue played recently (ADR-0025). Any other room sees
 * only global rows (`owner_venue_id IS NULL`): a venue's questions never leave its tables.
 */
export class DeckBuilder {
  constructor(
    private readonly db: Database,
    private readonly options: {
      allowDevSeed: boolean;
      clock: Clock;
      flags?: FeatureFlags;
      /** Recently played distinct questions per category a venue deck avoids (default 300). */
      freshWindow?: number;
      random?: () => number;
    },
  ) {}

  /** The venue whose open (not ended) table this room is, or null for every other room. */
  private async venueOf(roomId: string): Promise<VenueContext | null> {
    // Feature off (ADR-0024 §1): a table left behind is a plain room and serves no café question.
    if (this.options.flags && !(await this.options.flags.isEnabled('venue.sessions'))) return null;
    const row = await this.db
      .selectFrom('venue_sessions')
      .innerJoin('venues', 'venues.id', 'venue_sessions.venue_id')
      .select(['venues.id as id', 'venues.settings as settings'])
      .where('venue_sessions.room_id', '=', roomId)
      .where('venue_sessions.state', '!=', 'ENDED')
      .executeTakeFirst();
    return row ? { venueId: row.id, settings: readSettings(row.settings) } : null;
  }

  /** Per category, the venue's most recently played questions (at most the freshness window of each). */
  private async venueHistory(venueId: string): Promise<FreshHistoryEntry[]> {
    const window = this.options.freshWindow ?? DEFAULT_FRESH_WINDOW;
    const { rows } = await sql<{ id: string; category: string; played_at: Date }>`
      SELECT id, category, played_at FROM (
        SELECT h.question_id AS id, q.category_id AS category, h.played_at,
               row_number() OVER (PARTITION BY q.category_id ORDER BY h.played_at DESC) AS rn
        FROM venue_question_history h
        JOIN questions q ON q.id = h.question_id
        WHERE h.venue_id = ${venueId}
      ) ranked
      WHERE rn <= ${window}`.execute(this.db);
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      playedAt: new Date(row.played_at).getTime(),
    }));
  }

  async freeCategoryId(): Promise<string | null> {
    const rows = await this.db
      .selectFrom('categories')
      .select('id')
      .where('enabled', '=', true)
      .where('owner_venue_id', 'is', null)
      .where('free_rotation', '=', true)
      .orderBy('sort_order')
      .orderBy('id')
      .execute();
    if (rows.length === 0) return null;
    const { year, week } = isoWeek(this.options.clock.now());
    return rows[(year * 53 + week) % rows.length]!.id;
  }

  async build(request: DeckRequest): Promise<Deck> {
    const venue = await this.venueOf(request.roomId);
    const useVenue = venue !== null && venue.settings.questions.source !== 'GLOBAL_ONLY';
    let categoryIds: string[];
    let venueCategoryIds: string[] = [];
    if (request.tier === 'FREE') {
      const free = await this.freeCategoryId();
      categoryIds = free ? [free] : [];
    } else {
      // Global categories for everyone; a venue's own categories only for that venue's table.
      const query = this.db
        .selectFrom('categories')
        .select(['id', 'owner_venue_id'])
        .where('enabled', '=', true)
        .where((eb) =>
          useVenue
            ? eb.or([eb('owner_venue_id', 'is', null), eb('owner_venue_id', '=', venue.venueId)])
            : eb('owner_venue_id', 'is', null),
        );
      const rows = await (
        request.categories === 'ALL' ? query : query.where('id', 'in', request.categories)
      ).execute();
      categoryIds = rows.filter((row) => row.owner_venue_id === null).map((row) => row.id);
      venueCategoryIds = rows.filter((row) => row.owner_venue_id !== null).map((row) => row.id);
    }
    if (categoryIds.length === 0 && venueCategoryIds.length === 0)
      throw new NotEnoughQuestionsError(0, request.rounds);

    // The CURRENT pool (news-bound questions) can be switched off without a deploy (GDD §22).
    const currentEvents = (await this.options.flags?.isEnabled('content.current_events')) ?? true;
    const target = Math.max(request.rounds * 3, 12);
    const history = venue ? await this.venueHistory(venue.venueId) : [];
    const random = this.options.random ?? Math.random;
    const window = this.options.freshWindow ?? DEFAULT_FRESH_WINDOW;

    /** One draw from either the global bank or the venue's set, in a difficulty bucket. */
    const draw = async (
      scope: 'GLOBAL' | 'VENUE',
      bucket: Difficulty,
      limit: number,
      taken: ReadonlySet<string>,
    ): Promise<string[]> => {
      const ids = scope === 'GLOBAL' ? categoryIds : venueCategoryIds;
      if (limit <= 0 || ids.length === 0) return [];
      let query = this.db
        .selectFrom('questions')
        .select(['id', 'category_id'])
        .where('status', '=', 'ACTIVE')
        .where('language', '=', request.language)
        .where('difficulty', '=', bucket)
        .where('category_id', 'in', ids)
        .where((eb) =>
          eb.or([
            eb('expires_at', 'is', null),
            eb('expires_at', '>', new Date(this.options.clock.now())),
          ]),
        );
      query =
        scope === 'GLOBAL'
          ? query.where('owner_venue_id', 'is', null)
          : query.where('owner_venue_id', '=', venue!.venueId);
      if (!this.options.allowDevSeed) query = query.where('is_dev_seed', '=', false);
      if (!currentEvents) query = query.where('pool', '!=', 'CURRENT');
      if (taken.size > 0) query = query.where('id', 'not in', [...taken]);
      if (!venue) {
        const rows = await query
          .orderBy((eb) => eb.fn.coalesce('last_used_at', eb.val(new Date(0))))
          .orderBy((eb) => eb.fn('random'))
          .limit(limit)
          .execute();
        return rows.map((row) => row.id);
      }
      // A venue table: rank by what this venue played recently (the history of the whole deck).
      const rows = await query
        .orderBy((eb) => eb.fn('random'))
        .limit(FRESH_CANDIDATE_CAP)
        .execute();
      return rankFresh(
        rows.map((row) => ({ id: row.id, category: row.category_id })),
        history,
        { window, random },
      ).slice(0, limit);
    };

    const picked: { id: string; difficulty: Difficulty }[] = [];
    for (const bucket of DIFFICULTIES) {
      const limit = Math.max(2, Math.ceil(target * BUCKET_WEIGHTS[bucket]));
      const taken = new Set<string>();
      const take = (ids: string[]): void => {
        for (const id of ids) {
          taken.add(id);
          picked.push({ id, difficulty: bucket });
        }
      };
      if (!useVenue) {
        take(await draw('GLOBAL', bucket, limit, taken));
        continue;
      }
      const source = venue.settings.questions.source;
      const wantVenue =
        source === 'VENUE_ONLY'
          ? limit
          : Math.max(1, Math.round((limit * venue.settings.questions.venueSharePercent) / 100));
      take(await draw('VENUE', bucket, wantVenue, taken));
      // The global bank fills the rest, and a venue that has too few questions never blocks a game.
      take(await draw('GLOBAL', bucket, limit - taken.size, taken));
      if (taken.size < limit) take(await draw('VENUE', bucket, limit - taken.size, taken));
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
