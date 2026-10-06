import type { Database } from '@quizparty/db';
import type { CategoryCatalog, Locale } from '@quizparty/protocol';
import type { Clock } from '../util/clock';
import type { DeckBuilder } from './deck-builder';

interface Cached {
  at: number;
  value: CategoryCatalog;
}

/**
 * The categories a lobby may offer: enabled, with at least one ACTIVE question in the room's
 * language. Cached briefly because every lobby asks and the answer changes only on imports.
 */
export class CategoryCatalogService {
  private readonly cache = new Map<Locale, Cached>();
  private readonly db: Database;
  private readonly deckBuilder: DeckBuilder;
  private readonly options: { allowDevSeed: boolean; clock: Clock; ttlMs: number };

  constructor(
    db: Database,
    deckBuilder: DeckBuilder,
    options: { allowDevSeed: boolean; clock: Clock; ttlMs?: number },
  ) {
    this.db = db;
    this.deckBuilder = deckBuilder;
    this.options = { ...options, ttlMs: options.ttlMs ?? 30_000 };
  }

  async list(language: Locale): Promise<CategoryCatalog> {
    const now = this.options.clock.now();
    const cached = this.cache.get(language);
    if (cached && now - cached.at < this.options.ttlMs) return cached.value;

    let query = this.db
      .selectFrom('categories')
      .innerJoin('questions', 'questions.category_id', 'categories.id')
      .select([
        'categories.id as id',
        'categories.label_tr as label_tr',
        'categories.label_en as label_en',
      ])
      .select((eb) => eb.fn.countAll<number>().as('questions'))
      .where('categories.enabled', '=', true)
      .where('questions.status', '=', 'ACTIVE')
      .where('questions.language', '=', language)
      .where((eb) =>
        eb.or([
          eb('questions.expires_at', 'is', null),
          eb('questions.expires_at', '>', new Date(now)),
        ]),
      );
    if (!this.options.allowDevSeed) query = query.where('questions.is_dev_seed', '=', false);
    const rows = await query
      .groupBy([
        'categories.id',
        'categories.label_tr',
        'categories.label_en',
        'categories.sort_order',
      ])
      .orderBy('categories.sort_order')
      .orderBy('categories.id')
      .execute();

    const freeCategoryId = await this.deckBuilder.freeCategoryId();
    const value: CategoryCatalog = {
      language,
      freeCategoryId: rows.some((row) => row.id === freeCategoryId) ? freeCategoryId : null,
      categories: rows.map((row) => ({
        id: row.id,
        label: language === 'tr' ? row.label_tr : row.label_en,
        questions: Number(row.questions),
        free: row.id === freeCategoryId,
      })),
    };
    this.cache.set(language, { at: now, value });
    return value;
  }
}
