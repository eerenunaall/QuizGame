/**
 * `pnpm release:audit`: checks the release criteria that a machine can check and writes
 * `docs/FINAL_RELEASE_AUDIT.md` (plan M7, docs/ACCEPTANCE.md).
 *
 * Result words, used for every row:
 *   PASS      verified by this audit or by the proof named in docs/ACCEPTANCE.md (the proof file exists).
 *   FAIL      a mechanical check failed. The audit exits 1.
 *   OPEN      a known gap in the code or the docs that needs no outside party; listed, does not fail the run.
 *   EXTERNAL  cannot be done in the build sandbox; the row names the blocker, the checklist is
 *             docs/EXTERNAL_CHECKLIST.md.
 *
 * It needs PostgreSQL (the route inventory boots the real application with a production-shaped
 * configuration on a throw-away database) and writes nothing outside docs/FINAL_RELEASE_AUDIT.md.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestDatabase } from '@quizparty/db/testing';
import { run as runQuestionCli } from '../question/cli.ts';
import { buildApp } from '../../apps/realtime/src/app';
import { loadConfig } from '../../apps/realtime/src/config';
import { buildCsp, inlineScriptHashes } from '../../apps/realtime/src/http/static-web';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = `${ROOT}docs/FINAL_RELEASE_AUDIT.md`;

type Status = 'PASS' | 'FAIL' | 'OPEN' | 'EXTERNAL';
interface Result {
  status: Status;
  detail: string;
}
interface Check {
  id: string;
  title: string;
  result: Result;
}

const read = (path: string): string => readFileSync(`${ROOT}${path}`, 'utf8');
const exists = (path: string): boolean => existsSync(`${ROOT}${path}`);
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const tracked = git('ls-files', '-z')
  .split('\0')
  .filter((file) => file.length > 0 && exists(file));
const pass = (detail: string): Result => ({ status: 'PASS', detail });
const fail = (detail: string): Result => ({ status: 'FAIL', detail });

const isTest = (file: string): boolean =>
  /(\.test\.|\.spec\.|\/__tests__\/|\/tests\/|\.generated\.)/u.test(file);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|css|html|sql|md|yml|yaml|sh|toml|txt|jsonl)$/u;

// ───────────── checks ─────────────

const REQUIRED_DOCS = [
  'PROTOCOL',
  'SECURITY',
  'QA',
  'DEPLOYMENT',
  'BACKUP',
  'RUNBOOK',
  'RELEASE_CHECKLIST',
  'BROWSER_MATRIX',
  'EXTERNAL_CHECKLIST',
  'PRIVACY',
  'PERF',
  'ACCEPTANCE',
  'STATUS',
  'RED_TEAM',
  'ARCHITECTURE',
  'ADMIN',
  'MOBILE',
  'GUSTO_GO_LIVE',
];
function docsPresent(): Result {
  const missing = REQUIRED_DOCS.filter(
    (name) => !exists(`docs/${name}.md`) || read(`docs/${name}.md`).length < 800,
  );
  const infra = [
    'docker-compose.prod.yml',
    'Caddyfile',
    'env.production.example',
    'Dockerfile',
    'entrypoint.sh',
    'load-bank.sh',
  ].filter((name) => !exists(`infra/deployment/${name}`));
  return missing.length + infra.length === 0
    ? pass(
        `${REQUIRED_DOCS.length} docs present and non-trivial; production deployment files present`,
      )
    : fail(`missing or stub: ${[...missing.map((m) => `docs/${m}.md`), ...infra].join(', ')}`);
}

const PRODUCTION_PATHS = [
  /^apps\/realtime\/src\//u,
  /^apps\/web\/src\//u,
  /^apps\/admin\/src\//u,
  /^packages\/[^/]+\/src\//u,
  /^database\/migrations\//u,
  /^infra\/deployment\/(docker-compose\.prod\.yml|Caddyfile|Dockerfile|entrypoint\.sh)$/u,
];
const LEGAL_TEXTS = 'packages/i18n/src/legal.ts';
const PLACEHOLDER =
  /\b(TODO|FIXME|XXX|HACK|CHANGEME|CHANGE_ME|REPLACE_ME|OWNER-TO-FILL|TBD)\b|example\.(com|org|net)\b|com\.example\./u;
function noPlaceholders(): Result {
  const hits: string[] = [];
  for (const file of tracked) {
    if (!PRODUCTION_PATHS.some((p) => p.test(file)) || isTest(file) || !TEXT.test(file)) continue;
    // The legal drafts carry the owner's identity markers on purpose; row "legal-identity" reports them.
    if (file === LEGAL_TEXTS) continue;
    read(file)
      .split('\n')
      .forEach((line, index) => {
        if (PLACEHOLDER.test(line)) hits.push(`${file}:${index + 1}`);
      });
  }
  const compose = read('infra/deployment/docker-compose.prod.yml');
  const secrets = [
    'POSTGRES_PASSWORD',
    'SERVER_SECRET',
    'METRICS_TOKEN',
    'DOMAIN',
    'ADMIN_BOOTSTRAP_EMAILS',
  ];
  const unguarded = secrets.filter((name) => !compose.includes(`\${${name}:?`));
  if (hits.length > 0)
    return fail(`placeholder/TODO text in the production path: ${hits.slice(0, 12).join(', ')}`);
  if (unguarded.length > 0)
    return fail(
      `docker-compose.prod.yml does not require: ${unguarded.join(', ')} (use \${VAR:?message})`,
    );
  return pass(
    'no TODO/FIXME/placeholder owner value in server, web, admin, packages, migrations or production deployment files; the production compose file requires every secret',
  );
}

/** The `environment:` block of the compose app service with ${VAR} filled from a sample .env. */
function composeEnvironment(sample: Record<string, string>): Record<string, string> {
  const lines = read('infra/deployment/docker-compose.prod.yml').split('\n');
  const start = lines.findIndex((line) => /^ {2}app:/u.test(line));
  const env: Record<string, string> = {};
  let inEnv = false;
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}[a-z]+:/u.test(line)) break;
    if (/^ {4}environment:/u.test(line)) {
      inEnv = true;
      continue;
    }
    if (inEnv && /^ {4}[a-z]/u.test(line)) break;
    const m = /^ {6}([A-Z_]+): (.*)$/u.exec(line);
    if (!inEnv || !m) continue;
    const value = m[2]!
      .replace(/^'(.*)'$/u, '$1')
      .replace(/\$\{([A-Z_]+)(?::[?-][^}]*)?\}/gu, (_, name: string) => sample[name] ?? '');
    env[m[1]!] = value;
  }
  return env;
}

