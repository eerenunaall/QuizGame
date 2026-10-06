import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import { run, type Env, type Io } from '@quizparty/scripts/question/cli';
import { answerKey, importRows, statusCounts } from '../helpers/question-bank';
import { startModelServer, wellBehavedModel } from '../helpers/model-server';
import { cleanRows, jsonl, NOW, SEED_PATH, withCategories } from '../helpers/questions';

/**
 * The operator's command line (`pnpm question …`). The commands run against a real database; the
 * model service is a local HTTP server speaking the Messages API wire format, so the real client,
 * prompts, routing and parsing are exercised without a network or a key.
 */
let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await sql`TRUNCATE questions CASCADE`.execute(t.db);
  await sql`TRUNCATE categories CASCADE`.execute(t.db);
});

function harness(files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  const io: Io = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    read: (path) => {
      const content = files[path] ?? written.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    write: (path, content) => void written.set(path, content),
  };
  const exec = (argv: string[], env: Env = {}) => run(argv, env, io, { db: t.db, now: () => NOW });
  return { io, out, err, written, exec, text: () => out.join('\n') };
}

describe('usage', () => {
  it('prints help, refuses what it does not know and says what is missing', async () => {
    const h = harness();
    expect(await h.exec(['help'])).toBe(0);
    expect(h.text()).toContain('Usage: pnpm question');
    expect(await h.exec([])).toBe(2);
    expect(await h.exec(['frobnicate'])).toBe(2);
    expect(h.err.join('\n')).toContain('unknown command: frobnicate');

    for (const [argv, message] of [
      [['import'], 'import needs a file'],
      [['import', 'missing.jsonl'], 'cannot read missing.jsonl'],
      [['import-results', 'missing.jsonl', '--source', 'x'], 'cannot read missing.jsonl'],
      [['import', 'x.jsonl', '--dev-activate'], '--dev-activate needs --allow-dev-seed'],
      [['import', 'x.jsonl', '--format', 'xml'], 'unknown format xml'],
      [['import', 'x.jsonl', '--no-such-option'], 'Unknown option'],
      [['audit', '--status', 'SHINY'], 'unknown status SHINY'],
      [['export'], 'export needs --out'],
      [['import-results', 'r.jsonl'], 'import-results needs --source'],
    ] as const) {
      const fresh = harness();
      expect(await fresh.exec([...argv])).toBe(2);
      expect(fresh.err.join('\n')).toContain(message);
    }
    // A key without a model name is a configuration mistake, not a silent no-op.
    const unconfigured = harness();
    expect(await unconfigured.exec(['audit', '--status', 'DRAFT'], { AUDIT_API_KEY: 'k' })).toBe(2);
    expect(unconfigured.err.join('\n')).toContain('AUDIT_MODEL_FAST');
  });
});

