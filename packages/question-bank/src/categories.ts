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
