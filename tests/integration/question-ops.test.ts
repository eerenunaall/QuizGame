import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import {
  appendAudit,
  exportForAudit,
  importAuditResults,
  listAudits,
  loadQuestion,
  parseResults,
  renderCsv,
  renderJsonl,
  resolveReport,
  reviewQueue,
  runMaintenance,
  submitReport,
  transitionQuestion,
  type Actor,
  type ReportReason,
} from '@quizparty/question-bank';
import { activate, importClean, importRows, logOf, statusCounts } from '../helpers/question-bank';
import { cleanRows, jsonl, NOW, withCategories } from '../helpers/questions';

/**
 * Acceptance AC (reports and moderation controls) and the operating side of acceptance Z: the
 * review queue, continuous maintenance and manual audit rounds. Real PostgreSQL throughout.
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

const editor: Actor = { accountId: randomUUID(), roles: ['EDITOR'] };
const moderator: Actor = { accountId: randomUUID(), roles: ['MODERATOR'] };
const support: Actor = { accountId: randomUUID(), roles: ['SUPPORT'] };

type Ten = [string, string, string, string, string, string, string, string, string, string];
type Seven = [string, string, string, string, string, string, string];

const report = (questionId: string, reporter: number, reason: ReportReason, note?: string) =>
  submitReport(t.db, {
    questionId,
    reporterHash: `reporter-${reporter}`,
    reason,
    ...(note ? { note } : {}),
  });

const statusOf = async (id: string): Promise<string> =>
  (
    await t.db
      .selectFrom('questions')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  ).status;

describe('player reports', () => {
  it('keeps one report per reporter: a repeat replaces the reason and never counts twice', async () => {
    const [id] = await activate(t.db, 1);
    expect(await report(id!, 1, 'TYPO', 'Noktalama hatası var.')).toEqual({
      created: true,
      openReporters: 1,
      demoted: false,
    });
    for (const reason of ['UNCLEAR', 'WRONG_ANSWER', 'OFFENSIVE', 'OTHER'] as const)
      expect(await report(id!, 1, reason)).toEqual({
        created: false,
        openReporters: 1,
        demoted: false,
      });
    const rows = await t.db.selectFrom('question_reports').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: 'OTHER',
      note: null,
      question_revision: 1,
      status: 'OPEN',
    });
    const stored = await t.db
      .selectFrom('questions')
      .select('report_count')
      .where('id', '=', id!)
      .executeTakeFirstOrThrow();
    expect(Number(stored.report_count)).toBe(1);
    expect(await statusOf(id!)).toBe('ACTIVE');
  });

  it('pulls an ACTIVE question back to REVIEW when independent reporters agree, sooner for serious reasons', async () => {
    const [typo, wrong] = await activate(t.db, 2);
    expect(await report(typo!, 1, 'TYPO')).toMatchObject({ demoted: false });
    expect(await report(typo!, 2, 'UNCLEAR')).toMatchObject({ demoted: false, openReporters: 2 });
    expect(await report(typo!, 3, 'TYPO')).toMatchObject({ demoted: true, openReporters: 3 });
    expect(await statusOf(typo!)).toBe('REVIEW');
    expect((await logOf(t.db, typo!)).at(-1)).toMatchObject({
      from_status: 'ACTIVE',
      to_status: 'REVIEW',
      reason: 'REPORT_THRESHOLD',
      actor_account_id: null,
      detail: { openReporters: 3, serious: 0 },
    });

    expect(await report(wrong!, 1, 'WRONG_ANSWER')).toMatchObject({ demoted: false });
    expect(await report(wrong!, 2, 'MULTIPLE_CORRECT')).toMatchObject({ demoted: true });
    expect(await statusOf(wrong!)).toBe('REVIEW');
    // Reports stay open for a moderator; the question is simply out of play meanwhile.
    expect(
      Number(
        (
          await t.db
            .selectFrom('question_reports')
            .select((eb) => eb.fn.countAll<number>().as('n'))
            .where('status', '=', 'OPEN')
            .executeTakeFirstOrThrow()
        ).n,
      ),
    ).toBe(5);
  });

  it('records reports about development content but never pulls it out of play', async () => {
    const [id] = await activate(t.db, 1);
    await t.db
      .updateTable('questions')
      .set({ author_type: 'DEV_SEED', is_dev_seed: true })
      .where('id', '=', id!)
      .execute();
    for (let reporter = 1; reporter <= 4; reporter++)
      expect(await report(id!, reporter, 'WRONG_ANSWER')).toMatchObject({ demoted: false });
    expect(await statusOf(id!)).toBe('ACTIVE');
  });

  it('drops a note that carries a link but keeps the report, and refuses an unknown question', async () => {
    const [id] = await activate(t.db, 1);
    await report(id!, 1, 'OTHER', 'Şuraya bakın https://kotu.example/yonlendirme');
    await report(id!, 2, 'TYPO', 'Soru işareti eksik.');
    const notes = await t.db
      .selectFrom('question_reports')
      .select(['reporter_hash', 'note'])
      .orderBy('reporter_hash')
      .execute();
    expect(notes).toEqual([
      { reporter_hash: 'reporter-1', note: null },
      { reporter_hash: 'reporter-2', note: 'Soru işareti eksik.' },
    ]);
    await expect(report(randomUUID(), 1, 'TYPO')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('moderating reports', () => {
  async function reported(
    count: number,
    reasons: ReportReason[],
  ): Promise<{ id: string; reports: string[] }> {
    const [id] = await activate(t.db, 1);
    for (let index = 0; index < count; index++)
      await report(id!, index + 1, reasons[index] ?? 'TYPO');
    const rows = await t.db
      .selectFrom('question_reports')
      .select('id')
      .where('question_id', '=', id!)
      .orderBy('reporter_hash')
      .execute();
    return { id: id!, reports: rows.map((row) => row.id) };
  }

  it('dismisses or marks one report as fixed without touching the question', async () => {
    const { id, reports } = await reported(2, ['TYPO', 'UNCLEAR']);
    expect(
      await resolveReport(t.db, reports[0]!, {
        actor: moderator,
        action: 'DISMISS',
        note: 'Sorun yok.',
      }),
    ).toEqual({
      resolved: 1,
      questionStatus: 'ACTIVE',
    });
    expect(
      await resolveReport(t.db, reports[1]!, { actor: moderator, action: 'MARK_FIXED' }),
    ).toMatchObject({ resolved: 1 });
    const rows = await t.db
      .selectFrom('question_reports')
      .select(['id', 'status', 'resolved_by', 'resolution'])
      .where('question_id', '=', id)
      .execute();
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(reports[0]!)).toMatchObject({
      status: 'DISMISSED',
      resolved_by: moderator.accountId,
      resolution: 'Sorun yok.',
    });
    expect(byId.get(reports[1]!)).toMatchObject({
      status: 'ACTIONED',
      resolved_by: moderator.accountId,
      resolution: null,
    });
    expect(await statusOf(id)).toBe('ACTIVE');
  });

  it('sends a question to review or retires it, and closes every open report about it', async () => {
    const first = await reported(2, ['TYPO', 'UNCLEAR']);
    expect(
      await resolveReport(t.db, first.reports[0]!, { actor: moderator, action: 'SEND_TO_REVIEW' }),
    ).toEqual({
      resolved: 2,
      questionStatus: 'REVIEW',
    });
    expect((await logOf(t.db, first.id)).at(-1)).toMatchObject({
      to_status: 'REVIEW',
      reason: 'REPORT_SEND_TO_REVIEW',
      actor_account_id: moderator.accountId,
    });

    await sql`TRUNCATE questions CASCADE`.execute(t.db);
    const second = await reported(3, ['WRONG_ANSWER', 'TYPO', 'TYPO']);
    // Two of the three are serious or not: whatever the threshold did, the moderator retires it.
    const open = await t.db
      .selectFrom('question_reports')
      .select('id')
      .where('question_id', '=', second.id)
      .where('status', '=', 'OPEN')
      .execute();
    expect(
      await resolveReport(t.db, open[0]!.id, {
        actor: moderator,
        action: 'RETIRE',
        note: 'Cevap yanlış.',
      }),
    ).toMatchObject({
      resolved: open.length,
      questionStatus: 'RETIRED',
    });
    const stored = await t.db
      .selectFrom('questions')
      .select(['retire_reason'])
      .where('id', '=', second.id)
      .executeTakeFirstOrThrow();
    expect(stored.retire_reason).toBe('Cevap yanlış.');
    expect(
      await t.db
        .selectFrom('question_reports')
        .select('id')
        .where('question_id', '=', second.id)
        .where('status', '=', 'OPEN')
        .execute(),
    ).toEqual([]);
  });

  it('is for moderators, editors and admins, and for open reports only', async () => {
    const { reports } = await reported(1, ['TYPO']);
    await expect(
      resolveReport(t.db, reports[0]!, { actor: support, action: 'DISMISS' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      resolveReport(t.db, reports[0]!, {
        actor: { accountId: null, roles: [] },
        action: 'DISMISS',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await resolveReport(t.db, reports[0]!, { actor: editor, action: 'DISMISS' });
    await expect(
      resolveReport(t.db, reports[0]!, { actor: moderator, action: 'RETIRE' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(
      resolveReport(t.db, randomUUID(), { actor: moderator, action: 'DISMISS' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the review queue', () => {
  /** Ten questions in REVIEW, one for every tier of docs/QUESTION_QUALITY.md §10, plus a plain one. */
  async function tiered(): Promise<string[]> {
    const ids = await importClean(t.db, 10);
    for (const id of ids)
      await transitionQuestion(t.db, id, 'REVIEW', { actor: editor, reason: 'TEST' });
    const [disputes, reported, current, duplicate, anomaly, slop, source, category, , worse] =
      ids as Ten;
    await report(disputes, 1, 'WRONG_ANSWER');
    await report(disputes, 2, 'WRONG_ANSWER');
    await report(worse, 1, 'WRONG_ANSWER');
    await report(worse, 2, 'MULTIPLE_CORRECT');
    await report(worse, 3, 'TYPO');
    await report(reported, 1, 'TYPO');
    await t.db
      .updateTable('questions')
      .set({ pool: 'CURRENT', expires_at: new Date('2027-01-01T00:00:00Z') })
      .where('id', '=', current)
      .execute();
    await t.db
      .updateTable('questions')
      .set({ answer_count: 100, correct_answer_count: 3 })
      .where('id', '=', anomaly)
      .execute();
    const verdict = (
      id: string,
      revision: number,
      extra: { reasonCodes?: string[]; scores?: Record<string, number> },
    ) =>
      appendAudit(
        t.db,
        id,
        revision,
        {
          pass: 'ARBITER',
          provider: 'arbiter@1',
          status: 'REVIEW',
          dimensions: {},
          scores: extra.scores ?? {},
          reasonCodes: extra.reasonCodes ?? [],
          hardRejectReasons: [],
          reviewReasons: [],
          suggestedRewrite: null,
        },
        null,
      );
    await verdict(duplicate, 1, { reasonCodes: ['NEAR_DUPLICATE'] });
    await verdict(slop, 1, { scores: { aiSlopRisk: 2 } });
    await verdict(source, 1, { reasonCodes: ['SOURCE_REQUIRED_MISSING'] });
    await verdict(category, 1, { reasonCodes: ['CATEGORY_MISMATCH_SUSPECT'] });
    return ids;
  }

  it('lists what needs a person, most urgent first: disputes, reports, current events, duplicates, statistics, slop, sources, category', async () => {
    const ids = await tiered();
    const [disputes, reported, current, duplicate, anomaly, slop, source, category, plain, worse] =
      ids as Ten;
    const page = await reviewQueue(t.db);
    expect(page.total).toBe(10);
    expect(page.entries.map((entry) => entry.id)).toEqual([
      worse,
      disputes,
      reported,
      current,
      duplicate,
      anomaly,
      slop,
      source,
      category,
      plain,
    ]);
    expect(page.entries.map((entry) => entry.priority)).toEqual([1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(page.entries[0]).toMatchObject({
      openReports: 3,
      disputes: 2,
      status: 'REVIEW',
      revision: 1,
    });
    expect(page.entries.find((entry) => entry.id === duplicate)?.reasons).toContain(
      'NEAR_DUPLICATE',
    );
  });

  it('pages, filters by category, status and reason, and clamps absurd limits', async () => {
    const ids = await tiered();
    const second = await reviewQueue(t.db, { limit: 3, offset: 3 });
    expect(second.total).toBe(10);
    expect(second.entries).toHaveLength(3);
    expect(second.entries.map((entry) => entry.priority)).toEqual([3, 4, 5]);

    const byReason = await reviewQueue(t.db, { reason: 'NEAR_DUPLICATE' });
    expect(byReason.entries.map((entry) => entry.id)).toEqual([ids[3]]);
    const category = (await loadQuestion(t.db, ids[8]!))!.question.category;
    const byCategory = await reviewQueue(t.db, { category });
    expect(byCategory.entries.every((entry) => entry.category === category)).toBe(true);
    expect((await reviewQueue(t.db, { statuses: ['DRAFT', 'ACTIVE'] })).total).toBe(0);
    expect((await reviewQueue(t.db, { limit: 0 })).entries).toHaveLength(1);
    expect((await reviewQueue(t.db, { limit: 100_000 })).entries).toHaveLength(10);
    expect((await reviewQueue(t.db, { offset: -5 })).entries[0]?.priority).toBe(1);
  });

  it('puts a question back in the queue the moment it is reported, even from ACTIVE', async () => {
    const [id] = await activate(t.db, 1);
    expect((await reviewQueue(t.db)).total).toBe(0);
    await report(id!, 1, 'WRONG_ANSWER');
    await report(id!, 2, 'WRONG_ANSWER');
    const page = await reviewQueue(t.db);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({ id, priority: 1, status: 'REVIEW' });
  });
});

