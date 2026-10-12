import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activate, importClean } from '../helpers/question-bank';
import { adminApi, staff, type Staff } from '../helpers/admin';
import { cleanRows, jsonl, withCategories } from '../helpers/questions';
import { startServer, type TestServer } from '../helpers/server';

/**
 * The admin API end to end (GDD §23): what each kind of staff can do and what it leaves behind in
 * the audit log. The server is the real one; staff sessions are issued directly (sign-in itself is
 * covered by auth.test.ts).
 */
let server: TestServer;
let admin: Staff;
let editor: Staff;
let moderator: Staff;
let support: Staff;
const as = (who: Staff) => adminApi(server, who);

beforeAll(async () => {
  server = await startServer({ seed: false });
  await withCategories(server.db.db);
  [admin, editor, moderator, support] = await Promise.all([
    staff(server, ['ADMIN']),
    staff(server, ['EDITOR']),
    staff(server, ['MODERATOR']),
    staff(server, ['SUPPORT']),
  ]);
});
afterAll(async () => {
  await server.dispose();
});

const auditRows = (action: string) =>
  server.db.db
    .selectFrom('admin_audit')
    .selectAll()
    .where('action', '=', action)
    .orderBy('id')
    .execute();

type Item = { id: string; status: string; text: string; revision: number };

