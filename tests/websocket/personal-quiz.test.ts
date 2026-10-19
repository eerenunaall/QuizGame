import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appleNotification, appleTransaction } from '../helpers/apple-store';
import { adminApi, staff } from '../helpers/admin';
import type { TestClient } from '../helpers/client';
import { closeParty, createParty, type Party } from '../helpers/party';
import { call, player, startShop, type Player, type Shop } from '../helpers/payments';
import {
  SENTINEL_ANSWER,
  enablePersonalQuizzes,
  readyBlindQuiz,
  readyCustomQuiz,
} from '../helpers/quizzes';
import { waitUntil } from '../helpers/wait';

/**
 * Playing a personal quiz in a room (ADR-0015, acceptance AA): the TV's link attaches a quiz, every
 * screen learns the mode, the game uses the approved questions, and the room's durable traces of
 * the answers are erased when it closes. Rooms start FREE as in production.
 */
let shop: Shop;
beforeAll(async () => {
  shop = await startShop({ DEFAULT_ROOM_TIER: 'FREE' });
  await enablePersonalQuizzes(shop.server);
});
afterAll(async () => {
  await shop.dispose();
});
const server = () => shop.server;
const tokenOf = (url: string): string => url.split('/unlock/')[1]!;

async function buy(who: Player): Promise<Record<string, unknown>> {
  const tx = appleTransaction(who.storeToken);
  const result = await call(server(), 'POST', '/v1/purchases/verify', {
    token: who.token,
    body: { platform: 'IOS', signedTransaction: shop.apple.sign(tx) },
  });
  expect(result.status).toBe(200);
  return tx;
}
async function linkFor(party: Party): Promise<string> {
  party.display.send('REQUEST_UNLOCK_LINK', {});
  return tokenOf((await party.display.nextOfType('UNLOCK_LINK')).payload.url);
}
const attach = (who: Player, token: string, quizId: string | null) =>
  call<{ mode?: string; title?: string | null; rounds?: number; error?: { code: string } }>(
    server(),
    'POST',
    `/v1/link-intents/${token}/quiz`,
    { token: who.token, body: { quizId } },
  );
const settingsOf = async (client: TestClient) => {
  const message = await client.next(
    (m) => m.type === 'SETTINGS_CHANGED',
    5_000,
    'SETTINGS_CHANGED',
  );
  return message.type === 'SETTINGS_CHANGED' ? message.payload.settings : null;
};