const SAMPLE_ENV: Record<string, string> = {
  DOMAIN: 'quiz.audit.invalid',
  POSTGRES_PASSWORD: 'audit0password',
  SERVER_SECRET: 'a'.repeat(16) + 'b'.repeat(16) + 'c'.repeat(16),
  METRICS_TOKEN: 'm'.repeat(24),
  ADMIN_BOOTSTRAP_EMAILS: 'owner@audit.invalid',
};
const DATABASE_PROBE = 'postgres://quizparty:x@127.0.0.1:1/none';

function productionConfigAndSeed(): Result {
  const env = { ...composeEnvironment(SAMPLE_ENV), DATABASE_URL: DATABASE_PROBE };
  const problems: string[] = [];
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    return fail(`the production compose environment is rejected by loadConfig: ${String(error)}`);
  }
  if (config.env !== 'production') problems.push('compose does not set NODE_ENV=production');
  if (config.allowDevSeed) problems.push('dev seed allowed in the production compose');
  if (config.defaultRoomTier !== 'FREE') problems.push('default room tier is not FREE');
  if (config.validateOutbound) problems.push('outbound validation unexpectedly on');
  if (config.rateLimitScale !== 1) problems.push('rate limit scale is not 1');
  if (config.trustProxyHops !== 1) problems.push('TRUST_PROXY_HOPS is not 1 behind Caddy');
  if (!config.serveWeb || !config.serveAdmin) problems.push('web/admin are not served');
  if (!config.publicWebUrl.startsWith('https://')) problems.push('public URL is not https');

  const refuses = (override: Record<string, string | undefined>, needle: RegExp): string | null => {
    try {
      loadConfig({ ...env, ...override });
      return `accepted ${JSON.stringify(override)}`;
    } catch (error) {
      return needle.test(String(error))
        ? null
        : `wrong refusal for ${JSON.stringify(override)}: ${String(error)}`;
    }
  };
  for (const [override, needle] of [
    [{ QP_ALLOW_DEV_SEED: '1' }, /QP_ALLOW_DEV_SEED/u],
    [{ SERVER_SECRET: undefined }, /SERVER_SECRET/u],
    [{ SERVER_SECRET: 'dev-only-change-me-dev-only-change-me' }, /SERVER_SECRET/u],
    [{ PUBLIC_WEB_URL: 'http://quiz.audit.invalid' }, /https/u],
    [{ ALLOWED_ORIGINS: '' }, /ALLOWED_ORIGINS/u],
    [{ ALLOWED_ORIGINS: 'http://quiz.audit.invalid' }, /https/u],
    [{ RATE_LIMIT_SCALE: '5' }, /RATE_LIMIT_SCALE/u],
    [{ DATABASE_URL: undefined }, /DATABASE_URL/u],
  ] as const) {
    const problem = refuses(override, needle);
    if (problem) problems.push(problem);
  }
  return problems.length === 0
    ? pass(
        'the production compose environment loads; production refuses a dev secret, a missing secret, a dev seed, plain-http URLs, an empty origin list, a scaled rate limit and a missing database',
      )
    : fail(problems.join('; '));
}

async function cliRefusesDevSeedInProduction(): Promise<Result> {
  const messages: string[] = [];
  const io = {
    out: () => undefined,
    err: (line: string) => messages.push(line),
    read: () => '',
    write: () => undefined,
  };
  const env = { NODE_ENV: 'production', DATABASE_URL: DATABASE_PROBE };
  const seed = await runQuestionCli(['seed'], env, io);
  const imported = await runQuestionCli(['import', 'x.jsonl', '--allow-dev-seed'], env, io);
  return seed === 2 && imported === 2 && messages.every((m) => /refused/u.test(m))
    ? pass(
        'the question CLI refuses `seed` and `import --allow-dev-seed` with NODE_ENV=production (exit 2)',
      )
    : fail(`expected exit 2 twice, got ${seed} and ${imported}: ${messages.join(' | ')}`);
}

const SHOULD_BE_OFF = [
  'mode.blind_quiz',
  'mode.who_said_it',
  'mode.custom_quiz',
  'sabotage.noise',
  'ai.decoys',
  'auth.apple',
  'auth.google',
  // venue mode (ADR-0024, migration 0009): off until an owner sets up a venue
  'venue.sessions',
];
const SHOULD_BE_ON = ['auth.email_login', 'content.current_events', 'report.questions'];
const NEVER_PUBLIC = ['ai.decoys', 'sabotage.noise'];
interface FlagDefault {
  key: string;
  enabled: boolean;
  isPublic: boolean;
}
function flagDefaults(): { result: Result; flags: FlagDefault[] } {
  const flags: FlagDefault[] = [];
  const later: string[] = [];
  for (const file of tracked.filter((f) => /^database\/migrations\/.*\.sql$/u.test(f))) {
    const sql = read(file);
    for (const block of sql.matchAll(
      /INSERT INTO feature_flags[^;]*?VALUES([\s\S]*?)(?:ON CONFLICT|;)/gu,
    ))
      for (const row of block[1]!.matchAll(
        /\(\s*'([^']+)'\s*,\s*(true|false)\s*,\s*(true|false)/gu,
      ))
        flags.push({ key: row[1]!, enabled: row[2] === 'true', isPublic: row[3] === 'true' });
    if (/UPDATE\s+feature_flags/iu.test(sql)) later.push(file);
  }
  const problems: string[] = [];
  for (const key of SHOULD_BE_OFF)
    if (flags.find((f) => f.key === key)?.enabled !== false)
      problems.push(`${key} must default to off`);
  for (const key of SHOULD_BE_ON)
    if (flags.find((f) => f.key === key)?.enabled !== true)
      problems.push(`${key} must default to on`);
  for (const key of NEVER_PUBLIC)
    if (flags.find((f) => f.key === key)?.isPublic !== false)
      problems.push(`${key} must not be public`);
  const known = new Set([...SHOULD_BE_OFF, ...SHOULD_BE_ON]);
  for (const f of flags)
    if (!known.has(f.key)) problems.push(`unclassified flag ${f.key}: decide its default here`);
  if (later.length > 0)
    problems.push(`a migration changes flag values after creation: ${later.join(', ')}`);
  // The runtime default for a missing flag is off (flags/service.ts); keep that property.
  if (!/\?\.enabled \?\? false/u.test(read('apps/realtime/src/flags/service.ts')))
    problems.push('FeatureFlags.isEnabled no longer defaults a missing flag to off');
  return {
    flags,
    result:
      problems.length === 0
        ? pass(
            `${flags.length} flags: every mode and the AI switch default to off; sign-in, reports, current events on; a missing flag reads as off`,
          )
        : fail(problems.join('; ')),
  };
}

