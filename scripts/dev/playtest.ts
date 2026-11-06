/**
 * `pnpm playtest`: everything needed to play the game on real phones and a real TV in one command.
 *
 *   1. makes sure PostgreSQL answers (starts the local one in the sandbox / Debian when it can),
 *   2. applies the migrations and loads the hand-written Turkish development bank,
 *   3. builds the web app when it is missing, and
 *   4. starts the server so that the TV page (/tv) and the phones (the QR code) are served from it.
 *
 * It is a playtest tool, not a deployment: it runs in development mode with the development bank
 * switched on (production refuses both). PUBLIC_WEB_URL decides what the QR code points to; it
 * defaults to this machine's address on the local network, so the phones must be on the same Wi-Fi.
 * To play across networks, expose the port with a tunnel and pass its https URL as PUBLIC_WEB_URL.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPool, runMigrations } from '@quizparty/db';
import { realIo, run } from '../question/cli.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const env = process.env;
const port = Number(env.PORT ?? 8080);
const databaseUrl =
  env.DATABASE_URL ?? 'postgres://quizparty:quizparty@127.0.0.1:5432/quizparty_dev';

function lanAddress(): string {
  for (const addresses of Object.values(networkInterfaces()))
    for (const address of addresses ?? [])
      if (address.family === 'IPv4' && !address.internal) return address.address;
  return '127.0.0.1';
}

async function databaseReachable(): Promise<boolean> {
  const pool = createPool(databaseUrl, { max: 1, applicationName: 'quizparty-playtest' });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!(await databaseReachable())) {
  console.log('PostgreSQL is not answering; trying the local helper (scripts/dev/db-up.sh) …');
  spawnSync('bash', [`${ROOT}scripts/dev/db-up.sh`], { stdio: 'inherit' });
  if (!(await databaseReachable()))
    fail(
      `Cannot reach PostgreSQL at ${databaseUrl.replace(/:[^:@/]*@/u, ':***@')}.\n` +
        '  Start one (for example `docker compose -f infra/deployment/docker-compose.yml up -d db`)\n' +
        '  or set DATABASE_URL, then run `pnpm playtest` again.',
    );
}

const pool = createPool(databaseUrl, { max: 2, applicationName: 'quizparty-playtest' });
try {
  const report = await runMigrations(pool, `${ROOT}database/migrations`);
  console.log(
    `migrations: ${report.applied.length} applied, ${report.alreadyApplied.length} already there`,
  );
} finally {
  await pool.end();
}

const seedCode = await run(
  ['seed', '--seed-file', `${ROOT}seed/questions.tr.jsonl`],
  { ...env, NODE_ENV: 'development', DATABASE_URL: databaseUrl },
  realIo,
);
if (seedCode !== 0) fail('The development bank could not be loaded.');

// The temporary demo bank (cult TV, films, comics) sits outside the launch pool; see seed/demo/README.md.
for (const file of readdirSync(`${ROOT}seed/demo`).filter((n) =>
  /^questions\..+\.jsonl$/u.test(n),
)) {
  const demoCode = await run(
    [
      'seed',
      '--seed-file',
      `${ROOT}seed/demo/${file}`,
      '--categories-file',
      `${ROOT}seed/demo/categories.json`,
    ],
    { ...env, NODE_ENV: 'development', DATABASE_URL: databaseUrl },
    realIo,
  );
  if (demoCode !== 0) fail(`The demo bank ${file} could not be loaded.`);
}

const rebuild = process.argv.includes('--rebuild');
if (rebuild || !existsSync(`${ROOT}apps/web/dist/index.html`)) {
  console.log('building the web app …');
  const build = spawnSync('pnpm', ['--filter', '@quizparty/web', 'run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (build.status !== 0) fail('The web build failed.');
}

const publicUrl = (env.PUBLIC_WEB_URL ?? `http://${lanAddress()}:${port}`).replace(/\/+$/u, '');
const server = spawn('pnpm', ['--filter', '@quizparty/realtime', 'run', 'start'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...env,
    NODE_ENV: 'development',
    HOST: '0.0.0.0',
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    PUBLIC_WEB_URL: publicUrl,
    ALLOWED_ORIGINS: [env.ALLOWED_ORIGINS, publicUrl].filter(Boolean).join(','),
    SERVE_WEB: '1',
    QP_ALLOW_DEV_SEED: '1',
    LOG_LEVEL: env.LOG_LEVEL ?? 'warn',
  },
});

console.log(`
══════════════════════════════════════════════════════════════
  QuizNight playtest
  TV  (open full screen):  ${publicUrl}/tv
  Phones: scan the QR code on the TV, or open ${publicUrl}/join
  Bank:   340 development questions (Turkish), 17 categories
  Stop:   Ctrl+C
══════════════════════════════════════════════════════════════
`);

const stop = (signal: NodeJS.Signals): void => {
  server.kill(signal);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
server.on('exit', (code) => process.exit(code ?? 0));
