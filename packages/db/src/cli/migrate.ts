import { fileURLToPath } from 'node:url';
import { runMigrations } from '../migrate';
import { createPool } from '../pool';

const url =
  process.env.DATABASE_URL ?? 'postgres://quizparty:quizparty@127.0.0.1:5432/quizparty_dev';
const directory = fileURLToPath(new URL('../../../../database/migrations', import.meta.url));

const pool = createPool(url, { max: 2, applicationName: 'quizparty-migrate' });
try {
  const report = await runMigrations(pool, directory);
  console.log(
    `applied: ${report.applied.join(', ') || '(none)'}; already applied: ${report.alreadyApplied.length}`,
  );
} finally {
  await pool.end();
}
