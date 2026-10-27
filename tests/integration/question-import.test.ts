import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import {
  ImportBatchError,
  importQuestions,
  parseImportText,
  type ImportReport,
} from '@quizparty/question-bank';
import {
  cleanRows,
  countRows,
  jsonl,
  NOW,
  seedRows,
  withCategories,
  type Row,
} from '../helpers/questions';

/**
 * Acceptance Y: the question bank imports (ADR-0014). Real PostgreSQL, the real importer, the real
 * seed. Imports never produce ACTIVE questions (dev-seed rows excepted, on request), re-running a
 * file changes nothing, and a hostile or sloppy file is reported row by row, never half-applied.
 */
let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
  await withCategories(t.db);
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await sql`TRUNCATE questions CASCADE`.execute(t.db);
});

const importRows = (
  rows: readonly unknown[],
  options: Partial<Parameters<typeof importQuestions>[2]> = {},
): Promise<ImportReport> =>
  importQuestions(t.db, parseImportText(jsonl(rows), 'jsonl'), { now: NOW, ...options });

const statusOf = async (externalId: string) =>
  (
    await t.db
      .selectFrom('questions')
      .select('status')
      .where('external_id', '=', externalId)
      .executeTakeFirstOrThrow()
  ).status;

describe('a clean import', () => {
  it('stores questions as DRAFT with fingerprints, options, audits and a status log, never ACTIVE', async () => {
    const rows = cleanRows(20);
    const report = await importRows(rows);
    expect(report.counts).toMatchObject({ CREATED: 20, INVALID: 0 });
    expect(report.created).toEqual({ DRAFT: 20 });
    expect(report.summary).toMatchObject({ total: 20, pass: 20, review: 0, reject: 0 });

    const stored = await t.db
      .selectFrom('questions')
      .select([
        'status',
        'revision',
        'lexical_fingerprint',
        'semantic_provider',
        'semantic_fingerprint',
        'is_dev_seed',
        'fingerprint_version',
      ])
      .execute();
    expect(stored).toHaveLength(20);
    for (const row of stored) {
      expect(row.status).toBe('DRAFT');
      expect(row.revision).toBe(1);
      expect(row.lexical_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
      expect(row.semantic_provider).toBe('hash-ngram'); // honest: never presented as a semantic check
      expect(row.semantic_fingerprint?.length).toBeGreaterThan(100);
      expect(row.is_dev_seed).toBe(false);
      expect(row.fingerprint_version).toBe(1);
    }
    const options = await t.pool.query<{ n: string; correct: string }>(
      `SELECT count(*)::text AS n, count(*) FILTER (WHERE is_correct)::text AS correct FROM question_options`,
    );
    expect(options.rows[0]).toEqual({ n: String(20 * 4), correct: '20' });

    const audits = await t.pool.query<{ pass: string; n: string }>(
      `SELECT pass, count(*)::text AS n FROM question_audits GROUP BY pass ORDER BY pass`,
    );
    expect(audits.rows).toEqual([
      { pass: 'ARBITER', n: '20' },
      { pass: 'HEURISTIC', n: '20' },
    ]);
    const arbiter = await t.db
      .selectFrom('question_audits')
      .select(['status', 'reason_codes'])
      .where('pass', '=', 'ARBITER')
      .executeTakeFirstOrThrow();
    expect(arbiter.status).toBe('REVIEW'); // no model has checked the facts yet
    expect(arbiter.reason_codes).toContain('FACT_CHECK_NOT_RUN');

    const log = await t.db
      .selectFrom('question_status_log')
      .select(['from_status', 'to_status', 'reason'])
      .execute();
    expect(log).toHaveLength(20);
    expect(log[0]).toEqual({ from_status: null, to_status: 'DRAFT', reason: 'IMPORT' });
  });

  it('is idempotent: importing the same file again changes nothing', async () => {
    const rows = cleanRows(30);
    await importRows(rows);
    const before = {
      questions: await countRows(t.db, 'questions'),
      audits: await countRows(t.db, 'question_audits'),
      log: await countRows(t.db, 'question_status_log'),
    };
    const stamp = await t.pool.query(`SELECT max(updated_at) AS at FROM questions`);
    const again = await importRows(rows);
    expect(again.counts).toMatchObject({ UNCHANGED: 30, CREATED: 0 });
    expect({
      questions: await countRows(t.db, 'questions'),
      audits: await countRows(t.db, 'question_audits'),
      log: await countRows(t.db, 'question_status_log'),
    }).toEqual(before);
    expect((await t.pool.query(`SELECT max(updated_at) AS at FROM questions`)).rows[0]).toEqual(
      stamp.rows[0],
    );
  });

  it('writes nothing in a dry run but reports what would happen', async () => {
    const report = await importRows(cleanRows(10), { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.counts.CREATED).toBe(10);
    expect(await countRows(t.db, 'questions')).toBe(0);
    expect(await countRows(t.db, 'question_audits')).toBe(0);
  });

  it('imports the whole hand-written seed as development content, ACTIVE on request, and refuses it otherwise', async () => {
    const refused = await importRows(seedRows(), { dryRun: true });
    expect(refused.counts.FORBIDDEN_AUTHOR).toBe(340);
    expect(refused.counts.CREATED).toBe(0);

    const report = await importRows(seedRows(), { allowDevSeed: true, devActivate: true });
    expect(report.counts).toMatchObject({
      CREATED: 340,
      INVALID: 0,
      UNKNOWN_CATEGORY: 0,
      DUPLICATE: 0,
      CONFLICT: 0,
    });
    expect(report.created).toEqual({ ACTIVE: 340 });
    const flags = await t.pool.query<{ author_type: string; is_dev_seed: boolean; n: string }>(
      `SELECT author_type, is_dev_seed, count(*)::text AS n FROM questions GROUP BY 1, 2`,
    );
    expect(flags.rows).toEqual([{ author_type: 'DEV_SEED', is_dev_seed: true, n: '340' }]);
    const perCategory = await t.pool.query<{ category_id: string; n: string }>(
      `SELECT category_id, count(*)::text AS n FROM questions GROUP BY 1 ORDER BY 1`,
    );
    expect(perCategory.rows).toHaveLength(17);
    expect(new Set(perCategory.rows.map((row) => row.n))).toEqual(new Set(['20']));
  });

  it('keeps an unactivated dev-seed import out of play', async () => {
    const report = await importRows(
      cleanRows(5).map((row) => ({ ...row, authorType: 'DEV_SEED' })),
      { allowDevSeed: true },
    );
    expect(report.created).toEqual({ DRAFT: 5 });
  });
});

describe('rows that cannot be imported are reported, the rest still are', () => {
  it('names the problem of every bad row', async () => {
    const good = cleanRows(3);
    const text = [
      JSON.stringify(good[0]),
      '{not json',
      JSON.stringify({ ...good[1], difficulty_level: 3 }),
      JSON.stringify({ ...good[2], correctIndex: 9 }),
      JSON.stringify({ ...cleanRows(4)[3], externalId: 'h-x', category: 'no-such-category' }),
      JSON.stringify({ ...good[2], externalId: 'h-dev', authorType: 'DEV_SEED' }),
      JSON.stringify(cleanRows(5)[4]),
    ].join('\n');
    const report = await importQuestions(t.db, parseImportText(text, 'jsonl'), { now: NOW });
    expect(report.counts).toMatchObject({
      CREATED: 2,
      INVALID: 3,
      UNKNOWN_CATEGORY: 1,
      FORBIDDEN_AUTHOR: 1,
    });
    const issues = Object.fromEntries(
      report.items.map((item) => [
        item.line,
        item.issues?.map((issue) => `${issue.path}:${issue.code}`),
      ]),
    );
    expect(issues[2]).toEqual([':invalid_json']);
    expect(issues[3]).toEqual([':unknown_field']);
    expect(issues[4]).toEqual(['correctIndex:correct_index_out_of_range']);
    expect(issues[5]).toEqual(['category:unknown_category']);
    expect(issues[6]).toEqual(['authorType:dev_seed_not_allowed']);
    expect(await countRows(t.db, 'questions')).toBe(2);
  });

  it('reads a spreadsheet export: letters for the correct answer, formula-looking cells are plain data', async () => {
    const csv = [
      'externalId,category,difficulty,question,optionA,optionB,optionC,optionD,correct,authorType',
      'sheet-1,general,easy,Bir hafta kaç günden oluşur?,Yedi,Altı,Beş,Sekiz,a,human',
      'sheet-2,general,easy,Bir yılda kaç mevsim vardır?,Üç,Dört,Beş,Altı,b,human',
      'sheet-3,general,easy,"=HYPERLINK(""http://kotu.example"")",x,y,z,w,a,human',
      'sheet-4,general,easy,Eksik şık satırı örnek metni burada?,Bir,,Üç,Dört,a,human',
    ].join('\n');
    const report = await importQuestions(t.db, parseImportText(csv, 'csv'), { now: NOW });
    expect(report.counts).toMatchObject({ CREATED: 3, INVALID: 1 });
    const bad = report.items.find((item) => item.key === 'line:5');
    expect(bad?.issues?.[0]?.code).toBe('option_gap');
    const formula = await t.db
      .selectFrom('questions')
      .select(['text', 'status'])
      .where('external_id', '=', 'sheet-3')
      .executeTakeFirstOrThrow();
    expect(formula.text).toBe('=HYPERLINK("http://kotu.example")'); // stored as text; exports neutralise it (csv tests)
    expect(formula.status).not.toBe('ACTIVE');
    expect(await statusOf('sheet-1')).toBe('DRAFT');
  });
});

describe('duplicates', () => {
  it('skips a copy of a stored question and calls a different answer a conflict', async () => {
    const [first] = cleanRows(1);
    await importRows([first]);
    const report = await importRows([
      { ...first, externalId: 'copy-1', question: first!.question.toUpperCase() },
      {
        ...first,
        externalId: 'copy-2',
        options: ['Yanlış A', 'Yanlış B', 'Yanlış C', 'Yanlış D'],
        correctIndex: 1,
      },
    ]);
    expect(report.counts).toMatchObject({ DUPLICATE: 1, CONFLICT: 1, CREATED: 0 });
    expect(report.items.every((item) => item.otherId !== undefined)).toBe(true);
    expect(await countRows(t.db, 'questions')).toBe(1);
  });

  it('catches the second copy inside one file', async () => {
    const [first] = cleanRows(1);
    const report = await importRows([first, { ...first, externalId: 'twin' }]);
    expect(report.counts).toMatchObject({ CREATED: 1, DUPLICATE: 1 });
  });

  it('stores a near-duplicate typo variant as REJECTED, with the reason on the audit', async () => {
    const original = {
      externalId: 'orig',
      category: 'general',
      difficulty: 'EASY',
      question: 'Nil Nehri hangi kıtada yer alır?',
      options: ['Afrika', 'Asya', 'Avrupa', 'Güney Amerika'],
      correctIndex: 0,
      authorType: 'HUMAN',
    };
    await importRows([original]);
    const report = await importRows([
      { ...original, externalId: 'typo', question: 'Nil Nehri hangi kıtadaa yer alır?' },
    ]);
    expect(report.created).toEqual({ REJECTED: 1 });
    const audit = await t.db
      .selectFrom('question_audits')
      .innerJoin('questions', 'questions.id', 'question_audits.question_id')
      .select(['question_audits.hard_reject_reasons as reasons'])
      .where('questions.external_id', '=', 'typo')
      .where('question_audits.pass', '=', 'ARBITER')
      .executeTakeFirstOrThrow();
    expect(audit.reasons).toContain('NEAR_DUPLICATE');
  });
});

describe('the automatic review decides the starting status', () => {
  const base: Row = {
    externalId: 'base',
    category: 'general',
    difficulty: 'MEDIUM',
    question: 'Satranç tahtasında toplam kaç kare bulunur?',
    options: ['32', '48', '64', '81'],
    correctIndex: 2,
    authorType: 'HUMAN',
  };

  it('puts questions with a judgement-call finding in REVIEW and unambiguous defects in REJECTED', async () => {
    const report = await importRows([
      base,
      {
        ...base,
        externalId: 'negated',
        question: 'Aşağıdakilerden hangisi bir Türk şehri değildir?',
        options: ['Paris', 'Bursa', 'Konya', 'Sivas'],
        correctIndex: 0,
      },
      {
        ...base,
        externalId: 'dup-options',
        question: 'Türkiye’nin başkenti olan şehir hangisidir?',
        options: ['Ankara', 'ankara', 'Konya', 'Sivas'],
        correctIndex: 0,
      },
      {
        ...base,
        externalId: 'leak',
        question: 'Türkiye’nin başkenti olan Ankara hangi ülkenin başkentidir?',
        options: ['Fransa', 'Türkiye', 'İspanya', 'İtalya'],
        correctIndex: 1,
      },
    ]);
    expect(await statusOf('base')).toBe('DRAFT');
    expect(await statusOf('negated')).toBe('REVIEW');
    expect(await statusOf('dup-options')).toBe('REJECTED');
    expect(await statusOf('leak')).toBe('REJECTED');
    expect(report.summary).toMatchObject({ total: 4, pass: 1, review: 1, reject: 2 });
    expect(report.summary.reasons).toMatchObject({
      NEGATIVE_STEM: 1,
      DUPLICATE_OPTIONS: 1,
      ANSWER_IN_QUESTION: 1,
    });
  });

  it('keeps source-required categories in REVIEW until a source is attached', async () => {
    const withoutSource = {
      ...base,
      externalId: 'hist-1',
      category: 'history',
      question: 'Malazgirt Savaşı hangi yıl yapılmıştır?',
      options: ['1071', '1176', '1243', '1453'],
      correctIndex: 0,
    };
    await importRows([
      withoutSource,
      {
        ...withoutSource,
        externalId: 'hist-2',
        question: 'Fransız Devrimi hangi yıl başlamıştır?',
        options: ['1776', '1789', '1804', '1815'],
        correctIndex: 1,
        sources: [{ url: 'https://tr.wikipedia.org/wiki/Frans%C4%B1z_Devrimi' }],
      },
    ]);
    expect(await statusOf('hist-1')).toBe('REVIEW');
    expect(await statusOf('hist-2')).toBe('DRAFT');
  });

  it('reports a skewed answer-position batch without rejecting anyone for it', async () => {
    const rows = cleanRows(80).map((row) => {
      const options = [...(row.options as string[])];
      const correct = options[row.correctIndex as number]!;
      options.splice(row.correctIndex as number, 1);
      options.unshift(correct);
      return { ...row, options, correctIndex: 0 };
    });
    const report = await importRows(rows, { dryRun: true });
    expect(report.batchFindings.map((finding) => finding.code)).toContain('CORRECT_POSITION_SKEW');
    expect(report.counts.CREATED).toBe(80);
  });
});

describe('updating existing questions', () => {
  it('reports a changed row by default and applies it only with the update switch, bumping the revision', async () => {
    const [row] = cleanRows(1);
    await importRows([row]);
    const edited = {
      ...row,
      explanation: 'Açıklama güncellendi ve biraz daha açıklayıcı hale getirildi.',
    };
    const report = await importRows([edited]);
    expect(report.counts).toMatchObject({ CHANGED: 1, UPDATED: 0 });
    expect(report.items[0]?.changed).toBe('content');

    const applied = await importRows([edited], { updateExisting: true });
    expect(applied.counts).toMatchObject({ UPDATED: 1 });
    const stored = await t.db
      .selectFrom('questions')
      .select(['explanation', 'revision'])
      .where('external_id', '=', row!.externalId)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ explanation: edited.explanation, revision: 2 });
    expect((await importRows([edited])).counts).toMatchObject({ UNCHANGED: 1 });
  });

  it('treats a sources-only change as metadata: no new revision', async () => {
    const [row] = cleanRows(1);
    await importRows([row]);
    const withSource = { ...row, sources: [{ url: 'https://tr.wikipedia.org/wiki/Hafta' }] };
    const report = await importRows([withSource], { updateExisting: true });
    expect(report.items[0]?.changed).toBe('metadata');
    const stored = await t.db
      .selectFrom('questions')
      .select('revision')
      .where('external_id', '=', row!.externalId)
      .executeTakeFirstOrThrow();
    expect(stored.revision).toBe(1);
    expect((await t.db.selectFrom('question_sources').selectAll().execute()).length).toBe(1);
  });
});