describe('continuous maintenance', () => {
  async function setup() {
    const ids = await activate(t.db, 7);
    const [expired, stale, low, trivial, dominant, healthy, devSeed] = ids as Seven;
    const set = (id: string, values: Record<string, unknown>) =>
      t.db.updateTable('questions').set(values).where('id', '=', id).execute();
    await set(expired, { expires_at: new Date('2026-09-01T00:00:00Z') });
    await set(stale, { last_verified_at: new Date('2025-01-01T00:00:00Z') });
    await set(low, { answer_count: 100, correct_answer_count: 3 });
    await set(trivial, { answer_count: 100, correct_answer_count: 100 });
    await set(dominant, { answer_count: 100, correct_answer_count: 30 });
    const wrong = await t.db
      .selectFrom('question_options')
      .select('id')
      .where('question_id', '=', dominant)
      .where('is_correct', '=', false)
      .limit(1)
      .executeTakeFirstOrThrow();
    await t.db
      .updateTable('question_options')
      .set({ pick_count: 65 })
      .where('id', '=', wrong.id)
      .execute();
    await set(healthy, { answer_count: 100, correct_answer_count: 60 });
    await set(devSeed, {
      author_type: 'DEV_SEED',
      is_dev_seed: true,
      expires_at: new Date('2026-09-01T00:00:00Z'),
    });
    return { expired, stale, low, trivial, dominant, healthy, devSeed };
  }

  it('moves expired, overdue and statistically suspicious questions to REVIEW, and leaves the rest alone', async () => {
    const q = await setup();
    expect(await runMaintenance(t.db, { now: NOW })).toEqual({
      expired: 1,
      reverify: 1,
      telemetry: 3,
      ran: true,
    });
    for (const id of [q.expired, q.stale, q.low, q.trivial, q.dominant])
      expect(await statusOf(id)).toBe('REVIEW');
    expect(await statusOf(q.healthy)).toBe('ACTIVE');
    expect(await statusOf(q.devSeed)).toBe('ACTIVE');

    const reasons = async (id: string) => (await logOf(t.db, id)).at(-1);
    expect(await reasons(q.expired)).toMatchObject({ reason: 'EXPIRED', actor_account_id: null });
    expect(await reasons(q.stale)).toMatchObject({ reason: 'REVERIFY_DUE', detail: { days: 540 } });
    expect(await reasons(q.low)).toMatchObject({
      reason: 'TELEMETRY_ANOMALY',
      detail: { verdict: 'LOW_CORRECT_RATE' },
    });
    expect(await reasons(q.trivial)).toMatchObject({ detail: { verdict: 'HIGH_CORRECT_RATE' } });
    expect(await reasons(q.dominant)).toMatchObject({
      detail: { verdict: 'DOMINANT_WRONG_OPTION' },
    });

    // Nothing is left to move: a second pass is a no-op, not a second log entry.
    expect(await runMaintenance(t.db, { now: NOW })).toEqual({
      expired: 0,
      reverify: 0,
      telemetry: 0,
      ran: true,
    });
    expect(await statusCounts(t.db)).toEqual({ REVIEW: 5, ACTIVE: 2 });
  });

  it('lets one instance work at a time', async () => {
    await setup();
    const blocked = await t.db.connection().execute(async (connection) => {
      await sql`SELECT pg_advisory_lock(7340221)`.execute(connection);
      try {
        return await runMaintenance(t.db, { now: NOW });
      } finally {
        await sql`SELECT pg_advisory_unlock(7340221)`.execute(connection);
      }
    });
    expect(blocked).toEqual({ expired: 0, reverify: 0, telemetry: 0, ran: false });
    expect(await statusCounts(t.db)).toEqual({ ACTIVE: 7 });
    expect(await runMaintenance(t.db, { now: NOW })).toMatchObject({ ran: true, expired: 1 });
  });

  it('does not judge a question on too few answers', async () => {
    const [id] = await activate(t.db, 1);
    await t.db
      .updateTable('questions')
      .set({ answer_count: 20, correct_answer_count: 0 })
      .where('id', '=', id!)
      .execute();
    expect(await runMaintenance(t.db, { now: NOW })).toMatchObject({ telemetry: 0 });
    expect(await runMaintenance(t.db, { now: NOW, config: { minAnswers: 10 } })).toMatchObject({
      telemetry: 1,
    });
  });
});