describe('import', () => {
  it('imports a file, reports in plain words and can write the full report', async () => {
    const rows = cleanRows(3);
    await withCategories(t.db);
    const h = harness({ 'in.jsonl': jsonl(rows) });
    expect(await h.exec(['import', 'in.jsonl', '--dry-run', '--report', 'dry.json'])).toBe(0);
    expect(h.out[0]).toBe('[dry run] 3 rows: 3 CREATED');
    expect(await statusCounts(t.db)).toEqual({});
    expect(JSON.parse(h.written.get('dry.json')!)).toMatchObject({ dryRun: true, total: 3 });

    const real = harness({ 'in.jsonl': jsonl(rows) });
    expect(await real.exec(['import', 'in.jsonl'])).toBe(0);
    expect(real.out[0]).toBe('3 rows: 3 CREATED');
    expect(real.text()).toContain('created as: {"DRAFT":3}');
    expect(await statusCounts(t.db)).toEqual({ DRAFT: 3 });

    const again = harness({ 'in.jsonl': jsonl(rows) });
    expect(await again.exec(['import', 'in.jsonl'])).toBe(0);
    expect(again.out[0]).toBe('3 rows: 3 UNCHANGED');
  });

  it('exits 1 and names the lines it could not import', async () => {
    await withCategories(t.db);
    const [good, bad] = cleanRows(2);
    const h = harness({ 'in.jsonl': jsonl([good, { ...bad, category: 'no-such-category' }]) });
    expect(await h.exec(['import', 'in.jsonl'])).toBe(1);
    expect(h.err[0]).toContain('line 2');
    expect(h.err[0]).toContain('UNKNOWN_CATEGORY');
    expect(await statusCounts(t.db)).toEqual({ DRAFT: 1 });
  });

  it('reads a spreadsheet by its extension', async () => {
    await withCategories(t.db);
    const csv = [
      'category,difficulty,question,optionA,optionB,optionC,optionD,correct,authorType',
      'general,EASY,Bir haftada kaç gün vardır?,5,6,7,8,C,human',
    ].join('\n');
    const h = harness({ 'in.csv': csv });
    expect(await h.exec(['import', 'in.csv', '--dry-run'])).toBe(0);
    expect(h.out[0]).toBe('[dry run] 1 rows: 1 CREATED');
  });

  it('keeps development content out of production, however it is asked for', async () => {
    await withCategories(t.db);
    const dev = { ...cleanRows(1)[0]!, authorType: 'DEV_SEED' };
    const production: Env = { NODE_ENV: 'production' };
    for (const argv of [
      ['import', 'in.jsonl', '--allow-dev-seed'],
      ['import', 'in.jsonl', '--allow-dev-seed', '--dev-activate'],
      ['seed'],
    ]) {
      const h = harness({ 'in.jsonl': jsonl([dev]) });
      expect(await h.exec(argv, production)).toBe(2);
      expect(h.err.join('\n')).toContain('not allowed when NODE_ENV=production');
    }
    // Without the switch the row itself is refused, in any environment.
    const plain = harness({ 'in.jsonl': jsonl([dev]) });
    expect(await plain.exec(['import', 'in.jsonl'], production)).toBe(1);
    expect(plain.err.join('\n')).toContain('FORBIDDEN_AUTHOR');
    expect(await statusCounts(t.db)).toEqual({});
    // An explicit operator override exists for staging copies of production.
    const override = harness({ 'in.jsonl': jsonl([dev]) });
    expect(
      await override.exec(['import', 'in.jsonl', '--allow-dev-seed'], {
        ...production,
        QP_ALLOW_DEV_SEED: '1',
      }),
    ).toBe(0);
  });

  it('seeds the whole development bank with one command', async () => {
    const h = harness({ [SEED_PATH]: readFileSync(SEED_PATH, 'utf8') });
    expect(await h.exec(['seed', '--seed-file', SEED_PATH], { NODE_ENV: 'development' })).toBe(0);
    expect(h.out[0]).toBe('seed: 340 CREATED');
    expect(await statusCounts(t.db)).toEqual({ ACTIVE: 340 });
    const again = harness({ [SEED_PATH]: readFileSync(SEED_PATH, 'utf8') });
    expect(await again.exec(['seed', '--seed-file', SEED_PATH])).toBe(0);
    expect(again.out[0]).toBe('seed: 340 UNCHANGED');
  });
});