function csp(): Result {
  const problems: string[] = [];
  const policy = buildCsp(["'sha256-AAAA'"], 'wss://quiz.audit.invalid');
  for (const required of [
    "default-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "script-src 'self'",
  ])
    if (!policy.includes(required)) problems.push(`policy lacks ${required}`);
  if (/unsafe-inline|unsafe-eval|\sdata:|\shttp:|\*/u.test(policy))
    problems.push(`policy is too loose: ${policy}`);
  for (const dist of ['apps/web/dist/index.html', 'apps/admin/dist/index.html']) {
    if (!exists(dist)) continue;
    const html = read(dist);
    const inline = [
      ...html.matchAll(/<script(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/script>/giu),
    ].filter(
      (m) => !/\bsrc\s*=/iu.test(m.groups?.attrs ?? '') && (m.groups?.body ?? '').trim() !== '',
    );
    if (inlineScriptHashes(html).length !== inline.length)
      problems.push(`${dist}: an inline script is not hashed`);
    if (/\son[a-z]+\s*=\s*["']/iu.test(html)) problems.push(`${dist}: inline event handler`);
  }
  const source = read('apps/realtime/src/app.ts');
  for (const header of [
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Strict-Transport-Security',
    'frame-ancestors',
  ])
    if (!source.includes(header)) problems.push(`app.ts no longer sets ${header}`);
  return problems.length === 0
    ? pass(
        'static-app CSP has default-src none, self-only scripts (inline scripts by hash), no unsafe-inline/eval/data:/wildcards, frame-ancestors none; built HTML (when present) has only hashed inline scripts; the live headers are checked in the next row and by ws static.test.ts',
      )
    : fail(problems.join('; '));
}

const PINNED = /^(workspace:|npm:|link:|file:|\d+\.\d+\.\d+(?:[-+][\w.]+)?$)/u;
function lockfile(): Result {
  const problems: string[] = [];
  if (!exists('pnpm-lock.yaml')) return fail('pnpm-lock.yaml is missing');
  for (const file of tracked.filter((f) => /(^|\/)package\.json$/u.test(f))) {
    const json = JSON.parse(read(file)) as Record<string, Record<string, string> | undefined>;
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies'])
      for (const [name, range] of Object.entries(json[group] ?? {}))
        if (!PINNED.test(range)) problems.push(`${file}: ${name}@${range}`);
  }
  const ci = read('.github/workflows/ci.yml');
  if (!/--frozen-lockfile/u.test(ci)) problems.push('CI does not install with --frozen-lockfile');
  if (!/--frozen-lockfile/u.test(read('infra/deployment/Dockerfile')))
    problems.push('Dockerfile does not use --frozen-lockfile');
  try {
    execFileSync('pnpm', ['install', '--frozen-lockfile', '--lockfile-only', '--offline'], {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } catch (error) {
    problems.push(
      `lockfile does not satisfy the package.json files: ${String((error as { stderr?: Buffer }).stderr ?? error).slice(0, 200)}`,
    );
  }
  if (!exists('.github/dependabot.yml')) problems.push('no Dependabot configuration');
  return problems.length === 0
    ? pass(
        'lockfile committed and consistent with every package.json (`pnpm install --frozen-lockfile --lockfile-only`); every dependency version is exact; CI and the Docker build install frozen; Dependabot configured',
      )
    : fail(problems.slice(0, 8).join('; '));
}

// Built from pieces so that this file does not match its own patterns.
const MODEL_ID = new RegExp(
  [
    '\\b(?:cla' + 'ude)-(?:opus|sonnet|haiku|instant|\\d)',
    '\\bgp' + 't-(?:\\d|[a-z]+-?\\d)',
    '\\bgem' + 'ini-\\d',
    '\\b(?:opus|sonnet|haiku)[ -]\\d',
    '\\bo\\d-(?:mini|preview)\\b',
    '\\bllama-?\\d',
  ].join('|'),
  'iu',
);
const SECRET_PATTERNS: [string, RegExp][] = [
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/u],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/u],
  ['API key (sk-)', /\bsk-[A-Za-z0-9_-]{24,}/u],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/u],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/u],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/u],
  ['JWT', /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\./u],
  [
    'URL with credentials',
    /\b[a-z][a-z0-9+.-]*:\/\/(?!quizparty:quizparty@)[^\s/:@'"`${}]+:[^\s/@'"`${}]{3,}@[^\s'"`]+/u,
  ],
];
function noModelIdsOrSecrets(): Result {
  const modelHits: string[] = [];
  const secretHits: string[] = [];
  const self = 'scripts/release-audit/main.ts';
  for (const file of tracked) {
    if (!TEXT.test(file) || file === 'pnpm-lock.yaml' || file === 'docs/FINAL_RELEASE_AUDIT.md')
      continue;
    if (/\.(jsonl)$/u.test(file) && file.startsWith('seed/')) continue; // question text, scanned by the bank tests
    const lines = read(file).split('\n');
    lines.forEach((line, index) => {
      if (line.length > 4000) return;
      if (file !== self && MODEL_ID.test(line)) modelHits.push(`${file}:${index + 1}`);
      if (file === self) return;
      for (const [name, pattern] of SECRET_PATTERNS) {
        if (isTest(file) && (name === 'API key (sk-)' || name === 'URL with credentials')) continue; // fake fixtures
        if (pattern.test(line)) secretHits.push(`${file}:${index + 1} (${name})`);
      }
    });
  }
  const envFiles = tracked.filter((f) => /(^|\/)\.env(\.|$)/u.test(f) && !/example/u.test(f));
  const messages = git('log', '--format=%H%x00%B%x01').split('\x01');
  const commitHits = messages
    .filter((m) => MODEL_ID.test(m.replace(/Co-Authored-By:.*$/gimu, '')))
    .map((m) => m.split('\0')[0]!.trim().slice(0, 8));
  const problems = [
    ...(modelHits.length
      ? [`model identifiers in files: ${modelHits.slice(0, 10).join(', ')}`]
      : []),
    ...(commitHits.length
      ? [`model identifiers in commit messages: ${commitHits.slice(0, 10).join(', ')}`]
      : []),
    ...(secretHits.length ? [`secret-shaped strings: ${secretHits.slice(0, 10).join(', ')}`] : []),
    ...(envFiles.length ? [`tracked env files: ${envFiles.join(', ')}`] : []),
  ];
  return problems.length === 0
    ? pass(
        `${tracked.length} tracked files and ${messages.length - 1} commit messages: no model identifiers, no key/token/credential-shaped strings, no tracked .env file (pattern scan, not a substitute for GitHub secret scanning)`,
      )
    : fail(problems.join('; '));
}

// ───────────── the production blueprint (render.production.yaml) ─────────────

interface BlueprintVar {
  key: string;
  value?: string;
  sync: boolean;
  generate: boolean;
  fromDatabase: boolean;
}

/** The `envVars` list of the blueprint's web service; the file is simple enough for a line reader. */
function blueprintVars(text: string): BlueprintVar[] {
  const vars: BlueprintVar[] = [];
  let current: BlueprintVar | null = null;
  let inEnv = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/u, '');
    if (/^\s*#/u.test(raw) || line.trim() === '') continue;
    if (/^\s{4}envVars:/u.test(line)) {
      inEnv = true;
      continue;
    }
    if (!inEnv) continue;
    const key = /^\s{6}- key: (\S+)\s*$/u.exec(line);
    if (key) {
      current = { key: key[1]!, sync: false, generate: false, fromDatabase: false };
      vars.push(current);
      continue;
    }
    if (!current) continue;
    const value = /^\s{8}value: (.*)$/u.exec(line);
    if (value) current.value = value[1]!.trim().replace(/^'(.*)'$/u, '$1');
    if (/^\s{8}sync: false\s*$/u.test(line)) current.sync = true;
    if (/^\s{8}generateValue: true\s*$/u.test(line)) current.generate = true;
    if (/^\s{8}fromDatabase:/u.test(line)) current.fromDatabase = true;
  }
  return vars;
}

const BLUEPRINT_SECRETS = [
  'SERVER_SECRET',
  'METRICS_TOKEN',
  'ADMIN_BOOTSTRAP_EMAILS',
  'PUBLIC_WEB_URL',
  'ALLOWED_ORIGINS',
  'EMAIL_PROVIDER',
  'EMAIL_API_KEY',
  'EMAIL_FROM',
  'BLIND_DATA_KEYS',
];
const FORBIDDEN_IN_PRODUCTION = [
  'VENUE_MINUTE_MS',
  'RATE_LIMIT_SCALE',
  'GAME_CONFIG_OVERRIDE',
  'VALIDATE_OUTBOUND',
  'DEFAULT_ROOM_TIER',
  'PAYMENTS_ACCEPT_SANDBOX',
  'EMAIL_API_BASE',
  'EMAIL_WEBHOOK_URL',
];

function productionBlueprint(): Result {
  const file = 'render.production.yaml';
  if (!exists(file)) return fail(`${file} is missing`);
  const text = read(file);
  const vars = blueprintVars(text);
  const get = (key: string): BlueprintVar | undefined => vars.find((v) => v.key === key);
  const problems: string[] = [];

  const must = (key: string, expected: string): void => {
    if (get(key)?.value !== expected) problems.push(`${key} must be '${expected}'`);
  };
  must('NODE_ENV', 'production');
  must('QP_ALLOW_DEV_SEED', '0');
  must('QP_SEED_DEV', '0');
  must('QP_SEED_DEMO', '0');
  must('SERVE_WEB', '1');
  must('SERVE_ADMIN', '1');
  for (const key of FORBIDDEN_IN_PRODUCTION)
    if (get(key)) problems.push(`${key} must not be set in the production blueprint`);
  if (get('QP_BANK_DIR')?.value?.includes('demo') || get('QP_BANK_DIR')?.value === '/app/seed')
    problems.push('QP_BANK_DIR points at a development bank');

  for (const name of BLUEPRINT_SECRETS) {
    const v = get(name);
    if (!v) problems.push(`${name} is not declared`);
    else if (v.value !== undefined || !(v.sync || v.generate))
      problems.push(`${name} must be \`sync: false\` or \`generateValue: true\`, never a value`);
  }
  // Anything that looks like a secret by name must not carry an inline value, declared or not.
  for (const v of vars)
    if (/(SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL)/u.test(v.key) && v.value !== undefined)
      if (v.key !== 'QP_BANK_KEEP_PREFIX') problems.push(`${v.key} carries an inline value`);
  if (/^\s*plan:\s*free\b/mu.test(text)) problems.push('a free plan (it sleeps / expires)');
  if (!/^\s{4}numInstances:\s*1\s*$/mu.test(text)) problems.push('numInstances must be 1');
  if (!/^\s{4}healthCheckPath:\s*\/healthz\s*$/mu.test(text))
    problems.push('no /healthz health check');
  if (!/^\s{4}ipAllowList:\s*\[\]\s*$/mu.test(text))
    problems.push('the database must not be open to the internet (ipAllowList: [])');
  if (!get('DATABASE_URL')?.fromDatabase) problems.push('DATABASE_URL must come from the database');
  if (get('VITE_DEFAULT_THEME')?.value !== 'gusto')
    problems.push('VITE_DEFAULT_THEME is not gusto');

  // The blueprint's environment, with plausible secrets typed in, must boot the real config in production.
  const env: Record<string, string> = {
    DATABASE_URL: DATABASE_PROBE,
    SERVER_SECRET: 'a'.repeat(44),
    METRICS_TOKEN: 'm'.repeat(32),
    ADMIN_BOOTSTRAP_EMAILS: 'owner@audit.invalid',
    PUBLIC_WEB_URL: 'https://gusto.audit.invalid',
    ALLOWED_ORIGINS: 'https://gusto.audit.invalid',
    EMAIL_PROVIDER: 'resend',
    EMAIL_API_KEY: 'k'.repeat(24),
    EMAIL_FROM: 'Gusto <giris@gusto.audit.invalid>',
  };
  for (const v of vars) if (v.value !== undefined) env[v.key] = v.value;
  try {
    const config = loadConfig(env);
    if (config.env !== 'production') problems.push('does not load as production');
    if (config.allowDevSeed) problems.push('dev seed allowed');
    if (!config.emailProvider) problems.push('no mail provider in the loaded config');
    if (config.blindKeys !== null) problems.push('blind keys unexpectedly present');
  } catch (error) {
    problems.push(`loadConfig refuses the blueprint environment: ${String(error)}`);
  }
  // Leaving the owner-typed values empty must be refused or harmless, never silently unsafe.
  try {
    const loose = loadConfig({ ...env, EMAIL_PROVIDER: '', EMAIL_API_KEY: '', EMAIL_FROM: '' });
    if (loose.emailProvider) problems.push('an empty mail setting still produced a sender');
  } catch {
    // refusing is fine as well
  }
  // The entrypoint must not be able to load a development bank in production.
  const entry = read('infra/deployment/entrypoint.sh');
  if (!/NODE_ENV:-development\}" = "production"/u.test(entry) || !/QP_SEED_DEV=0/u.test(entry))
    problems.push('entrypoint.sh does not switch QP_SEED_DEV/QP_SEED_DEMO off in production');
  if (!/load-bank\.sh/u.test(entry)) problems.push('entrypoint.sh does not call load-bank.sh');
  const loader = read('infra/deployment/load-bank.sh');
  if (
    /--allow-dev-seed|--dev-activate|\bseed\b.*--seed-file/u.test(loader.replace(/^\s*#.*$/gmu, ''))
  )
    problems.push('load-bank.sh uses a development flag');

  return problems.length === 0
    ? pass(
        `${file}: NODE_ENV=production, every dev flag 0, ${BLUEPRINT_SECRETS.length} secrets declared as sync:false / generateValue (none inlined), no test-only variable, paid plans, one instance, private database, /healthz, Gusto theme; its environment loads in production; the entrypoint cannot load a development bank`,
      )
    : fail(`${file}: ${problems.join('; ')}`);
}

function goLiveBankPresent(): Result {
  const dir = `${ROOT}seed/gusto`;
  const files = existsSync(dir)
    ? tracked.filter((f) => /^seed\/gusto\/questions\..*\.tr\.jsonl$/u.test(f))
    : [];
  return files.length > 0
    ? pass(`${files.length} verified bank file(s) in seed/gusto/ for QP_BANK_DIR`)
    : {
        status: 'OPEN',
        detail:
          'seed/gusto/questions.*.tr.jsonl is not committed yet: the production service would start with no questions',
      };
}

// ───────────── the running application ─────────────

interface RouteRow {
  method: string;
  url: string;
  auth: string;
  limit: string;
  roles: string;
}
async function liveApplication(): Promise<{ results: Check[]; routes: RouteRow[] }> {
  const results: Check[] = [];
  let database;
  try {
    database = await createTestDatabase();
  } catch (error) {
    const result = fail(`needs PostgreSQL (pnpm dev:db): ${String(error).slice(0, 160)}`);
    return {
      results: [
        { id: 'routes', title: 'Route policy inventory', result },
        { id: 'headers', title: 'Live response headers (production configuration)', result },
      ],
      routes: [],
    };
  }
  const serveWeb = exists('apps/web/dist/index.html');
  const serveAdmin = exists('apps/admin/dist/index.html');
  const env = {
    ...composeEnvironment(SAMPLE_ENV),
    DATABASE_URL: database.url,
    HOST: '127.0.0.1',
    PORT: '0',
    SERVE_WEB: serveWeb ? '1' : '0',
    SERVE_ADMIN: serveAdmin ? '1' : '0',
    MAINTENANCE_INTERVAL_MS: '0',
    INSTANCE_ID: 'release-audit',
  };
  const built = await buildApp({ config: loadConfig(env), logStream: { write: () => undefined } });
  const routesOut: RouteRow[] = [];
  try {
    const rows = built.routes
      .map((r) => ({
        method: r.method,
        url: r.url,
        auth: r.auth,
        limit: r.limit,
        roles: r.roles.join(', '),
      }))
      .sort((a, b) =>
        a.url === b.url ? a.method.localeCompare(b.method) : a.url.localeCompare(b.url),
      );
    routesOut.push(...rows);
    const problems: string[] = [];
    const writes = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    for (const r of built.routes) {
      if (!r.auth || !r.limit) problems.push(`${r.method} ${r.url} has no policy`);
      if (r.auth === 'admin' && !r.url.startsWith('/v1/admin/'))
        problems.push(`${r.method} ${r.url}: admin policy outside /v1/admin`);
      if (r.url.startsWith('/v1/admin/') && r.auth !== 'admin')
        problems.push(`${r.method} ${r.url}: under /v1/admin but not admin`);
      if (r.auth === 'admin' && r.roles.length === 0)
        problems.push(`${r.method} ${r.url}: admin route without roles`);
      if (writes.has(r.method) && r.auth === 'public' && r.limit === 'none')
        problems.push(`${r.method} ${r.url}: public write without a rate limit`);
      if (r.auth === 'metrics-token' && r.url !== '/metrics')
        problems.push(`${r.url}: unexpected metrics-token route`);
    }
    results.push({
      id: 'routes',
      title: 'Route policy inventory',
      result:
        problems.length === 0
          ? pass(
              `${rows.length} routes, each with an explicit auth and limit class; ${rows.filter((r) => r.auth === 'admin').length} admin routes all name roles and sit under /v1/admin; no public write route is unlimited (the boot-time guard in app.ts refuses an undeclared route; table below)`,
            )
          : fail(problems.join('; ')),
    });

    const headerProblems: string[] = [];
    const health = await built.app.inject({ method: 'GET', url: '/healthz' });
    const expect = (
      name: string,
      test: (value: string | undefined) => boolean,
      value: unknown,
    ): void => {
      if (!test(typeof value === 'string' ? value : undefined))
        headerProblems.push(`${name}: ${String(value)}`);
    };
    expect(
      'Strict-Transport-Security',
      (v) => /max-age=\d{7,}/u.test(v ?? ''),
      health.headers['strict-transport-security'],
    );
    expect(
      'X-Content-Type-Options',
      (v) => v === 'nosniff',
      health.headers['x-content-type-options'],
    );
    expect('Referrer-Policy', (v) => v === 'no-referrer', health.headers['referrer-policy']);
    expect(
      'Content-Security-Policy',
      (v) => /default-src 'none'/u.test(v ?? ''),
      health.headers['content-security-policy'],
    );
    const unauth = await built.app.inject({ method: 'GET', url: '/metrics' });
    if (unauth.statusCode !== 401)
      headerProblems.push(`/metrics without a token answered ${unauth.statusCode}`);
    const adminNoAuth = await built.app.inject({ method: 'GET', url: '/v1/admin/flags' });
    if (adminNoAuth.statusCode !== 401)
      headerProblems.push(`/v1/admin/flags without a session answered ${adminNoAuth.statusCode}`);
    const crossSite = await built.app.inject({
      method: 'GET',
      url: '/v1/flags',
      headers: { origin: 'https://evil.audit.invalid' },
    });
    if (crossSite.headers['access-control-allow-origin'] !== undefined)
      headerProblems.push('CORS allowed a foreign origin');
    if (serveWeb) {
      const shell = await built.app.inject({ method: 'GET', url: '/tv' });
      const policy = String(shell.headers['content-security-policy'] ?? '');
      if (!/script-src 'self'/u.test(policy) || /unsafe-/u.test(policy))
        headerProblems.push(`web shell CSP: ${policy}`);
      if (!String(shell.headers['permissions-policy'] ?? '').includes('camera=()'))
        headerProblems.push('web shell lacks Permissions-Policy');
    }
    results.push({
      id: 'headers',
      title: 'Live response headers (production configuration)',
      result:
        headerProblems.length === 0
          ? pass(
              `the application booted with the production compose environment answers with HSTS, nosniff, no-referrer and a deny-all CSP; /metrics and /v1/admin refuse anonymous callers; a foreign Origin gets no CORS grant${serveWeb ? '; the web shell carries the strict CSP and Permissions-Policy' : ' (web build absent: shell headers were not checked here, see ws static.test.ts)'}${serveAdmin ? '' : '; admin build absent'}`,
            )
          : fail(headerProblems.join('; ')),
    });

    // Retention jobs promised by ADR-0018: are they scheduled?
    const appSource = read('apps/realtime/src/app.ts');
    const retentionSource = exists('apps/realtime/src/moderation/retention.ts')
      ? read('apps/realtime/src/moderation/retention.ts')
      : '';
    const scheduled =
      /new RetentionJob\(/u.test(appSource) &&
      /maintenance\.addTask\([^;]*retention\.run\(\)/su.test(appSource);
    const missing = [
      'email_otps',
      'account_sessions',
      'security_events',
      'telemetry_events',
      'rooms',
    ].filter(
      (table) =>
        !retentionSource.includes(`'${table}'`) && !retentionSource.includes(`FROM ${table}`),
    );
    const untouchable = [
      'purchase_transactions',
      'entitlements',
      'store_notifications',
      'admin_audit',
      'venue_session',
    ].filter((table) =>
      new RegExp(`DELETE FROM ${table}|deleteFrom\\('${table}`, 'u').test(retentionSource),
    );
    const proof = exists('tests/integration/retention.test.ts');
    results.push({
      id: 'retention',
      title: 'Retention jobs promised by ADR-0018 are scheduled',
      result:
        scheduled && missing.length === 0 && untouchable.length === 0 && proof
          ? pass(
              'RetentionJob runs on the maintenance timer: sign-in codes 24 h, dead sessions 7 days, security events and telemetry 180 days, closed rooms 30 days (RETENTION_* overrides); purchases, entitlements, store notifications, the admin audit and the venue ledger are out of its reach; personal quizzes have their own job. Proof: integration retention.test.ts (injected clock)',
            )
          : fail(
              `retention not wired: scheduled=${scheduled} missing=${missing.join(',')} touches=${untouchable.join(',')} proof=${proof}`,
            ),
    });
  } finally {
    await built.close();
    await database.drop();
  }
  return { results, routes: routesOut };
}

// ───────────── acceptance matrix ─────────────

interface Criterion {
  id: string;
  title: string;
  milestone: string;
  proof: string;
  status: string;
}
function parseAcceptance(): Criterion[] {
  const rows: Criterion[] = [];
  for (const line of read('docs/ACCEPTANCE.md').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 8 || !/^[A-Z]{1,2}\d?$/u.test(cells[1] ?? '') || cells[1] === 'ID') continue;
    rows.push({
      id: cells[1]!,
      title: cells[2]!,
      milestone: cells[3]!,
      proof: cells[4]!,
      status: cells[6]!,
    });
  }
  return rows;
}

const BLOCKERS: Record<string, string> = {
  D: 'a real wide-area network pass: phones on mobile data joining a TV on another network (needs the production domain and real devices); the roaming logic is proven by red-team ATTACK 12',
  E: 'the production domain, signed iOS/Android builds and the association files fetched by Apple and Google; opening a link from Camera, Safari and Messages needs real devices',
  U: 'a store sandbox purchase: Apple Developer and Google Play accounts, products, Apple root certificates, a Google service account',
};
const OPEN_GAPS: Record<string, string> = {};

function proofFilesMissing(proof: string): string[] {
  const names = [...proof.matchAll(/`([\w.-]+\.(?:test|spec)\.tsx?)`/gu)].map((m) => m[1]!);
  return names.filter((name) => !tracked.some((file) => file.endsWith(`/${name}`)));
}

function acceptance(checks: Check[]): {
  rows: { c: Criterion; result: Result }[];
  failures: string[];
} {
  const byId = new Map(checks.map((c) => [c.id, c.result]));
  const rows: { c: Criterion; result: Result }[] = [];
  const failures: string[] = [];
  for (const c of parseAcceptance()) {
    const missing = proofFilesMissing(c.proof);
    let result: Result;
    if (missing.length > 0) {
      result = fail(`proof file not found: ${missing.join(', ')}`);
    } else if (c.id === 'AD') {
      const wired = /test:red-team/u.test(read('.github/workflows/ci.yml'));
      const files = tracked.filter((f) => /^tests\/red-team\/.*\.test\.ts$/u.test(f));
      const mapped = [
        ...read('docs/RED_TEAM.md').matchAll(/`((?:red-team\/)?[\w.-]+\.test\.ts)`/gu),
      ].map((m) => m[1]!.replace(/^red-team\//u, ''));
      const unmapped = mapped.filter((name) => !tracked.some((f) => f.endsWith(`/${name}`)));
      result =
        wired && files.length >= 5 && unmapped.length === 0
          ? pass(
              `${files.length} red-team test files, every file named in docs/RED_TEAM.md exists, \`pnpm test:red-team\` runs in CI (the result of the latest run is the CI result, not re-run here)`,
            )
          : fail(
              `red team not wired: ci=${wired} files=${files.length} unmapped=${unmapped.join(',')}`,
            );
    } else if (c.id === 'AE') {
      const r = byId.get('placeholders');
      result =
        r?.status === 'PASS'
          ? pass(
              'this audit: no TODO/placeholder owner value in the production path (row "Placeholders")',
            )
          : fail(r?.detail ?? 'placeholder check did not run');
    } else if (c.status.startsWith('PASS')) {
      result = pass(
        `proof files exist; ${c.proof.length > 160 ? `${c.proof.slice(0, 157)}...` : c.proof}`,
      );
    } else if (c.status === 'PARTIAL' && BLOCKERS[c.id]) {
      result = {
        status: 'EXTERNAL',
        detail: `logic proven (${c.proof.split('.')[0]!.slice(0, 140)}); blocker: ${BLOCKERS[c.id]}`,
      };
    } else if (c.status === 'PARTIAL' && OPEN_GAPS[c.id]) {
      result = { status: 'OPEN', detail: OPEN_GAPS[c.id]! };
    } else {
      result = fail(`status ${c.status} in docs/ACCEPTANCE.md has no verdict rule`);
    }
    if (result.status === 'FAIL') failures.push(`${c.id}: ${result.detail}`);
    rows.push({ c, result });
  }
  return { rows, failures };
}

function briefGates(checks: Check[]): { gate: string; result: Result }[] {
  const ok = (id: string): boolean => checks.find((c) => c.id === id)?.result.status === 'PASS';
  const gate = (name: string, result: Result): { gate: string; result: Result } => ({
    gate: name,
    result,
  });
  return [
    gate(
      'Monitoring works',
      exists('docs/DEPLOYMENT.md') &&
        ok('routes') &&
        /qp_room_input_seconds/u.test(read('apps/realtime/src/util/metrics.ts'))
        ? {
            status: 'EXTERNAL',
            detail:
              '/healthz, /readyz and a token-protected Prometheus /metrics exist and are tested; no dashboards or alert rules ship (infra/monitoring is empty). Blocker: the owner picks an uptime monitor and an alert channel (docs/EXTERNAL_CHECKLIST.md section 1)',
          }
        : fail('metrics or route inventory check failed'),
    ),
    gate(
      'Backup strategy exists',
      exists('docs/BACKUP.md')
        ? {
            status: 'EXTERNAL',
            detail:
              'docs/BACKUP.md documents dump, restore, retention and key rotation; dump and restore were run in the sandbox. Blocker: an off-server destination and a restore drill on the production host',
          }
        : fail('docs/BACKUP.md missing'),
    ),
    gate(
      'Release checklist exists',
      exists('docs/RELEASE_CHECKLIST.md') ? pass('docs/RELEASE_CHECKLIST.md') : fail('missing'),
    ),
    gate(
      'Browser compatibility documented',
      exists('docs/BROWSER_MATRIX.md')
        ? {
            status: 'EXTERNAL',
            detail:
              'documented with targets and an empty device table; only Chromium was ever run. Blocker: Safari, Firefox, Edge, smart-TV and console browsers on real devices',
          }
        : fail('missing'),
    ),
    gate(
      'No known critical security issue',
      ok('secrets') && ok('headers') && ok('routes') && exists('docs/SECURITY.md')
        ? pass(
            'red-team suite wired (AD), no secrets or model identifiers (row "Secrets"), route policies and headers verified; the known gaps are listed in docs/SECURITY.md section 3 (none is a data-exposure bug; retention jobs and the single-process limiter are the notable ones)',
          )
        : fail('a prerequisite check failed'),
    ),
    gate('Purchase verification works', {
      status: 'EXTERNAL',
      detail:
        'server-side verification is proven against doubles of the real wire formats (acceptance U-X, red team ATTACK 9 and 25). Blocker: store sandbox purchases with real Apple and Google accounts',
    }),
    gate(
      'Mobile fallback works',
      pass('the browser controller needs no install (acceptance F: e2e game.spec.ts)'),
    ),
  ];
}

function openCodeGaps(): { id: string; title: string; result: Result }[] {
  const gaps: { id: string; title: string; result: Result }[] = [];
  const router = read('apps/web/src/App.tsx');
  const missing = ['/privacy', '/terms', '/support'].filter((p) => !router.includes(`'${p}'`));
  const linked = [
    'apps/web/src/tv/screens/TvTitle.tsx',
    'apps/web/src/pages/CodeEntry.tsx',
    'apps/web/src/play/JoinForm.tsx',
  ].filter((file) => read(file).includes('<LegalLinks')).length;
  const legal = exists(LEGAL_TEXTS) ? read(LEGAL_TEXTS) : '';
  gaps.push({
    id: 'legal-pages',
    title: 'Privacy, terms and support pages are served',
    result:
      missing.length === 0 && linked === 3 && /not legal advice/u.test(legal)
        ? pass(
            '/privacy, /terms and /support are routes of the web app (Turkish text first, English second, lazy-loaded, served under the strict CSP: ws static.test.ts), linked from the TV title, the phone code and join screens and the admin console; every page carries a "draft, not legal advice" notice (web Legal.test.tsx)',
          )
        : {
            status: 'OPEN',
            detail: `missing routes: ${missing.join(', ') || 'none'}; screens linking them: ${linked}/3`,
          },
  });
  const markers = (legal.match(/OWNER-TO-FILL/gu) ?? []).length;
  gaps.push({
    id: 'legal-identity',
    title: "Legal texts carry the owner's identity and counsel review",
    result:
      markers === 0
        ? pass('no OWNER-TO-FILL marker left in packages/i18n/src/legal.ts')
        : {
            status: 'EXTERNAL',
            detail: `${markers} OWNER-TO-FILL markers in ${LEGAL_TEXTS} (controller identity, contact address, processors, legal bases, periods). Blocker: the owner fills them and has the texts reviewed by counsel, then removes the draft notice (docs/EXTERNAL_CHECKLIST.md section 5)`,
          },
  });
  const exportSource = read('apps/realtime/src/auth/privacy.ts');
  const quizSource = read('apps/realtime/src/blind/quizzes.ts');
  gaps.push({
    id: 'export-scope',
    title: 'Account export covers personal quizzes',
    result:
      /personalQuizzes/u.test(exportSource.slice(0, exportSource.indexOf('deleteAccount'))) &&
      /async exportForOwner\(/u.test(quizSource)
        ? pass(
            "GET /v1/me/export includes the account's personal quizzes as their creator sees them (titles, prompts, target names with completion counts, custom questions), never a target's sealed answer (integration account-privacy.test.ts)",
          )
        : {
            status: 'OPEN',
            detail:
              "GET /v1/me/export returns account, roles, sessions, purchases and entitlements but not the account's personal quizzes (docs/PRIVACY.md section 4)",
          },
  });
  return gaps;
}

// ───────────── report ─────────────

function table(headers: string[], rows: string[][]): string {
  const esc = (s: string): string => s.replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n');
}

async function main(): Promise<void> {
  const checks: Check[] = [];
  const add = (id: string, title: string, result: Result): void =>
    void checks.push({ id, title, result });

  add('docs', 'Required documents present', docsPresent());
  add(
    'placeholders',
    'Placeholders: no TODO or owner placeholder in the production path',
    noPlaceholders(),
  );
  add(
    'config',
    'Production configuration fails closed (dev secret, dev seed, http, rate-limit scale)',
    productionConfigAndSeed(),
  );
  add(
    'cli',
    'Dev-seed refusal in production (question CLI)',
    await cliRefusesDevSeedInProduction(),
  );
  const flags = flagDefaults();
  add('blueprint', 'Production blueprint (render.production.yaml)', productionBlueprint());
  add('gusto-bank', 'Gusto question bank committed for the production start', goLiveBankPresent());
  add('flags', 'Feature-flag defaults', flags.result);
  add('csp', 'CSP and security headers (static policy and built HTML)', csp());
  add('lockfile', 'Lockfile and pinned dependencies', lockfile());
  add(
    'secrets',
    'Secrets: no model identifiers, credentials or tracked env files',
    noModelIdsOrSecrets(),
  );
  const live = await liveApplication();
  checks.push(...live.results);
  for (const gap of openCodeGaps()) add(gap.id, gap.title, gap.result);

  const routeRows = live.routes;
  const acc = acceptance(checks);
  const gates = briefGates(checks);

  const all: Result[] = [
    ...checks.map((c) => c.result),
    ...acc.rows.map((r) => r.result),
    ...gates.map((g) => g.result),
  ];
  const count = (s: Status): number => all.filter((r) => r.status === s).length;
  const failed = count('FAIL');
  const commit = git('rev-parse', '--short', 'HEAD').trim();
  const dirty = git('status', '--porcelain').trim().length > 0;

  const md = [
    '# Final release audit',
    '',
    `Generated by \`pnpm release:audit\` on ${new Date().toISOString().slice(0, 10)} at commit \`${commit}\`${dirty ? ' (working tree had uncommitted changes)' : ''}. Do not edit by hand: rerun the command.`,
    '',
    `**Verdict: ${failed === 0 ? 'no mechanical failure' : `${failed} FAIL`}.** PASS ${count('PASS')} · EXTERNAL ${count('EXTERNAL')} · OPEN ${count('OPEN')} · FAIL ${failed}.`,
    '',
    '- `PASS` verified by this audit or by the named proof file (which must exist). `EXTERNAL` cannot be done in the build sandbox; the blocker is named and the runnable checklist is `docs/EXTERNAL_CHECKLIST.md`. `OPEN` is a known gap that needs no outside party. `FAIL` blocks the release.',
    '- What the sandbox can and cannot prove is ADR-0019. This audit is a pattern and structure check; it does not replace the test suites (`pnpm test:all`, `pnpm test:e2e`) or the manual pass in `docs/RELEASE_CHECKLIST.md`.',
    '',
    '## 1. Mechanical checks',
    '',
    table(
      ['Check', 'Result', 'Detail'],
      checks.map((c) => [c.title, c.result.status, c.result.detail]),
    ),
    '',
    '## 2. Acceptance criteria (docs/ACCEPTANCE.md)',
    '',
    table(
      ['ID', 'Criterion', 'Result', 'Evidence / blocker'],
      acc.rows.map(({ c, result }) => [c.id, c.title, result.status, result.detail]),
    ),
    '',
    '## 3. Brief gates (final release gate)',
    '',
    table(
      ['Gate', 'Result', 'Evidence / blocker'],
      gates.map((g) => [g.gate, g.result.status, g.result.detail]),
    ),
    '',
    '## 4. Everything only the owner can do',
    '',
    'See `docs/EXTERNAL_CHECKLIST.md` (accounts, domain and server, signing and listings, devices, legal texts, content rights). The EXTERNAL rows above map to its sections 1-6.',
    '',
    '## 5. Feature-flag defaults (migration 0004)',
    '',
    table(
      ['Flag', 'Default', 'Public'],
      flags.flags.map((f) => [f.key, f.enabled ? 'on' : 'off', f.isPublic ? 'yes' : 'no']),
    ),
    '',
    '## 6. Route policy inventory',
    '',
    `Built from the running application (production-shaped configuration, web and admin serving ${exists('apps/web/dist/index.html') ? 'on' : 'off'}).`,
    '',
    table(
      ['Method', 'Path', 'Auth', 'Limit class', 'Roles'],
      routeRows.map((r) => [r.method, r.url, r.auth, r.limit, r.roles]),
    ),
    '',
  ].join('\n');
  writeFileSync(OUT, md);
  console.log(`${md.split('\n').slice(4, 6).join('\n')}\nwritten ${OUT}`);
  if (failed > 0) {
    for (const f of [
      ...checks
        .filter((c) => c.result.status === 'FAIL')
        .map((c) => `${c.title}: ${c.result.detail}`),
      ...acc.failures,
    ])
      console.error(`FAIL ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

await main();
