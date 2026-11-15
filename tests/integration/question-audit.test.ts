import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import {
  LifecycleError,
  SYSTEM_ACTOR,
  appendAudit,
  approveQuestion,
  editQuestion,
  importQuestions,
  listAudits,
  loadQuestion,
  parseImportText,
  rejectQuestion,
  runAudit,
  selectQuestionIds,
  transitionQuestion,
  type Actor,
} from '@quizparty/question-bank';
import { panel, PASSES } from '../helpers/audit';
import { auditCount, importClean, importRows, logOf, statusCounts } from '../helpers/question-bank';
import { cleanRows, jsonl, NOW, withCategories, type Row } from '../helpers/questions';

/**
 * Acceptance Z: the audit queue works (ADR-0014, docs/QUESTION_QUALITY.md §8-§10). Real PostgreSQL,
 * the real arbiter and lifecycle guards. The only doubles are the audit providers: they stand in
 * for the remote model service and answer in the same structured shape (the wire contract of the
 * real client is tested against a local HTTP server in the question-bank unit tests).
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
const context = { now: NOW };

const negated: Row = {
  externalId: 'negated',
  category: 'general',
  difficulty: 'MEDIUM',
  question: 'Aşağıdakilerden hangisi bir Türk şehri değildir?',
  options: ['Paris', 'Bursa', 'Konya', 'Sivas'],
  correctIndex: 0,
  authorType: 'HUMAN',
};

describe('the audit runner', () => {
  it('approves clean questions when every pass agrees and activates only when the operator asks', async () => {
    const ids = await importClean(t.db, 5);
    const providers = panel();
    const report = await runAudit(t.db, ids, { now: NOW, providers, concurrency: 1 });
    expect(report).toMatchObject({
      total: 5,
      processed: 5,
      errors: [],
      budgetExhausted: false,
      dryRun: false,
      statusChanges: { 'DRAFT→APPROVED': 5 },
      tokens: { input: 5 * 5 * 100, output: 5 * 5 * 50 },
    });
    expect(report.summary).toMatchObject({ total: 5, pass: 5, review: 0, reject: 0 });
    for (const provider of providers) expect(provider.calls).toHaveLength(5);
    expect(await statusCounts(t.db)).toEqual({ APPROVED: 5 });

    const id = ids[0]!;
    const passes = (await listAudits(t.db, id, 1)).map((entry) => entry.result.pass);
    expect(new Set(passes)).toEqual(new Set([...PASSES, 'HEURISTIC', 'ARBITER']));
    const log = await logOf(t.db, id);
    expect(log.map((entry) => `${entry.from_status}→${entry.to_status}:${entry.reason}`)).toEqual([
      'null→DRAFT:IMPORT',
      'DRAFT→APPROVED:AUDIT_VERDICT',
    ]);
    expect(log[1]?.actor_account_id).toBeNull();
    // A model's say-so never reaches ACTIVE by itself.
    expect(await statusCounts(t.db)).not.toHaveProperty('ACTIVE');

    const stored = await t.db
      .selectFrom('questions')
      .select(['verification_status', 'last_verified_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(stored.verification_status).toBe('VERIFIED');
  });

  it('activates in the same run when the operator enabled auto-activation (arbiter PASS still required)', async () => {
    const ids = await importClean(t.db, 3);
    const report = await runAudit(t.db, ids, {
      now: NOW,
      providers: panel(),
      autoActivate: true,
    });
    expect(report.statusChanges).toEqual({ 'DRAFT→ACTIVE': 3 });
    expect(await statusCounts(t.db)).toEqual({ ACTIVE: 3 });
    expect((await logOf(t.db, ids[0]!)).map((entry) => entry.reason)).toEqual([
      'IMPORT',
      'AUDIT_VERDICT',
      'AUTO_ACTIVATE',
    ]);
  });

  it('is resumable and quiet: stored passes are never repeated and an unchanged verdict writes nothing', async () => {
    const ids = await importClean(t.db, 3);
    const first = panel();
    await runAudit(t.db, ids, { now: NOW, providers: first });
    const written = await auditCount(t.db);
    const second = panel();
    const again = await runAudit(t.db, ids, { now: NOW, providers: second });
    for (const provider of second) expect(provider.calls).toHaveLength(0);
    expect(again.tokens).toEqual({ input: 0, output: 0 });
    expect(again.statusChanges).toEqual({});
    expect(await auditCount(t.db)).toBe(written);
    expect(await statusCounts(t.db)).toEqual({ APPROVED: 3 });
  });

  it('stops spending at the token budget and a later run finishes the job', async () => {
    const ids = await importClean(t.db, 4);
    const providers = panel();
    const limited = await runAudit(t.db, ids, {
      now: NOW,
      providers,
      concurrency: 1,
      tokenBudget: 1000,
    });
    expect(limited.budgetExhausted).toBe(true);
    // 150 tokens a call: the budget is reached during the second question, so the rest never start.
    expect(providers.reduce((sum, provider) => sum + provider.calls.length, 0)).toBe(7);
    expect(limited.statusChanges).toEqual({ 'DRAFT→APPROVED': 1 });
    expect(await statusCounts(t.db)).toEqual({ APPROVED: 1, DRAFT: 3 });

    const rest = await runAudit(t.db, ids, { now: NOW, providers: panel(), concurrency: 1 });
    expect(rest.budgetExhausted).toBe(false);
    expect(await statusCounts(t.db)).toEqual({ APPROVED: 4 });
  });

  it('a dry run reports what would happen and writes nothing', async () => {
    const ids = await importClean(t.db, 2);
    // One question has a stored hard-reject pass: the arbiter would reject it.
    const doomed = ids[0]!;
    const stored = (await loadQuestion(t.db, doomed))!;
    await appendAudit(
      t.db,
      doomed,
      stored.revision,
      {
        pass: 'FACT_CHECK',
        provider: 'earlier-round',
        status: 'REJECT',
        dimensions: { factCheck: 'FAIL' },
        scores: {},
        reasonCodes: [],
        hardRejectReasons: ['INCORRECT_ANSWER'],
        reviewReasons: [],
        suggestedRewrite: null,
      },
      null,
    );
    const auditsBefore = await auditCount(t.db);
    const providers = panel();
    const report = await runAudit(t.db, ids, { now: NOW, providers, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.statusChanges).toEqual({ 'DRAFT→REJECTED': 1 });
    expect(report.items.find((item) => item.id === doomed)).toMatchObject({
      to: 'REJECTED',
      verdict: 'REJECT',
    });
    for (const provider of providers) expect(provider.calls).toHaveLength(0);
    expect(await auditCount(t.db)).toBe(auditsBefore);
    expect(await statusCounts(t.db)).toEqual({ DRAFT: 2 });
    expect(await logOf(t.db, doomed)).toHaveLength(1);
  });

  it('rejects on a hard-reject reason, asks a person on a REVIEW verdict, and says why', async () => {
    const ids = await importClean(t.db, 3);
    const [rejectedId, reviewId, goodId] = ids as [string, string, string];
    const providers = panel({
      FACT_CHECK: (input) =>
        input.question.id === rejectedId
          ? {
              status: 'REJECT',
              dimensions: { factCheck: 'FAIL' },
              hardRejectReasons: ['INCORRECT_ANSWER'],
            }
          : {},
      AMBIGUITY: (input) =>
        input.question.id === reviewId
          ? {
              status: 'REVIEW',
              dimensions: { ambiguity: 'REVIEW' },
              reviewReasons: ['a second option could be defended'],
            }
          : {},
    });
    const report = await runAudit(t.db, ids, { now: NOW, providers });
    expect(report.summary).toMatchObject({ total: 3, pass: 1, review: 1, reject: 1 });
    const by = (id: string) => report.items.find((item) => item.id === id)!;
    expect(by(rejectedId)).toMatchObject({ to: 'REJECTED', verdict: 'REJECT' });
    expect(by(reviewId)).toMatchObject({ to: 'REVIEW', verdict: 'REVIEW' });
    expect(by(reviewId).blockers).toContain('a second option could be defended');
    expect(by(goodId)).toMatchObject({ to: 'APPROVED', verdict: 'PASS' });
    expect(await statusCounts(t.db)).toEqual({ REJECTED: 1, REVIEW: 1, APPROVED: 1 });
  });

  it('stops paying for a question once a pass has rejected it', async () => {
    const ids = await importClean(t.db, 2);
    const doomed = ids[0]!;
    const providers = panel({
      FACT_CHECK: (input) =>
        input.question.id === doomed
          ? {
              status: 'REJECT',
              dimensions: { factCheck: 'FAIL' },
              hardRejectReasons: ['FABRICATED_FACT'],
            }
          : {},
    });
    const report = await runAudit(t.db, ids, { now: NOW, providers, concurrency: 1 });
    // The rejected question cost one call; the other one went through all five passes.
    expect(providers.map((provider) => provider.calls.length)).toEqual([2, 1, 1, 1, 1]);
    expect(report.items.find((item) => item.id === doomed)).toMatchObject({
      to: 'REJECTED',
      newPasses: ['FACT_CHECK:test-panel'],
    });
    expect(await statusCounts(t.db)).toEqual({ REJECTED: 1, APPROVED: 1 });
  });

  it('reports a failing provider and carries on with the rest', async () => {
    const ids = await importClean(t.db, 3);
    const broken = ids[1]!;
    const providers = panel({
      FACT_CHECK: (input) => {
        if (input.question.id === broken) throw new Error('model API answered 503');
        return {};
      },
    });
    const report = await runAudit(t.db, ids, { now: NOW, providers, concurrency: 1 });
    expect(report.errors).toEqual([{ id: broken, message: 'model API answered 503' }]);
    expect(report.processed).toBe(3);
    expect(await statusCounts(t.db)).toEqual({ APPROVED: 2, DRAFT: 1 });
  });

  it('drops a pass that was computed for a revision the editor has since replaced', async () => {
    const [id] = await importClean(t.db, 1);
    const providers = panel({
      FACT_CHECK: (input) => {
        // While the model is thinking, an editor rewrites the question.
        return editQuestion(
          t.db,
          input.question.id,
          { explanation: 'Bir hafta pazartesiden pazara kadar sayılan yedi günden oluşur.' },
          { actor: editor, expectedRevision: 1 },
          context,
        ).then(() => ({}));
      },
    });
    const report = await runAudit(t.db, [id!], { now: NOW, providers, concurrency: 1 });
    expect(report.errors).toEqual([]);
    // The model was asked once; the other passes were not bought for wording that no longer exists.
    expect(providers.map((provider) => provider.calls.length)).toEqual([1, 0, 0, 0, 0]);
    expect((await loadQuestion(t.db, id!))!.revision).toBe(2);
    const old = await listAudits(t.db, id!, 1);
    const current = await listAudits(t.db, id!, 2);
    expect(old.some((entry) => entry.result.pass === 'FACT_CHECK')).toBe(false);
    expect(current.some((entry) => entry.result.pass === 'FACT_CHECK')).toBe(false);
    expect(await statusCounts(t.db)).toEqual({ DRAFT: 1 });
  });

  it('judges development content but never moves it', async () => {
    const [id] = await importClean(t.db, 1);
    await t.db
      .updateTable('questions')
      .set({ author_type: 'DEV_SEED', is_dev_seed: true, status: 'ACTIVE' })
      .where('id', '=', id!)
      .execute();
    const providers = panel({
      FACT_CHECK: () => ({
        status: 'REVIEW',
        dimensions: { factCheck: 'REVIEW' },
        reviewReasons: ['doubt'],
      }),
    });
    const report = await runAudit(t.db, [id!], { now: NOW, providers });
    expect(report.items[0]).toMatchObject({ from: 'ACTIVE', to: 'ACTIVE', verdict: 'REVIEW' });
    expect(await statusCounts(t.db)).toEqual({ ACTIVE: 1 });
  });

  it('selects what to audit by status, category, audit state and limit', async () => {
    const ids = await importClean(t.db, 6);
    await runAudit(t.db, ids.slice(0, 2), { now: NOW, providers: panel() });
    expect(await selectQuestionIds(t.db, { unaudited: true })).toHaveLength(4);
    expect(await selectQuestionIds(t.db, { statuses: ['APPROVED'] })).toHaveLength(2);
    expect(await selectQuestionIds(t.db, { statuses: ['DRAFT'], limit: 3 })).toHaveLength(3);
    expect(await selectQuestionIds(t.db, { category: 'does-not-exist' })).toEqual([]);
    expect(await selectQuestionIds(t.db, { ids: [ids[0]!] })).toEqual([ids[0]]);
  });
});

describe('moving questions through the lifecycle', () => {
  it('refuses APPROVED without a passing audit of the current revision, the database agrees', async () => {
    const [id] = await importClean(t.db, 1);
    await expect(
      transitionQuestion(t.db, id!, 'APPROVED', { actor: editor, reason: 'MANUAL' }),
    ).rejects.toMatchObject({ code: 'AUDIT_REQUIRED' });
    expect(await statusCounts(t.db)).toEqual({ DRAFT: 1 });
  });

  it('lets moderators pull a question out of play but not publish one', async () => {
    const ids = await importClean(t.db, 2);
    await runAudit(t.db, ids, { now: NOW, providers: panel(), autoActivate: true });
    const [first, second] = ids as [string, string];
    await expect(
      transitionQuestion(t.db, first, 'REVIEW', { actor: moderator, reason: 'REPORT' }),
    ).resolves.toEqual({ from: 'ACTIVE', to: 'REVIEW' });
    await expect(
      transitionQuestion(t.db, first, 'APPROVED', { actor: moderator, reason: 'NO' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      transitionQuestion(t.db, second, 'RETIRED', {
        actor: moderator,
        reason: 'WRONG',
        note: 'yanlış cevap',
      }),
    ).resolves.toEqual({ from: 'ACTIVE', to: 'RETIRED' });
    const retired = await t.db
      .selectFrom('questions')
      .select(['retired_at', 'retire_reason'])
      .where('id', '=', second)
      .executeTakeFirstOrThrow();
    expect(retired.retire_reason).toBe('yanlış cevap');
    expect(retired.retired_at).toBeInstanceOf(Date);
    await expect(
      transitionQuestion(t.db, second, 'REVIEW', { actor: support, reason: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects impossible moves and records who did what and why', async () => {
    const [id] = await importClean(t.db, 1);
    await runAudit(t.db, [id!], { now: NOW, providers: panel(), autoActivate: true });
    await expect(
      transitionQuestion(t.db, id!, 'DRAFT', { actor: editor, reason: 'NO' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await transitionQuestion(t.db, id!, 'RETIRED', {
      actor: editor,
      reason: 'REPORT_RETIRE',
      detail: { report: 'r-1' },
    });
    await expect(
      transitionQuestion(t.db, id!, 'ACTIVE', { actor: editor, reason: 'NO' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await transitionQuestion(t.db, id!, 'REVIEW', { actor: editor, reason: 'REOPEN' });
    const log = await logOf(t.db, id!);
    expect(log.at(-2)).toMatchObject({
      from_status: 'ACTIVE',
      to_status: 'RETIRED',
      actor_account_id: editor.accountId,
      reason: 'REPORT_RETIRE',
      detail: { report: 'r-1' },
    });
    expect(log.at(-1)).toMatchObject({
      from_status: 'RETIRED',
      to_status: 'REVIEW',
      reason: 'REOPEN',
    });
    await expect(
      transitionQuestion(t.db, randomUUID(), 'REVIEW', { actor: editor, reason: 'X' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('an editor decides what the pipeline could not', () => {
  it('makes the editor name each finding they accept, then approves and records the waiver', async () => {
    const [id] = await importRows(t.db, [negated]);
    expect((await loadQuestion(t.db, id!))!.status).toBe('REVIEW');
    await expect(
      approveQuestion(t.db, id!, { actor: editor, waive: [] }, context),
    ).rejects.toMatchObject({
      code: 'BLOCKED',
      detail: { codes: ['NEGATIVE_STEM'], waivable: true },
    });

    const outcome = await approveQuestion(
      t.db,
      id!,
      { actor: editor, waive: ['NEGATIVE_STEM'], note: 'Olumsuz kök bilerek tercih edildi.' },
      context,
    );
    expect(outcome).toMatchObject({ from: 'REVIEW', to: 'APPROVED' });
    const stored = (await loadQuestion(t.db, id!))!;
    expect(stored).toMatchObject({ status: 'APPROVED', verificationStatus: 'VERIFIED' });
    const manual = (await listAudits(t.db, id!, 1)).find(
      (entry) => entry.result.pass === 'MANUAL',
    )!;
    expect(manual.actor).toBe(editor.accountId);
    expect(manual.result.detail).toMatchObject({ waivedCodes: ['NEGATIVE_STEM'] });
    expect((await logOf(t.db, id!)).at(-1)).toMatchObject({
      to_status: 'APPROVED',
      actor_account_id: editor.accountId,
      reason: 'EDITOR_APPROVED',
    });

    // The waiver belongs to the approved wording: a later audit run keeps the approval standing.
    const rerun = await runAudit(t.db, [id!], { now: NOW });
    expect(rerun.items[0]).toMatchObject({ from: 'APPROVED', to: 'APPROVED', verdict: 'PASS' });
    await transitionQuestion(t.db, id!, 'ACTIVE', { actor: editor, reason: 'PUBLISH' });
    expect(await statusCounts(t.db)).toEqual({ ACTIVE: 1 });
  });

  it('accepts "all waivable findings" in one go, but never a missing source', async () => {
    const [waivableId, historyId] = await importRows(t.db, [
      negated,
      {
        ...negated,
        externalId: 'hist',
        category: 'history',
        question: 'Malazgirt Savaşı hangi yıl yapılmıştır?',
        options: ['1071', '1176', '1243', '1453'],
        correctIndex: 0,
      },
    ]);
    await expect(
      approveQuestion(t.db, historyId!, { actor: editor, waive: 'ALL' }, context),
    ).rejects.toMatchObject({
      code: 'BLOCKED',
      detail: { codes: ['SOURCE_REQUIRED_MISSING'], waivable: false },
    });
    await expect(
      approveQuestion(t.db, waivableId!, { actor: editor, waive: 'ALL' }, context),
    ).resolves.toMatchObject({ to: 'APPROVED' });

    // With the source attached the same approval goes through.
    await editQuestion(
      t.db,
      historyId!,
      { sources: [{ url: 'https://tr.wikipedia.org/wiki/Malazgirt_Muharebesi' }] },
      { actor: editor, expectedRevision: 1 },
      context,
    );
    await expect(
      approveQuestion(t.db, historyId!, { actor: editor, waive: [] }, context),
    ).resolves.toMatchObject({ to: 'APPROVED' });
  });

  it('never approves over a REJECT finding', async () => {
    const [id] = await importClean(t.db, 1);
    // The editor's own rewrite leaks the answer: wording that a person may not wave through.
    await editQuestion(
      t.db,
      id!,
      {
        text: 'Türkiye’nin başkenti olan Ankara hangi ülkenin başkentidir?',
        options: [
          { text: 'Fransa', correct: false },
          { text: 'Türkiye', correct: true },
          { text: 'İspanya', correct: false },
          { text: 'İtalya', correct: false },
        ],
      },
      { actor: editor, expectedRevision: 1 },
      context,
    );
    await expect(
      approveQuestion(t.db, id!, { actor: editor, waive: 'ALL' }, context),
    ).rejects.toMatchObject({ code: 'REJECT_FINDINGS', detail: { codes: ['ANSWER_IN_QUESTION'] } });
    expect((await loadQuestion(t.db, id!))!.status).toBe('DRAFT');
  });

  it('is only for editors and admins, and only for questions that wait', async () => {
    const [id] = await importRows(t.db, [negated]);
    for (const actor of [moderator, support, SYSTEM_ACTOR])
      await expect(
        approveQuestion(t.db, id!, { actor, waive: 'ALL' }, context),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await approveQuestion(t.db, id!, { actor: editor, waive: 'ALL' }, context);
    await expect(
      approveQuestion(t.db, id!, { actor: editor, waive: 'ALL' }, context),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(
      approveQuestion(t.db, randomUUID(), { actor: editor, waive: 'ALL' }, context),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('records a rejection with its reason as an audit, and a rejected question can be reopened but not approved', async () => {
    const [id] = await importRows(t.db, [negated]);
    await rejectQuestion(t.db, id!, {
      actor: editor,
      reason: 'DUPLICATE_OF_OTHER',
      note: 'iki kez eklenmiş',
    });
    const stored = await loadQuestion(t.db, id!);
    expect(stored!.status).toBe('REJECTED');
    const manual = (await listAudits(t.db, id!, 1)).find(
      (entry) => entry.result.pass === 'MANUAL',
    )!;
    expect(manual).toMatchObject({ actor: editor.accountId });
    expect(manual.result).toMatchObject({
      status: 'REJECT',
      hardRejectReasons: ['DUPLICATE_OF_OTHER'],
    });
    await expect(
      approveQuestion(t.db, id!, { actor: editor, waive: 'ALL' }, context),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(
      rejectQuestion(t.db, id!, { actor: moderator, reason: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await transitionQuestion(t.db, id!, 'REVIEW', { actor: editor, reason: 'REOPEN' });
  });
});

describe('editing a question', () => {
  async function activeQuestion(): Promise<string> {
    const [id] = await importClean(t.db, 1);
    await runAudit(t.db, [id!], { now: NOW, providers: panel(), autoActivate: true });
    return id!;
  }

  it('a content change pulls an ACTIVE question back to REVIEW under a new revision, and the old audit stops counting', async () => {
    const id = await activeQuestion();
    const before = (await loadQuestion(t.db, id))!;
    const result = await editQuestion(
      t.db,
      id,
      { difficulty: before.question.difficulty === 'HARD' ? 'MEDIUM' : 'HARD' },
      { actor: editor, expectedRevision: before.revision },
      context,
    );
    expect(result).toMatchObject({
      revision: 2,
      status: 'REVIEW',
      contentChanged: true,
      demoted: true,
    });
    expect((await logOf(t.db, id)).at(-1)).toMatchObject({
      from_status: 'ACTIVE',
      to_status: 'REVIEW',
      reason: 'EDIT',
      actor_account_id: editor.accountId,
    });
    // Revision 1 passed; revision 2 has no model pass at all, so nothing can approve it by itself.
    await expect(
      transitionQuestion(t.db, id, 'APPROVED', { actor: editor, reason: 'TRY' }),
    ).rejects.toMatchObject({ code: 'AUDIT_REQUIRED' });
  });

  it('a metadata change (sources, dates, topic) keeps the revision and the status', async () => {
    const id = await activeQuestion();
    const result = await editQuestion(
      t.db,
      id,
      {
        sources: [{ url: 'https://tr.wikipedia.org/wiki/Hafta', title: 'Hafta' }],
        topic: 'takvim',
      },
      { actor: editor, expectedRevision: 1 },
      context,
    );
    expect(result).toMatchObject({
      revision: 1,
      status: 'ACTIVE',
      contentChanged: false,
      demoted: false,
    });
    const sources = await t.db
      .selectFrom('question_sources')
      .select(['url', 'title'])
      .where('question_id', '=', id)
      .execute();
    expect(sources).toEqual([{ url: 'https://tr.wikipedia.org/wiki/Hafta', title: 'Hafta' }]);
  });

  it('refuses a stale edit, bad content, a duplicate of another question, and a closed question', async () => {
    const [first, second] = await importClean(t.db, 2);
    const stale = editQuestion(
      t.db,
      first!,
      { topic: 'x' },
      { actor: editor, expectedRevision: 7 },
      context,
    );
    await expect(stale).rejects.toMatchObject({ code: 'CONFLICT', detail: { revision: 1 } });

    const invalid = await editQuestion(
      t.db,
      first!,
      { options: [{ text: 'Tek', correct: true }] },
      { actor: editor, expectedRevision: 1 },
      context,
    ).catch((error: unknown) => error);
    expect(invalid).toBeInstanceOf(LifecycleError);
    expect(invalid).toMatchObject({ code: 'INVALID_CONTENT' });
    expect((invalid as LifecycleError).detail.issues).toBeInstanceOf(Array);

    const other = (await loadQuestion(t.db, second!))!;
    await expect(
      editQuestion(
        t.db,
        first!,
        { text: other.question.text },
        { actor: editor, expectedRevision: 1 },
        context,
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE' });

    await rejectQuestion(t.db, second!, { actor: editor, reason: 'NOT_WANTED' });
    await expect(
      editQuestion(t.db, second!, { topic: 'y' }, { actor: editor, expectedRevision: 1 }, context),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(
      editQuestion(
        t.db,
        first!,
        { topic: 'z' },
        { actor: moderator, expectedRevision: 1 },
        context,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      editQuestion(
        t.db,
        randomUUID(),
        { topic: 'z' },
        { actor: editor, expectedRevision: 1 },
        context,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('recomputes fingerprints with the content, so the old wording is free again', async () => {
    const [id] = await importClean(t.db, 1);
    const original = cleanRows(1)[0]!;
    const before = (await loadQuestion(t.db, id!))!;
    await editQuestion(
      t.db,
      id!,
      { text: 'Takvimde bir haftayı oluşturan gün sayısı kaçtır?' },
      { actor: editor, expectedRevision: 1 },
      context,
    );
    const after = (await loadQuestion(t.db, id!))!;
    expect(after.lexical).not.toBe(before.lexical);
    expect(after.semanticProvider).toBe('hash-ngram');
    const again = await importQuestions(
      t.db,
      parseImportText(jsonl([{ ...original, externalId: 'old-wording' }]), 'jsonl'),
      { now: NOW },
    );
    expect(again.counts).toMatchObject({ DUPLICATE: 0, CREATED: 1 });
  });
});