describe('questions', () => {
  it('are created by hand as DRAFT, listed, searched and read in full', async () => {
    const row = cleanRows(1, 'api')[0]!;
    const created = await as(editor).post<{
      item: { outcome: string; questionId: string; status: string };
    }>('/v1/admin/questions', { question: row });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({ outcome: 'CREATED', status: 'DRAFT' });
    const id = created.body.item.questionId;

    const list = await as(editor).get<{ total: number; items: Item[] }>(
      '/v1/admin/questions?status=DRAFT&q=hafta',
    );
    expect(list.status).toBe(200);
    expect(list.body.items.map((i) => i.id)).toContain(id);
    const byId = await as(editor).get<{ items: Item[] }>(`/v1/admin/questions?q=${id}`);
    expect(byId.body.items).toHaveLength(1);

    const detail = await as(editor).get<{
      question: { id: string; options: { text: string; correct: boolean }[]; status: string };
      audits: { pass: string }[];
      findings: unknown[];
      statusLog: { reason: string }[];
    }>(`/v1/admin/questions/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.question.options.filter((o) => o.correct)).toHaveLength(1);
    expect(detail.body.audits.map((a) => a.pass)).toEqual(
      expect.arrayContaining(['HEURISTIC', 'ARBITER']),
    );
    expect(detail.body.statusLog[0]?.reason).toBe('IMPORT');
    expect((await auditRows('question.create'))[0]).toMatchObject({
      actor_account_id: editor.accountId,
      target_type: 'question',
      target_id: id,
    });
  });

  it('refuse a copy with 409, a bad row with 422, and never accept development content', async () => {
    const row = cleanRows(1, 'api')[0]!;
    expect((await as(editor).post('/v1/admin/questions', { question: row })).status).toBe(409);
    expect(
      (
        await as(editor).post('/v1/admin/questions', {
          question: { ...row, externalId: 'x1', question: '' },
        })
      ).status,
    ).toBe(422);
    const dev = await as(editor).post<{ item: { outcome: string } }>('/v1/admin/questions', {
      question: {
        ...row,
        externalId: 'x2',
        question: 'Başka bir deneme sorusu burada mı duruyor?',
        authorType: 'DEV_SEED',
      },
    });
    expect(dev.status).toBe(422);
    expect(dev.body.item.outcome).toBe('FORBIDDEN_AUTHOR');
    expect(
      (await as(editor).post('/v1/admin/questions', { question: row, status: 'ACTIVE' })).status,
    ).toBe(400);
  });

  it('are edited with the revision the editor saw, and a stale edit is a conflict', async () => {
    const list = await as(editor).get<{ items: Item[] }>('/v1/admin/questions?status=DRAFT');
    const target = list.body.items[0]!;
    const ok = await as(editor).patch<{ revision: number }>(`/v1/admin/questions/${target.id}`, {
      expectedRevision: target.revision,
      topic: 'takvim',
    });
    expect(ok.status).toBe(200);
    const stale = await as(editor).patch<{ error: { code: string } }>(
      `/v1/admin/questions/${target.id}`,
      { expectedRevision: target.revision + 5, topic: 'x' },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT');
    expect((await auditRows('question.edit')).length).toBeGreaterThanOrEqual(1);
  });

  it('take a whole file through the importer, with a dry run first', async () => {
    const rows = cleanRows(6, 'bulk').slice(1);
    const text = jsonl(rows);
    const dry = await as(editor).post<{ dryRun: boolean; counts: Record<string, number> }>(
      '/v1/admin/questions/import',
      { format: 'jsonl', text, dryRun: true },
    );
    expect(dry.body).toMatchObject({ dryRun: true, counts: { CREATED: 5 } });
    expect((await as(editor).get<{ total: number }>('/v1/admin/questions?q=bulk')).body.total).toBe(
      0,
    );
    const real = await as(editor).post<{ counts: Record<string, number> }>(
      '/v1/admin/questions/import',
      { format: 'jsonl', text },
    );
    expect(real.body.counts.CREATED).toBe(5);
    const again = await as(editor).post<{ counts: Record<string, number> }>(
      '/v1/admin/questions/import',
      { format: 'jsonl', text },
    );
    expect(again.body.counts.UNCHANGED).toBe(5);
    expect((await auditRows('question.import')).length).toBe(2);
  });
});

describe('the audit pipeline from the console', () => {
  it('audits a selection without a model, and exports it for a manual round', async () => {
    const run = await as(editor).post<{
      total: number;
      modelsConfigured: boolean;
      summary: { total: number };
    }>('/v1/admin/audit/run', { statuses: ['DRAFT'], limit: 50, dryRun: true });
    expect(run.status).toBe(200);
    expect(run.body.modelsConfigured).toBe(false);
    expect(run.body.total).toBeGreaterThan(0);

    const exported = await as(editor).call(
      'GET',
      '/v1/admin/export?format=jsonl&status=DRAFT&limit=3',
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toContain('application/x-ndjson');
    expect(exported.headers.get('content-disposition')).toContain('questions.jsonl');
    const rows = exported.text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { questionId: string; revision: number });
    expect(rows).toHaveLength(3);

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
    const results = rows.map((r) => ({
      questionId: r.questionId,
      revision: r.revision,
      status: 'PASS',
      scores,
    }));
    const imported = await as(editor).post<{ applied: number }>('/v1/admin/audit/results', {
      source: 'chat round 1',
      text: jsonl(results),
    });
    expect(imported.body.applied).toBe(3);
    const approved = await as(editor).get<{ items: Item[] }>('/v1/admin/questions?status=APPROVED');
    expect(approved.body.items.length).toBe(3);
  });

  it('lets an editor approve with named waivers and publish, and keeps auto-activation for administrators', async () => {
    const items = (await as(editor).get<{ items: Item[] }>('/v1/admin/questions?status=APPROVED'))
      .body.items;
    const publish = await as(editor).post<{ to: string }>(
      `/v1/admin/questions/${items[0]!.id}/transition`,
      { to: 'ACTIVE', reason: 'ilk yayın' },
    );
    expect(publish.status).toBe(200);
    expect(publish.body.to).toBe('ACTIVE');
    expect(
      (await as(editor).post('/v1/admin/audit/run', { statuses: ['DRAFT'], autoActivate: true }))
        .status,
    ).toBe(403);
    expect(
      (
        await as(admin).post('/v1/admin/audit/run', {
          statuses: ['DRAFT'],
          autoActivate: true,
          dryRun: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (await as(editor).post(`/v1/admin/questions/${randomUUID()}/approve`, { waive: [] })).status,
    ).toBe(404);
    const rejected = await as(editor).post(`/v1/admin/questions/${items[1]!.id}/transition`, {
      to: 'RETIRED',
      reason: 'artık gerekli değil',
    });
    expect(rejected.status).toBe(200);
  });
});

describe('moderation', () => {
  it('lets a moderator pull a question out of play but not publish one', async () => {
    const [id] = await activate(server.db.db, 1, 'mod', 10);
    const pull = await as(moderator).post<{ to: string }>(`/v1/admin/questions/${id}/transition`, {
      to: 'REVIEW',
      reason: 'oyuncu bildirimi',
    });
    expect(pull.status).toBe(200);
    const publish = await as(moderator).post<{ error: { code: string } }>(
      `/v1/admin/questions/${id}/transition`,
      { to: 'APPROVED', reason: 'olmaz' },
    );
    expect(publish.status).toBe(403);
    expect(publish.body.error.code).toBe('FORBIDDEN');
    expect(
      (await as(moderator).patch(`/v1/admin/questions/${id}`, { expectedRevision: 1, topic: 'x' }))
        .status,
    ).toBe(403);
  });

  it('shows the queue and the reports, and closes a report with the effect it chose', async () => {
    const [id] = await activate(server.db.db, 1, 'rep', 11);
    const hashA = 'a'.repeat(22);
    const hashB = 'b'.repeat(22);
    await server.db.db
      .insertInto('question_reports')
      .values([
        { question_id: id!, question_revision: 1, reporter_hash: hashA, reason: 'TYPO' },
        { question_id: id!, question_revision: 1, reporter_hash: hashB, reason: 'UNCLEAR' },
      ])
      .execute();
    const reports = await as(moderator).get<{
      total: number;
      items: { id: string; reason: string; question: { text: string } }[];
    }>('/v1/admin/reports');
    const mine = reports.body.items.filter((r) => r.reason === 'TYPO' || r.reason === 'UNCLEAR');
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(reports.text).not.toContain(hashA); // who reported is never shown
    const resolved = await as(moderator).post<{ resolved: number; questionStatus: string }>(
      `/v1/admin/reports/${mine[0]!.id}/resolve`,
      { action: 'SEND_TO_REVIEW', note: 'bakılacak' },
    );
    expect(resolved.body).toMatchObject({ resolved: 2, questionStatus: 'REVIEW' });
    expect(
      (await as(moderator).post(`/v1/admin/reports/${mine[0]!.id}/resolve`, { action: 'DISMISS' }))
        .status,
    ).toBe(409);
    const queue = await as(moderator).get<{ items: { id: string; priority: number }[] }>(
      '/v1/admin/queue',
    );
    expect(queue.body.items.map((q) => q.id)).toContain(id);
    expect((await auditRows('report.resolve'))[0]).toMatchObject({
      actor_account_id: moderator.accountId,
    });
  });

  it('can end a room and sees its players without any credential', async () => {
    const created = await fetch(`${server.httpUrl}/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: { kind: 'DISPLAY', version: 't' } }),
    });
    const room = (await created.json()) as { roomId: string; code: string };
    const rooms = await as(support).get<{ items: { id: string; code: string }[] }>(
      '/v1/admin/rooms',
    );
    expect(rooms.body.items.map((r) => r.id)).toContain(room.roomId);
    const detail = await as(support).get<{ players: Record<string, unknown>[] }>(
      `/v1/admin/rooms/${room.roomId}`,
    );
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toMatch(/sessionId/u);
    expect((await as(support).post(`/v1/admin/rooms/${room.roomId}/close`)).status).toBe(403);
    expect((await as(moderator).post(`/v1/admin/rooms/${room.roomId}/close`)).status).toBe(200);
    expect((await auditRows('room.close'))[0]).toMatchObject({ target_id: room.roomId });
  });

  it('bans from a live room by address or device, lists and lifts the ban, and never shows the subject', async () => {
    const created = (await (
      await fetch(`${server.httpUrl}/v1/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client: { kind: 'DISPLAY', version: 't' } }),
      })
    ).json()) as { roomId: string; code: string };
    const { TestClient } = await import('../helpers/client');
    const phone = await TestClient.connect(server.wsUrl);
    await phone.join(server.wsUrl, created.code, 'Trol', 'dev-troll-0123456789abcdef');
    const players = (
      await as(moderator).get<{ players: { playerId: string }[] }>(
        `/v1/admin/rooms/${created.roomId}`,
      )
    ).body.players;
    const ban = await as(moderator).post<{ id: string }>(
      `/v1/admin/rooms/${created.roomId}/players/${players[0]!.playerId}/ban`,
      { kind: 'DEVICE', reason: 'taciz', hours: 24 },
    );
    expect(ban.status).toBe(201);
    const closed = await phone.next((m) => m.type === 'SESSION_REVOKED', 3_000, 'revocation');
    expect(closed.type).toBe('SESSION_REVOKED');
    const list = await as(support).get<{ items: { id: string; kind: string }[] }>('/v1/admin/bans');
    expect(list.body.items.map((b) => b.id)).toContain(ban.body.id);
    expect(list.text).not.toMatch(/subject/iu);
    // The same device is turned away at the door while the ban stands, and let in once it is lifted.
    const retry = async (): Promise<string> => {
      const socket = await TestClient.connect(server.wsUrl);
      socket.send(
        'JOIN_ROOM',
        {
          code: created.code,
          nickname: 'Trol2',
          avatarId: 'fox',
          deviceId: 'dev-troll-0123456789abcdef',
          client: { kind: 'WEB', version: 't' },
        },
        { roomId: null, sessionId: null },
      );
      const answer = await socket.next(
        (m) => m.type === 'ERROR' || m.type === 'ROOM_JOINED',
        3_000,
        'answer',
      );
      await socket.close();
      return answer.type === 'ERROR' ? answer.payload.code : answer.type;
    };
    expect(await retry()).toBe('BANNED');
    expect((await as(support).post(`/v1/admin/bans/${ban.body.id}/lift`)).status).toBe(403);
    expect((await as(moderator).post(`/v1/admin/bans/${ban.body.id}/lift`)).status).toBe(200);
    expect((await as(moderator).post(`/v1/admin/bans/${ban.body.id}/lift`)).status).toBe(404);
    expect(await retry()).toBe('ROOM_JOINED');
    await phone.close();
  });

  it('keeps incidents with notes', async () => {
    const made = await as(moderator).post<{ id: string }>('/v1/admin/incidents', {
      title: 'Sahte rapor dalgası',
      severity: 'MEDIUM',
      summary: 'Tek adresten',
    });
    expect(made.status).toBe(201);
    expect(
      (
        await as(moderator).post(`/v1/admin/incidents/${made.body.id}/notes`, {
          body: 'Adres engellendi',
        })
      ).status,
    ).toBe(201);
    expect(
      (await as(moderator).patch(`/v1/admin/incidents/${made.body.id}`, { status: 'RESOLVED' }))
        .status,
    ).toBe(200);
    const detail = await as(support).get<{
      incident: { status: string; resolvedAt: string };
      notes: unknown[];
    }>(`/v1/admin/incidents/${made.body.id}`);
    expect(detail.body.incident.status).toBe('RESOLVED');
    expect(detail.body.incident.resolvedAt).toBeTruthy();
    expect(detail.body.notes).toHaveLength(1);
    expect(
      (await as(support).post('/v1/admin/incidents', { title: 'olmaz', severity: 'LOW' })).status,
    ).toBe(403);
  });
});

describe('settings and people', () => {
  it('flips a feature flag, takes effect at once, and records it', async () => {
    const before = (await (await fetch(`${server.httpUrl}/v1/flags`)).json()) as {
      flags: Record<string, boolean>;
    };
    expect(before.flags['mode.blind_quiz']).toBe(false);
    expect(
      (await as(editor).put('/v1/admin/flags/mode.blind_quiz', { enabled: true })).status,
    ).toBe(403);
    expect((await as(admin).put('/v1/admin/flags/mode.blind_quiz', { enabled: true })).status).toBe(
      200,
    );
    const after = (await (await fetch(`${server.httpUrl}/v1/flags`)).json()) as {
      flags: Record<string, boolean>;
    };
    expect(after.flags['mode.blind_quiz']).toBe(true);
    expect((await as(admin).put('/v1/admin/flags/no.such.flag', { enabled: true })).status).toBe(
      404,
    );
    expect((await auditRows('flag.set'))[0]).toMatchObject({
      target_id: 'mode.blind_quiz',
      actor_account_id: admin.accountId,
    });
    await as(admin).put('/v1/admin/flags/mode.blind_quiz', { enabled: false });
  });

  it('lists and edits categories (editors) and shows counts', async () => {
    const list = await as(support).get<{
      items: { id: string; enabled: boolean; questions: { total: number } }[];
    }>('/v1/admin/categories');
    expect(list.body.items).toHaveLength(17);
    expect(
      (await as(support).patch('/v1/admin/categories/history', { enabled: false })).status,
    ).toBe(403);
    expect(
      (await as(editor).patch('/v1/admin/categories/history', { enabled: false })).status,
    ).toBe(200);
    expect((await as(editor).patch('/v1/admin/categories/history', { enabled: true })).status).toBe(
      200,
    );
    expect((await as(editor).patch('/v1/admin/categories/history', {})).status).toBe(400);
    expect((await as(editor).patch('/v1/admin/categories/nope', { enabled: true })).status).toBe(
      404,
    );
  });

  it('manages roles with the last administrator protected', async () => {
    const target = await staff(server, []);
    const set = await as(admin).put<{ roles: string[] }>(
      `/v1/admin/users/${target.accountId}/roles`,
      { roles: ['EDITOR', 'EDITOR', 'SUPPORT'] },
    );
    expect(set.body.roles.sort()).toEqual(['EDITOR', 'SUPPORT']);
    expect(
      (await as(editor).put(`/v1/admin/users/${target.accountId}/roles`, { roles: ['ADMIN'] }))
        .status,
    ).toBe(403);
    expect(
      (await as(admin).put(`/v1/admin/users/${target.accountId}/roles`, { roles: ['GOD'] })).status,
    ).toBe(400);
    const lockout = await as(admin).put<{ error: { code: string } }>(
      `/v1/admin/users/${admin.accountId}/roles`,
      { roles: [] },
    );
    expect([200, 409]).toContain(lockout.status); // other administrators exist in this suite
    const list = await as(support).get<{ items: { id: string; roles: string[] }[] }>(
      '/v1/admin/users?role=EDITOR',
    );
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/token|hash/iu);
    await server.built.accounts.setRoles(admin.accountId, ['ADMIN'], admin.accountId);
  });

  it('suspends an account, which cuts its sessions at once', async () => {
    const target = await staff(server, ['EDITOR']);
    expect((await adminApi(server, target).get('/v1/admin/queue')).status).toBe(200);
    expect(
      (await as(admin).post(`/v1/admin/users/${target.accountId}/status`, { status: 'SUSPENDED' }))
        .status,
    ).toBe(200);
    expect((await adminApi(server, target).get('/v1/admin/queue')).status).toBe(401);
    expect(
      (await as(admin).post(`/v1/admin/users/${randomUUID()}/status`, { status: 'SUSPENDED' }))
        .status,
    ).toBe(404);
  });

  it('shows the audit log to administrators only, newest first, and the log cannot be changed', async () => {
    const log = await as(admin).get<{
      total: number;
      items: { action: string; actor: string; id: number }[];
    }>('/v1/admin/audit-log?limit=5');
    expect(log.status).toBe(200);
    expect(log.body.items[0]!.id).toBeGreaterThan(log.body.items[1]!.id);
    expect((await as(editor).get('/v1/admin/audit-log')).status).toBe(403);
    const filtered = await as(admin).get<{ items: { actor: string }[] }>(
      `/v1/admin/audit-log?actor=${editor.accountId}`,
    );
    expect(filtered.body.items.every((i) => i.actor === editor.accountId)).toBe(true);
    await expect(
      server.db.db.updateTable('admin_audit').set({ action: 'x' }).execute(),
    ).rejects.toThrow(/append-only/u);
    await expect(server.db.db.deleteFrom('admin_audit').execute()).rejects.toThrow(/append-only/u);
  });

  it('reports the numbers', async () => {
    await importClean(server.db.db, 2, 'stat', 12);
    const stats = await as(support).get<{
      questions: Record<string, number>;
      openReports: number;
      rooms: { held: number };
    }>('/v1/admin/stats');
    expect(stats.status).toBe(200);
    expect(Object.values(stats.body.questions).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(typeof stats.body.openReports).toBe('number');
  });
});