describe('writes happen in batches, one transaction each', () => {
  it('commits finished batches and stops cleanly when one fails, so a re-run continues', async () => {
    await sql`CREATE FUNCTION refuse_poison() RETURNS trigger AS $$
      BEGIN IF NEW.text LIKE '%ZEHİR%' THEN RAISE EXCEPTION 'poison'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`.execute(
      t.db,
    );
    await sql`CREATE TRIGGER refuse_poison BEFORE INSERT ON questions FOR EACH ROW EXECUTE FUNCTION refuse_poison()`.execute(
      t.db,
    );
    try {
      const rows = cleanRows(6).map((row, index) =>
        index === 2 ? { ...row, question: `${row.question.slice(0, -1)} ZEHİR?` } : row,
      );
      const failure = await importRows(rows, { batchSize: 2 }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ImportBatchError);
      expect(failure).toMatchObject({ batchStart: 2, committedBatches: 1 });
      expect(await countRows(t.db, 'questions')).toBe(2); // the first batch stays, the failed one left nothing
      expect(await countRows(t.db, 'question_audits')).toBe(4);
    } finally {
      await sql`DROP TRIGGER refuse_poison ON questions`.execute(t.db);
    }
    const resumed = await importRows(cleanRows(6), { batchSize: 2 });
    expect(resumed.counts).toMatchObject({ UNCHANGED: 2, CREATED: 4 });
  });
});
