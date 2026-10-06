import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations, loadMigrations } from './migrate';
import { createDatabase, createPool, type Database } from './pool';

/**
 * Per-test-file databases cloned from a migrated template (fast, isolated, real PostgreSQL).
 * The template name embeds a hash of every migration file, so schema changes rebuild it
 * automatically and stale templates are dropped.
 */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../database/migrations', import.meta.url),
);

const TEMPLATE_PREFIX = 'qp_tpl_';
const TEMPLATE_LOCK = 7_340_220;

export function adminUrl(): string {
  const base =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://quizparty:quizparty@127.0.0.1:5432/quizparty_dev';
  const url = new URL(base);
  url.pathname = '/postgres';
  return url.toString();
}

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function templateName(): string {
  const hash = createHash('sha256');
  for (const file of loadMigrations(MIGRATIONS_DIR)) hash.update(file.id).update(file.checksum);
  return `${TEMPLATE_PREFIX}${hash.digest('hex').slice(0, 16)}`;
}

async function ensureTemplate(admin: pg.Client, adminConnection: string): Promise<string> {
  const name = templateName();
  await admin.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK]);
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      const building = `${name}_building_${randomBytes(3).toString('hex')}`;
      await admin.query(`CREATE DATABASE "${building}"`);
      const pool = createPool(withDatabase(adminConnection, building), { max: 2 });
      try {
        await runMigrations(pool, MIGRATIONS_DIR);
      } finally {
        await pool.end();
      }
      await admin.query(`ALTER DATABASE "${building}" RENAME TO "${name}"`);
      await admin.query(`ALTER DATABASE "${name}" IS_TEMPLATE true`);
      const old = await admin.query<{ datname: string }>(
        'SELECT datname FROM pg_database WHERE datname LIKE $1 AND datname <> $2',
        [`${TEMPLATE_PREFIX}%`, name],
      );
      for (const row of old.rows) {
        await admin.query(`ALTER DATABASE "${row.datname}" IS_TEMPLATE false`);
        await admin.query(`DROP DATABASE IF EXISTS "${row.datname}"`);
      }
    }
  } finally {
    await admin.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK]);
  }
  return name;
}

export interface TestDatabase {
  name: string;
  url: string;
  pool: pg.Pool;
  db: Database;
  /** Drops the database; call in `afterAll`. */
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const connection = adminUrl();
  const admin = new pg.Client({ connectionString: connection });
  await admin.connect();
  try {
    const template = await ensureTemplate(admin, connection);
    const name = `qp_test_${randomBytes(6).toString('hex')}`;
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    const url = withDatabase(connection, name);
    const pool = createPool(url, { max: 8, applicationName: 'quizparty-test' });
    return {
      name,
      url,
      pool,
      db: createDatabase(pool),
      async drop() {
        await pool.end();
        const cleanup = new pg.Client({ connectionString: connection });
        await cleanup.connect();
        try {
          await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        } finally {
          await cleanup.end();
        }
      },
    };
  } finally {
    await admin.end();
  }
}
