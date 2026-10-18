import type { Database } from '@quizparty/db';
import { LAUNCH_CATEGORIES } from '@quizparty/question-schema';

/** Creates the seventeen launch categories (GDD §9.4). Existing rows are left as the admin set them. */
export async function ensureLaunchCategories(db: Database): Promise<number> {
  const result = await db
    .insertInto('categories')
    .values(
      LAUNCH_CATEGORIES.map((category, index) => ({
        id: category.id,
        label_tr: category.tr,
        label_en: category.en,
        sort_order: index,
        free_rotation: category.free,
        source_required: category.sourceRequired,
      })),
    )
    .onConflict((conflict) => conflict.doNothing())
    .executeTakeFirst();
  return Number(result.numInsertedOrUpdatedRows ?? 0);
}

export interface CategoryInfo {
  id: string;
  enabled: boolean;
  sourceRequired: boolean;
}

export async function loadCategories(db: Database): Promise<Map<string, CategoryInfo>> {
  const rows = await db
    .selectFrom('categories')
    .select(['id', 'enabled', 'source_required'])
    .execute();
  return new Map(
    rows.map((row) => [
      row.id,
      { id: row.id, enabled: row.enabled, sourceRequired: row.source_required },
    ]),
  );
}

export interface ExtraCategory {
  id: string;
  tr: string;
  en: string;
  /** Sort position; extra categories follow the launch ones. */
  sortOrder?: number;
}

/**
 * Creates additional (demo/extension) categories from data, so adding a category needs no code.
 * Never eligible for the weekly free rotation and never source-required (they hold dev/demo
 * content); existing rows are left as the admin set them.
 */
export async function ensureExtraCategories(
  db: Database,
  categories: readonly ExtraCategory[],
): Promise<number> {
  if (categories.length === 0) return 0;
  const result = await db
    .insertInto('categories')
    .values(
      categories.map((category, index) => ({
        id: category.id,
        label_tr: category.tr,
        label_en: category.en,
        sort_order: category.sortOrder ?? 100 + index,
        free_rotation: false,
        source_required: false,
      })),
    )
    .onConflict((conflict) => conflict.doNothing())
    .executeTakeFirst();
  return Number(result.numInsertedOrUpdatedRows ?? 0);
}
