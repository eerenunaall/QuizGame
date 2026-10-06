import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './generated/db-types';

export type Database = Kysely<DB>;

/** pg returns bigint/numeric as strings; parse int8 to number where safe (epoch ms, counters). */
pg.types.setTypeParser(20, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`int8 value out of safe range: ${value}`);
  return parsed;
});

export interface PoolOptions {
  max?: number;
  applicationName?: string;
}

export function createPool(connectionString: string, options: PoolOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: options.applicationName ?? 'quizparty',
    statement_timeout: 15_000,
  });
  pool.on('error', () => {
    // Idle client errors (e.g. server restart) must not crash the process; the next query reconnects.
  });
  return pool;
}

export function createDatabase(pool: pg.Pool): Database {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