describe('audit with a model', () => {
  it('runs the five model passes through the real client and routes by risk', async () => {
    await withCategories(t.db);
    const ids = await importRows(t.db, cleanRows(4));
    const server = await startModelServer(wellBehavedModel(await answerKey(t.db, ids)));
    try {
      const h = harness();
      const env: Env = {
        AUDIT_API_KEY: 'test-key',
        AUDIT_MODEL_FAST: 'fast-model',
        AUDIT_MODEL_STRONG: 'strong-model',
        AUDIT_API_BASE: server.url,
      };
      expect(
        await h.exec(
          ['audit', '--status', 'DRAFT', '--auto-activate', '--report', 'audit.json'],
          env,
        ),
      ).toBe(0);
      expect(h.out[0]).toBe('4 questions; passes: heuristics + 5 model passes');
      expect(h.text()).toContain('status changes: {"DRAFT→ACTIVE":4}');
      expect(await statusCounts(t.db)).toEqual({ ACTIVE: 4 });

      // Each question: one blind answer, then the five passes; nothing is asked twice.
      expect(server.requests).toHaveLength(4 * 6);
      expect(new Set(server.requests.map((request) => request.headers['x-api-key']))).toEqual(
        new Set(['test-key']),
      );
      expect(
        new Set(server.requests.map((request) => request.headers['anthropic-version'])),
      ).toEqual(new Set(['2023-06-01']));
      expect(new Set(server.requests.map((request) => request.path))).toEqual(
        new Set(['/v1/messages']),
      );
      expect(new Set(server.requests.map((request) => request.body.model))).toEqual(
        new Set(['fast-model']),
      );
      expect(server.requests.every((request) => request.body.temperature === 0)).toBe(true);
      // The blind check never sees the official answer.
      const blind = server.requests.filter((request) =>
        request.body.system.startsWith('You are an expert quiz player'),
      );
      expect(blind).toHaveLength(4);
      for (const request of blind)
        expect(request.body.messages[0]!.content).not.toMatch(/officialAnswerIndex|explanation/u);

      const audits = await t.db
        .selectFrom('question_audits')
        .select(['pass', 'provider'])
        .where('pass', '=', 'FACT_CHECK')
        .execute();
      expect(new Set(audits.map((audit) => audit.provider))).toEqual(
        new Set(['llm:fast-model/strong-model']),
      );
      const report = JSON.parse(h.written.get('audit.json')!) as {
        tokens: { input: number; output: number };
      };
      expect(report.tokens).toEqual({ input: 24 * 120, output: 24 * 40 });

      // A second run finds everything done and asks the model nothing.
      server.requests.length = 0;
      const again = harness();
      expect(await again.exec(['audit', '--status', 'ACTIVE'], env)).toBe(0);
      expect(server.requests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('sends a disagreeing blind answer to a person instead of approving', async () => {
    await withCategories(t.db);
    const ids = await importRows(t.db, cleanRows(2));
    const lies = new Map(
      [...(await answerKey(t.db, ids))].map(([text, index]) => [text, (index + 1) % 4]),
    );
    const server = await startModelServer(wellBehavedModel(lies));
    try {
      const h = harness();
      const env: Env = { AUDIT_API_KEY: 'k', AUDIT_MODEL_FAST: 'm', AUDIT_API_BASE: server.url };
      expect(await h.exec(['audit', '--status', 'DRAFT', '--auto-activate'], env)).toBe(0);
      expect(await statusCounts(t.db)).toEqual({ REVIEW: 2 });
      // A disagreeing blind answer replaces the fact check's second request; the other passes still run.
      expect(server.requests).toHaveLength(2 * 5);
    } finally {
      await server.close();
    }
  });

  it('reports a model outage per question and exits 1, never half-approving', async () => {
    await withCategories(t.db);
    await importRows(t.db, cleanRows(2));
    const server = await startModelServer(() => ({ status: 400 }));
    try {
      const h = harness();
      const env: Env = { AUDIT_API_KEY: 'k', AUDIT_MODEL_FAST: 'm', AUDIT_API_BASE: server.url };
      expect(await h.exec(['audit', '--status', 'DRAFT', '--auto-activate'], env)).toBe(1);
      expect(h.err).toHaveLength(2);
      expect(h.err[0]).toContain('model API answered 400');
      expect(await statusCounts(t.db)).toEqual({ DRAFT: 2 });
    } finally {
      await server.close();
    }
  });

  it('without a model it still reviews automatically and says the fact check did not run', async () => {
    await withCategories(t.db);
    await importRows(t.db, cleanRows(3));
    const h = harness();
    expect(await h.exec(['audit', '--status', 'DRAFT', '--no-models', '--dry-run'])).toBe(0);
    expect(h.out[0]).toContain('no model configured: fact check stays NOT_RUN');
    expect(h.text()).toContain('[dry run] verdicts: 3 → 0 PASS / 3 REVIEW / 0 REJECT');
    expect(h.text()).toContain('FACT_CHECK_NOT_RUN 3');
    expect(await statusCounts(t.db)).toEqual({ DRAFT: 3 });
  });
});

describe('manual audit rounds and maintenance', () => {
  it('exports with instructions, takes the results back and runs maintenance', async () => {
    await withCategories(t.db);
    const rows = cleanRows(2);
    await importRows(t.db, rows);
    const h = harness();
    expect(await h.exec(['export', '--out', 'round/q.jsonl', '--status', 'DRAFT'])).toBe(0);
    expect(h.out[0]).toBe('2 questions written to round/q.jsonl');
    expect(h.written.get('round/q.jsonl.instructions.md')).toContain(
      'Quiz Party: question audit round',
    );
    const exported = h.written
      .get('round/q.jsonl')!
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { questionId: string; revision: number });
    expect(exported).toHaveLength(2);

    const scores = {
      factAccuracy: 5,
      clarity: 5,
      uniqueness: 5,
      distractorQuality: 5,
      languageQuality: 5,
      difficultyAccuracy: 4,
      gameplayValue: 4,
      answerFairness: 5,
      freshness: 5,
      aiSlopRisk: 5,
    };
    const results = exported.map((row) => ({
      questionId: row.questionId,
      revision: row.revision,
      status: 'PASS',
      scores,
    }));
    const back = harness({
      'results.jsonl': jsonl([...results, { questionId: 'nobody', status: 'PASS', scores }]),
    });
    expect(await back.exec(['import-results', 'results.jsonl', '--source', 'round-1'])).toBe(1);
    expect(back.out[0]).toBe('2 of 3 results applied; verdicts: 2 → 2 PASS / 0 REVIEW / 0 REJECT');
    expect(back.err[0]).toContain('line 3: question_not_found nobody');
    expect(await statusCounts(t.db)).toEqual({ APPROVED: 2 });

    const maintain = harness();
    expect(await maintain.exec(['maintain'])).toBe(0);
    expect(maintain.out[0]).toBe(
      'maintenance: 0 expired, 0 due for re-verification, 0 flagged by answer statistics',
    );
  });

  it('creates the launch categories once', async () => {
    const h = harness();
    expect(await h.exec(['categories'])).toBe(0);
    expect(h.out[0]).toMatch(/^launch categories: \d+ created$/u);
    const again = harness();
    expect(await again.exec(['categories'])).toBe(0);
    expect(again.out[0]).toBe('launch categories: 0 created');
  });
});

describe('the real executable', () => {
  const run_ = promisify(execFile);
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const main = fileURLToPath(new URL('../../scripts/question/main.ts', import.meta.url));

  async function tsx(
    args: string[],
    env: Record<string, string>,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await run_('pnpm', ['exec', 'tsx', main, ...args], {
        cwd: root,
        env: { ...process.env, ...env },
        timeout: 60_000,
      });
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return {
        code: failure.code ?? 1,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
      };
    }
  }

  it('connects through DATABASE_URL, closes the pool and returns the right exit codes', async () => {
    const env = { DATABASE_URL: t.url };
    const first = await tsx(['categories'], env);
    expect(first).toMatchObject({ code: 0 });
    expect(first.stdout).toMatch(/launch categories: \d+ created/u);
    expect(
      Number(
        (
          await t.db
            .selectFrom('categories')
            .select((eb) => eb.fn.countAll<number>().as('n'))
            .executeTakeFirstOrThrow()
        ).n,
      ),
    ).toBeGreaterThan(10);
    expect((await tsx(['frobnicate'], env)).code).toBe(2);
    expect((await tsx(['seed'], { ...env, NODE_ENV: 'production' })).code).toBe(2);
    expect((await tsx(['help'], env)).stdout).toContain('Usage: pnpm question');
  }, 120_000);
});
