import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';

/**
 * Forward-only SQL migrations. Files are applied in lexical order inside one transaction each,
 * under a session-level advisory lock so concurrent boots cannot interleave. Every applied file's
 * checksum is stored; editing an already-applied migration is refused (history is immutable).
 */
export interface MigrationFile {
  id: string;
  sql: string;
  checksum: string;
}

const LOCK_KEY = 7_340_219;
const FILE_RE = /^\d{4}_[a-z0-9_]+\.sql$/;

export function loadMigrations(directory: string): MigrationFile[] {
  return readdirSync(directory)
    .filter((name) => FILE_RE.test(name))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(directory, name), 'utf8');
      return {
        id: name.replace(/\.sql$/, ''),
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

export interface MigrationReport {
  applied: string[];
  alreadyApplied: string[];
}

export async function runMigrations(pool: Pool, directory: string): Promise<MigrationReport> {
  const files = loadMigrations(directory);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const { rows } = await client.query<{ id: string; checksum: string }>(
        'SELECT id, checksum FROM schema_migrations',
      );
      const known = new Map(rows.map((row) => [row.id, row.checksum]));
      const report: MigrationReport = { applied: [], alreadyApplied: [] };

      for (const [id] of known) {
        if (!files.some((file) => file.id === id)) {
          throw new Error(`Migration ${id} was applied but its file is missing`);
        }
      }
      for (const file of files) {
        const recorded = known.get(file.id);
        if (recorded !== undefined) {
          if (recorded !== file.checksum) {
            throw new Error(
              `Migration ${file.id} was modified after being applied (checksum mismatch)`,
            );
          }
          report.alreadyApplied.push(file.id);
          continue;
        }
        await applyOne(client, file);
        report.applied.push(file.id);
      }
      return report;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function applyOne(client: PoolClient, file: MigrationFile): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(file.sql);
    await client.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [
      file.id,
      file.checksum,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(
      `Migration ${file.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** True when every migration file is applied with a matching checksum (used by /readyz). */
export async function migrationsCurrent(pool: Pool, directory: string): Promise<boolean> {
  const files = loadMigrations(directory);
  const { rows } = await pool.query<{ id: string; checksum: string }>(
    'SELECT id, checksum FROM schema_migrations',
  );
  const known = new Map(rows.map((row) => [row.id, row.checksum]));
  return files.every((file) => known.get(file.id) === file.checksum);
}
