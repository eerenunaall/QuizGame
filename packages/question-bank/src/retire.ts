import type { Database } from '@quizparty/db';
import { SYSTEM_ACTOR, transitionTx } from './lifecycle';

export interface RetireOutsidePrefixResult {
  retired: number;
  kept: number;
}

/**
 * Switches the served bank: every ACTIVE question whose external id does not start with `keepPrefix`
 * (including rows without one, and all DEV_SEED rows) goes ACTIVE -> RETIRED through the normal
 * lifecycle, so the status log records it. Rows are never deleted and rows with the prefix are never
 * touched. Allowed in every NODE_ENV: it only ever removes content from play.
 */
export async function retireOutsidePrefix(
  db: Database,
  keepPrefix: string,
  options: { dryRun?: boolean } = {},
): Promise<RetireOutsidePrefixResult> {
  if (keepPrefix.length === 0) throw new Error('keepPrefix must not be empty');
  const active = await db
    .selectFrom('questions')
    .select(['id', 'external_id'])
    .where('status', '=', 'ACTIVE')
    .execute();
  const doomed = active.filter((row) => !(row.external_id ?? '').startsWith(keepPrefix));
  if (!options.dryRun && doomed.length > 0)
    await db.transaction().execute(async (trx) => {
      for (const row of doomed)
        await transitionTx(trx, row.id, 'RETIRED', {
          actor: SYSTEM_ACTOR,
          reason: 'retire-dev',
          note: `bank switch: external id does not start with ${keepPrefix}`,
          detail: { keepPrefix },
        });
    });
  return { retired: doomed.length, kept: active.length - doomed.length };
}