describe('attaching a personal quiz to a room', () => {
  it('needs the full game, lets an owner unlock on the way, and tells every screen only the mode and the title', async () => {
    const quiz = await readyBlindQuiz(server());
    const party = await createParty(server(), 3);
    const token = await linkFor(party);

    // an account that does not own the game cannot attach a quiz to a FREE room
    expect(await attach(quiz.creator, token, quiz.quizId)).toMatchObject({
      status: 403,
      body: { error: { code: 'TIER_REQUIRED' } },
    });
    expect(server().built.manager.getByCode(party.created.code)!.mode()).toBe('CLASSIC');

    await buy(quiz.creator);
    const attached = await attach(quiz.creator, token, quiz.quizId);
    expect(attached).toMatchObject({
      status: 200,
      body: { mode: 'BLIND', title: 'Ece hakkında', rounds: 3 },
    });
    for (const client of [party.display, ...party.players]) {
      const settings = await waitForSettings(client, (s) => s.mode === 'BLIND');
      expect(settings).toEqual({
        mode: 'BLIND',
        contentTitle: 'Ece hakkında',
        rounds: 3,
        difficulty: 'MEDIUM',
        categories: 'ALL',
      });
    }
    // not one word of the answers has reached anybody yet
    for (const client of [party.display, ...party.players])
      expect(JSON.stringify(client.drain())).not.toContain(SENTINEL_ANSWER);
    expect(server().built.manager.getByCode(party.created.code)!.tier()).toBe('FULL');
    await closeParty(party);
  });

  it('refuses a quiz that is not ready, not yours, in a running game, or after the link belongs to someone else', async () => {
    const owner = await player(server(), 'WEB');
    await buy(owner);
    const empty = await call<{ id: string }>(server(), 'POST', '/v1/quizzes', {
      token: owner.token,
      body: { kind: 'BLIND', title: 'Empty', language: 'tr' },
    });
    const party = await createParty(server(), 2);
    const token = await linkFor(party);
    expect(await attach(owner, token, empty.body.id)).toMatchObject({
      status: 409,
      body: { error: { code: 'NOT_READY' } },
    });

    const theirs = await readyBlindQuiz(server());
    expect(await attach(owner, token, theirs.quizId)).toMatchObject({ status: 404 });
    expect(await attach(owner, token, '00000000-0000-4000-8000-000000000000')).toMatchObject({
      status: 404,
    });

    const stranger = await player(server(), 'WEB');
    await buy(stranger);
    const mine = await readyBlindQuiz(server(), { creator: owner });
    expect(await attach(owner, token, mine.quizId)).toMatchObject({ status: 200 }); // binds the link to `owner`
    expect(await attach(stranger, token, null)).toMatchObject({ status: 404 }); // nobody else may use it

    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    await party.leader.waitForPhase('ROUND_INTRO', 10_000);
    expect(await attach(owner, token, null)).toMatchObject({
      status: 409,
      body: { error: { code: 'INVALID_STATE' } },
    });
    await closeParty(party);
  });

  it('goes back to the classic game when asked, and also when the purchase is refunded', async () => {
    const quiz = await readyBlindQuiz(server());
    const tx = await buy(quiz.creator);
    const party = await createParty(server(), 2);
    const token = await linkFor(party);
    expect((await attach(quiz.creator, token, quiz.quizId)).status).toBe(200);
    expect((await attach(quiz.creator, token, null)).body).toMatchObject({
      mode: 'CLASSIC',
      title: null,
    });
    expect(server().built.manager.getByCode(party.created.code)!.mode()).toBe('CLASSIC');

    // attach again, then lose the full game: the room falls back to the classic one
    expect((await attach(quiz.creator, token, quiz.quizId)).status).toBe(200);
    const refund = appleNotification(shop.apple, 'REFUND', tx);
    expect(
      (
        await call(server(), 'POST', '/v1/webhooks/apple', {
          body: { signedPayload: refund.signedPayload },
        })
      ).status,
    ).toBe(200);
    await waitUntil(
      () => server().built.manager.getByCode(party.created.code)!.mode() === 'CLASSIC',
      5000,
      'back to classic',
    );
    expect(server().built.manager.getByCode(party.created.code)!.tier()).toBe('FREE');
    await closeParty(party);
  });
});

async function waitForSettings(
  client: TestClient,
  wanted: (s: NonNullable<Awaited<ReturnType<typeof settingsOf>>>) => boolean,
) {
  for (;;) {
    const settings = await settingsOf(client);
    if (settings && wanted(settings)) return settings;
  }
}

