import { sql } from 'kysely';
import type { Database } from '@quizparty/db';

/**
 * Who changed a question and why. The database writes `question_status_log` by itself from
 * transaction-local settings, so every status change is recorded whichever code path made it
 * (migration 0004). Call inside the transaction that changes the status.
 */
export interface LogContext {
  actor: string | null;
  reason: string;
  detail?: Record<string, unknown>;
}

export async function setLogContext(trx: Database, context: LogContext): Promise<void> {
  await sql`select
      set_config('qp.actor', ${context.actor ?? ''}, true),
      set_config('qp.reason', ${context.reason}, true),
      set_config('qp.detail', ${JSON.stringify(context.detail ?? {})}, true)`.execute(trx);
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