describe('a manual audit round', () => {
  it('exports questions with everything an auditor needs and renders JSONL and a spreadsheet-safe CSV', async () => {
    const ids = await importClean(t.db, 3);
    const [first] = ids;
    await t.db
      .updateTable('questions')
      .set({ text: '=ÇOK(1+1) sonucu kaçtır?' })
      .where('id', '=', first!)
      .execute();
    const rows = await exportForAudit(t.db, { statuses: ['DRAFT'] });
    expect(rows).toHaveLength(3);
    const exported = rows.find((row) => row.questionId === first)!;
    expect(exported).toMatchObject({
      revision: 2,
      status: 'DRAFT',
      language: 'tr',
      question: '=ÇOK(1+1) sonucu kaçtır?',
    });
    expect(exported.options).toHaveLength(4);
    expect(exported.correctIndex).toBeGreaterThanOrEqual(0);

    const lines = renderJsonl(rows).trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual(
      JSON.parse(JSON.stringify(rows)),
    );
    const csv = renderCsv(rows);
    expect(csv.split('\r\n')[0]).toBe(
      'questionId,category,difficulty,question,optionA,optionB,optionC,optionD,optionE,optionF,correct,explanation,sourceUrl,status',
    );
    expect(csv).toContain("'=ÇOK(1+1) sonucu kaçtır?");
    expect(csv).not.toMatch(/(^|,)=ÇOK/mu);
  });

  it('applies the returned results as a model pass: good ones approve, doubtful ones wait for a person, bad ones are rejected', async () => {
    const rows = cleanRows(4);
    const [approve, doubt, reject, byId] = await importRows(t.db, rows);
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
    const lines = [
      { questionId: rows[0]!.externalId, status: 'PASS', scores },
      {
        questionId: doubt,
        status: 'REVIEW',
        scores: { ...scores, answerFairness: 3 },
        reviewReasons: ['a second option may be defensible'],
      },
      {
        questionId: reject,
        status: 'REJECT',
        scores: { ...scores, factAccuracy: 1 },
        hardRejectReasons: ['INCORRECT_ANSWER'],
      },
      { questionId: byId, revision: 1, status: 'PASS', scores },
    ];
    const result = await importAuditResults(t.db, parseResults(jsonl(lines)), {
      now: NOW,
      source: 'chat-round-1',
    });
    expect(result).toMatchObject({ total: 4, applied: 4, skipped: [] });
    expect(result.summary).toMatchObject({ total: 4, pass: 2, review: 1, reject: 1 });
    expect(await statusOf(approve!)).toBe('APPROVED');
    expect(await statusOf(byId!)).toBe('APPROVED');
    expect(await statusOf(doubt!)).toBe('REVIEW');
    expect(await statusOf(reject!)).toBe('REJECTED');
    const stored = (await listAudits(t.db, approve!, 1)).find(
      (entry) => entry.result.provider === 'external:chat-round-1',
    )!;
    expect(stored.result).toMatchObject({
      pass: 'FACT_CHECK',
      status: 'PASS',
      dimensions: { factCheck: 'PASS' },
    });
    // An imported verdict is a model's, never an editor's approval: nothing is ACTIVE or human-approved.
    expect(await statusCounts(t.db)).toEqual({ APPROVED: 2, REVIEW: 1, REJECTED: 1 });
    expect(
      (await listAudits(t.db, approve!, 1)).some((entry) => entry.result.pass === 'MANUAL'),
    ).toBe(false);
  });

  it('skips what it cannot trust and says why: bad lines, unknown questions, human passes, another revision', async () => {
    const [id] = await importClean(t.db, 1);
    const scores = {
      factAccuracy: 5,
      clarity: 5,
      distractorQuality: 5,
      languageQuality: 5,
      answerFairness: 5,
      gameplayValue: 4,
      aiSlopRisk: 5,
    };
    const text = [
      'this is not json',
      JSON.stringify({ questionId: randomUUID(), status: 'PASS', scores }),
      JSON.stringify({ questionId: 'no-such-external-id', status: 'PASS', scores }),
      JSON.stringify({ questionId: id, status: 'PASS', scores, pass: 'MANUAL' }),
      JSON.stringify({ questionId: id, status: 'PASS', scores, pass: 'ARBITER' }),
      JSON.stringify({ questionId: id, revision: 4, status: 'PASS', scores }),
      JSON.stringify({ questionId: id, status: 'MAYBE', scores }),
      JSON.stringify({ questionId: id, status: 'PASS', scores, approvedBy: 'me' }),
    ].join('\n');
    const result = await importAuditResults(t.db, parseResults(text), { now: NOW, source: 'x' });
    expect(result.applied).toBe(0);
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      expect.stringContaining('invalid_json'),
      'question_not_found',
      'question_not_found',
      'pass_not_importable',
      'pass_not_importable',
      'revision_changed',
      expect.stringContaining('invalid_row'),
      expect.stringContaining('invalid_row'),
    ]);
    expect(await statusOf(id!)).toBe('DRAFT');
    expect(
      (await listAudits(t.db, id!)).some((entry) => entry.result.provider.startsWith('external:')),
    ).toBe(false);
  });
});