describe('playing a Blind Quiz', () => {
  it('asks the approved questions about the person, with their own words as the right answer, and erases the traces at close', async () => {
    const sentinel = `traces-${Date.now()}-zorba`;
    const quiz = await readyBlindQuiz(server(), { sentinel });
    await buy(quiz.creator);
    const party = await createParty(server(), 3);
    const token = await linkFor(party);
    expect((await attach(quiz.creator, token, quiz.quizId)).status).toBe(200);
    for (const client of party.players) await waitForSettings(client, (s) => s.mode === 'BLIND');

    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    const seen: { text: string; options: string[] }[] = [];
    for (let round = 0; round < 3; round += 1) {
      const question = await party.players[1]!.waitForPhase('ANSWERING', 20_000);
      const data = question.payload.data;
      if (data.phase !== 'ANSWERING') throw new Error('not answering');
      seen.push({ text: data.text, options: data.options.map((o) => o.text) });
      for (const client of party.players)
        client.send('SUBMIT_ANSWER', {
          questionId: data.questionId,
          optionId: data.options[0]!.optionId,
        });
      const reveal = await party.players[1]!.waitForPhase('REVEAL', 20_000);
      const revealed = reveal.payload.data;
      if (revealed.phase !== 'REVEAL') throw new Error('not a reveal');
      expect(revealed.explanation ?? '').toContain('Ece');
    }
    // all three of the person's approved questions came up, once each, worded from the fixed templates
    expect(seen.map((q) => q.text).sort()).toEqual(
      [
        'Ece çocukken büyüyünce ne olmak istiyordu?',
        'Ece hangi yemeği gizlice sevmiyor?',
        'Ece hangi beklenmedik hobiye sahip?',
      ].sort(),
    );
    expect(seen.some((q) => q.text === 'Ece çocukken büyüyünce ne olmak istiyordu?')).toBe(true);
    expect(seen.flatMap((q) => q.options)).toContain(sentinel);
    await party.players[1]!.waitForPhase('RESULTS', 40_000);

    // close the room: no durable trace of the answers is left anywhere in the database
    party.leader.send('END_ROOM', {});
    await waitUntil(
      () => server().built.manager.getByCode(party.created.code) === undefined,
      8000,
      'room gone',
    );
    await waitUntil(
      async () =>
        (
          await server()
            .db.db.selectFrom('room_events')
            .select('seq')
            .where('room_id', '=', party.created.roomId)
            .execute()
        ).length === 0,
      5000,
      'events scrubbed',
    );
    const row = await server()
      .db.db.selectFrom('rooms')
      .select('snapshot')
      .where('id', '=', party.created.roomId)
      .executeTakeFirstOrThrow();
    expect(row.snapshot).toBeNull();
    const tables = (await server()
      .db.db.selectFrom('information_schema.tables' as never)
      .select('table_name' as never)
      .where('table_schema' as never, '=', 'public' as never)
      .execute()) as unknown as { table_name: string }[];
    const { sql } = await import('kysely');
    for (const { table_name } of tables) {
      const hits = await sql<{
        n: string;
      }>`SELECT count(*)::text AS n FROM ${sql.table(table_name)} t WHERE t::text LIKE ${'%' + sentinel + '%'}`.execute(
        server().db.db,
      );
      expect(Number(hits.rows[0]!.n), table_name).toBe(0);
    }
    await closeParty(party);
  });

  it('can be reported: the report reaches moderation by id only, and a moderator removes the question unread (ADR-0015, AC)', async () => {
    const quiz = await readyBlindQuiz(server());
    await buy(quiz.creator);
    const party = await createParty(server(), 2);
    const token = await linkFor(party);
    await attach(quiz.creator, token, quiz.quizId);
    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    const first = await party.players[0]!.waitForPhase('ANSWERING', 20_000);
    if (first.payload.data.phase !== 'ANSWERING') throw new Error('not answering');
    const questionId = first.payload.data.questionId;
    for (const client of party.players)
      client.send('SUBMIT_ANSWER', {
        questionId,
        optionId: first.payload.data.options[0]!.optionId,
      });
    await party.players[0]!.waitForPhase('REVEAL', 20_000);
    // the bank's queue is untouched; a second press by the same player is not a second report
    const bankBefore = await server().db.db.selectFrom('question_reports').select('id').execute();
    for (let i = 0; i < 2; i += 1) {
      const id = party.players[0]!.send('REPORT_QUESTION', { questionId, reason: 'OFFENSIVE' });
      await party.players[0]!.next((m) => m.type === 'ACK' && m.payload.messageId === id);
    }
    const id = party.players[1]!.send('REPORT_QUESTION', { questionId, reason: 'OTHER' });
    await party.players[1]!.next((m) => m.type === 'ACK' && m.payload.messageId === id);
    const rows = await server().db.db.selectFrom('personal_reports').selectAll().execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ quiz_id: quiz.quizId, kind: 'BLIND', question_id: questionId });
    // nothing a target wrote is copied into the report
    for (const answer of quiz.answers) expect(JSON.stringify(rows)).not.toContain(answer);
    expect(await server().db.db.selectFrom('question_reports').select('id').execute()).toEqual(
      bankBefore,
    );

    // only moderators and administrators see the queue, and it holds ids, never text
    const editor = adminApi(server(), await staff(server(), ['EDITOR']));
    expect((await editor.get('/v1/admin/personal-reports')).status).toBe(403);
    const moderator = adminApi(server(), await staff(server(), ['MODERATOR']));
    const queue = await moderator.get<{
      total: number;
      items: { id: string; quizId: string; questionId: string; reports: number }[];
    }>('/v1/admin/personal-reports');
    expect(queue.status).toBe(200);
    expect(queue.body.total).toBe(2);
    expect(queue.body.items[0]).toMatchObject({ quizId: quiz.quizId, questionId, reports: 2 });
    for (const secret of [...quiz.answers, quiz.targetName, 'reporter', 'room'])
      expect(queue.text, secret).not.toContain(secret);

    const resolved = await moderator.post(
      `/v1/admin/personal-reports/${queue.body.items[0]!.id}/resolve`,
      { action: 'REMOVE_QUESTION' },
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body).toEqual({ ok: true, closed: 2 });
    expect(
      await server()
        .db.db.selectFrom('blind_responses')
        .select('id')
        .where('id', '=', questionId)
        .execute(),
    ).toEqual([]);
    expect((await moderator.get<{ total: number }>('/v1/admin/personal-reports')).body.total).toBe(
      0,
    );
    const again = await moderator.post(
      `/v1/admin/personal-reports/${queue.body.items[0]!.id}/resolve`,
      { action: 'DISMISS' },
    );
    expect(again.status).toBe(409);
    const audit = await server()
      .db.db.selectFrom('admin_audit')
      .select(['action', 'detail'])
      .where('action', '=', 'personal_report.resolve')
      .execute();
    expect(audit).toEqual([
      { action: 'personal_report.resolve', detail: { action: 'REMOVE_QUESTION', closed: 2 } },
    ]);
    await closeParty(party);
  });

  it('a moderator can delete the whole reported quiz, which takes its reports with it', async () => {
    const quiz = await readyCustomQuiz(server());
    await buy(quiz.creator);
    const party = await createParty(server(), 2);
    const token = await linkFor(party);
    await attach(quiz.creator, token, quiz.quizId);
    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    const first = await party.players[0]!.waitForPhase('ANSWERING', 20_000);
    if (first.payload.data.phase !== 'ANSWERING') throw new Error('not answering');
    for (const client of party.players)
      client.send('SUBMIT_ANSWER', {
        questionId: first.payload.data.questionId,
        optionId: first.payload.data.options[0]!.optionId,
      });
    await party.players[0]!.waitForPhase('REVEAL', 20_000);
    const id = party.players[0]!.send('REPORT_QUESTION', {
      questionId: first.payload.data.questionId,
      reason: 'OFFENSIVE',
    });
    await party.players[0]!.next((m) => m.type === 'ACK' && m.payload.messageId === id);
    const admin = adminApi(server(), await staff(server(), ['ADMIN']));
    const queue = await admin.get<{ items: { id: string; quizId: string; kind: string }[] }>(
      '/v1/admin/personal-reports',
    );
    const report = queue.body.items.find((item) => item.quizId === quiz.quizId)!;
    expect(report.kind).toBe('CUSTOM');
    const done = await admin.post(`/v1/admin/personal-reports/${report.id}/resolve`, {
      action: 'DELETE_QUIZ',
    });
    expect(done.status).toBe(200);
    expect(
      await server()
        .db.db.selectFrom('personal_quizzes')
        .select('id')
        .where('id', '=', quiz.quizId)
        .execute(),
    ).toEqual([]);
    expect(
      await server()
        .db.db.selectFrom('personal_reports')
        .select('id')
        .where('quiz_id', '=', quiz.quizId)
        .execute(),
    ).toEqual([]);
    await closeParty(party);
  });
});

describe('playing a Custom Quiz', () => {
  it('plays the author’s own questions', async () => {
    const quiz = await readyCustomQuiz(server());
    await buy(quiz.creator);
    const party = await createParty(server(), 2);
    const token = await linkFor(party);
    expect(await attach(quiz.creator, token, quiz.quizId)).toMatchObject({
      status: 200,
      body: { mode: 'CUSTOM', rounds: 3 },
    });
    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    const question = await party.players[0]!.waitForPhase('ANSWERING', 20_000);
    if (question.payload.data.phase !== 'ANSWERING') throw new Error('not answering');
    expect(question.payload.data.text).toMatch(/^Ofiste \d\. soru/u);
    expect(question.payload.data.options.map((o) => o.text).sort()).toEqual([
      'Doğru olan',
      'Yanlış bir',
      'Yanlış iki',
    ]);
    await closeParty(party);
  });
});
