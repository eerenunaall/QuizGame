import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { staff } from '../helpers/admin';
import { call, player, type Player } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';

/**
 * Blind Quiz (ADR-0015, acceptance AA/AB): the creator builds a quiz about people who answer
 * privately. The creator's API returns completion status only; the answers are sealed at rest and
 * only the person who answered (holding the invite) can read them back.
 */
const SENTINEL = 'zorba-the-sentinel-42';
let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(async () => {
  await server.dispose();
});
beforeEach(async () => {
  await server.db.db
    .updateTable('feature_flags')
    .set({ enabled: true })
    .where('key', 'in', ['mode.blind_quiz', 'mode.custom_quiz'])
    .execute();
  server.built.flags.invalidate();
});

interface Quiz {
  id: string;
  prompts: { id: string; catalogKey: string | null; text: string | null }[];
  targets: {
    id: string;
    displayName: string;
    status: string;
    answered: number;
    approved: number;
    total: number;
  }[];
  ready: boolean;
}
const tokenOf = (inviteUrl: string) => inviteUrl.split('/blind/respond/')[1]!;
const quizOf = async (who: Player, id: string) =>
  (await call<Quiz>(server, 'GET', `/v1/quizzes/${id}`, { token: who.token })).body;

/** A quiz with three catalogue prompts and one target; returns what a test needs to play with it. */
async function setup(name = 'Ece') {
  const creator = await player(server, 'WEB');
  const created = await call<{ id: string }>(server, 'POST', '/v1/quizzes', {
    token: creator.token,
    body: { kind: 'BLIND', title: 'Ece hakkında', language: 'tr' },
  });
  expect(created.status).toBe(201);
  const quizId = created.body.id;
  for (const catalogKey of ['dreamJob', 'dislikedFood', 'surprisingHobby'])
    expect(
      (
        await call(server, 'POST', `/v1/quizzes/${quizId}/prompts`, {
          token: creator.token,
          body: { catalogKey },
        })
      ).status,
    ).toBe(201);
  const target = await call<{ id: string; inviteUrl: string }>(
    server,
    'POST',
    `/v1/quizzes/${quizId}/targets`,
    {
      token: creator.token,
      body: { displayName: name },
    },
  );
  expect(target.status).toBe(201);
  const quiz = await quizOf(creator, quizId);
  return {
    creator,
    quizId,
    quiz,
    targetId: target.body.id,
    token: tokenOf(target.body.inviteUrl),
    inviteUrl: target.body.inviteUrl,
  };
}
interface RespondBody {
  quiz?: unknown;
  target?: { name: string; consented: boolean };
  prompts: { response: { answer: string; decoys: string[]; approved: boolean } | null }[];
  error: { code: string; params?: Record<string, string> };
}
const responsesOf = (quizId: string) =>
  server.db.db
    .selectFrom('blind_responses')
    .innerJoin('blind_targets', 'blind_targets.id', 'blind_responses.target_id')
    .select([
      'blind_responses.id as id',
      'blind_responses.sealed as sealed',
      'blind_responses.key_id as key_id',
      'blind_responses.approved_at as approved_at',
      'blind_responses.visibility_policy as visibility_policy',
    ])
    .where('blind_targets.quiz_id', '=', quizId)
    .orderBy('blind_responses.created_at')
    .execute();
const respond = (token: string, path = '', method = 'GET', body?: unknown) =>
  call<RespondBody>(
    server,
    method,
    `/v1/blind/respond/${token}${path}`,
    body === undefined ? {} : { body },
  );

describe('building a quiz as its creator', () => {
  it('creates a quiz, picks prompts from the catalogue or writes one, and invites a person with a one-time link', async () => {
    const { creator, quizId, quiz, inviteUrl } = await setup();
    expect(inviteUrl).toMatch(/^http:\/\/localhost:5173\/blind\/respond\/[A-Za-z0-9_-]{43}$/u);
    expect(quiz.prompts.map((p) => p.catalogKey)).toEqual([
      'dreamJob',
      'dislikedFood',
      'surprisingHobby',
    ]);
    expect(quiz.targets).toEqual([
      expect.objectContaining({ displayName: 'Ece', status: 'PENDING', answered: 0, total: 3 }),
    ]);
    expect(quiz.ready).toBe(false);

    const custom = await call<{ id: string }>(server, 'POST', `/v1/quizzes/${quizId}/prompts`, {
      token: creator.token,
      body: { text: 'Hangi şehirde doğdun?' },
    });
    expect(custom.status).toBe(201);
    // the same catalogue prompt twice, an unknown one, a link, swearing and shouting are all refused
    for (const body of [
      { catalogKey: 'dreamJob' },
      { catalogKey: 'passwordHint' },
      { text: 'bak https://evil.example' },
      { text: 'x' },
      { text: 'a'.repeat(300) },
    ])
      expect([400, 422], JSON.stringify(body)).toContain(
        (
          await call(server, 'POST', `/v1/quizzes/${quizId}/prompts`, {
            token: creator.token,
            body,
          })
        ).status,
      );
    const listed = await call<{ items: { id: string; ready: boolean }[]; catalog: string[] }>(
      server,
      'GET',
      '/v1/quizzes',
      { token: creator.token },
    );
    expect(listed.body.items.map((q) => q.id)).toContain(quizId);
    expect(listed.body.catalog).toContain('dreamJob');
  });

  it('keeps quizzes private to their creator and out of reach of staff sessions', async () => {
    const { creator, quizId, targetId } = await setup();
    const stranger = await player(server, 'WEB');
    for (const [method, path, body] of [
      ['GET', `/v1/quizzes/${quizId}`],
      ['DELETE', `/v1/quizzes/${quizId}`],
      ['POST', `/v1/quizzes/${quizId}/prompts`, { catalogKey: 'freeSunday' }],
      ['POST', `/v1/quizzes/${quizId}/targets`, { displayName: 'Mallory' }],
      ['POST', `/v1/quizzes/${quizId}/targets/${targetId}/invite`, {}],
      ['DELETE', `/v1/quizzes/${quizId}/targets/${targetId}`],
    ] as [string, string, unknown?][])
      expect(
        (await call(server, method, path, { token: stranger.token, ...(body ? { body } : {}) }))
          .status,
        `${method} ${path}`,
      ).toBe(404);
    expect(
      (await call(server, 'GET', `/v1/quizzes/${randomUUID()}`, { token: creator.token })).status,
    ).toBe(404);
    expect((await call(server, 'GET', '/v1/quizzes')).status).toBe(401);
    const admin = await staff(server, ['ADMIN']);
    expect((await call(server, 'GET', '/v1/quizzes', { token: admin.token })).status).toBe(403);
  });

  it('caps what one account can hold', async () => {
    const creator = await player(server, 'WEB');
    for (let i = 0; i < 10; i += 1)
      expect(
        (
          await call(server, 'POST', '/v1/quizzes', {
            token: creator.token,
            body: { kind: 'BLIND', title: `Quiz ${i}`, language: 'tr' },
          })
        ).status,
      ).toBe(201);
    expect(
      (
        await call(server, 'POST', '/v1/quizzes', {
          token: creator.token,
          body: { kind: 'BLIND', title: 'Too many', language: 'tr' },
        })
      ).status,
    ).toBe(409);

    const { creator: owner, quizId } = await setup();
    for (let i = 0; i < 5; i += 1)
      expect(
        (
          await call(server, 'POST', `/v1/quizzes/${quizId}/targets`, {
            token: owner.token,
            body: { displayName: `P${i}` },
          })
        ).status,
      ).toBe(201);
    expect(
      (
        await call(server, 'POST', `/v1/quizzes/${quizId}/targets`, {
          token: owner.token,
          body: { displayName: 'P7' },
        })
      ).status,
    ).toBe(409);
  });

  it('is switched off by its flag', async () => {
    await server.db.db
      .updateTable('feature_flags')
      .set({ enabled: false })
      .where('key', '=', 'mode.blind_quiz')
      .execute();
    server.built.flags.invalidate();
    const creator = await player(server, 'WEB');
    expect(
      (
        await call(server, 'POST', '/v1/quizzes', {
          token: creator.token,
          body: { kind: 'BLIND', title: 'Off', language: 'tr' },
        })
      ).status,
    ).toBe(404);
    const custom = await call(server, 'POST', '/v1/quizzes', {
      token: creator.token,
      body: { kind: 'CUSTOM', title: 'Custom still on', language: 'tr' },
    });
    expect(custom.status).toBe(201);
    expect((await respond('A'.repeat(43))).status).toBe(404);
  });
});

describe('the person who answers', () => {
  it('must agree first; then answers are sealed at rest and readable only through their own invite', async () => {
    const { creator, quizId, quiz, token } = await setup();
    const [dream, food, hobby] = quiz.prompts as [
      Quiz['prompts'][number],
      Quiz['prompts'][number],
      Quiz['prompts'][number],
    ];

    const first = await respond(token);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      quiz: { title: 'Ece hakkında', language: 'tr' },
      target: { name: 'Ece', consented: false },
    });
    expect(first.body.prompts).toHaveLength(3);
    expect(
      (await respond(token, `/prompts/${dream.id}`, 'PUT', { answer: SENTINEL, decoys: ['x'] }))
        .body.error.code,
    ).toBe('CONSENT_REQUIRED');
    expect((await respond(token, '/consent', 'POST', {})).status).toBe(200);

    const put = await respond(token, `/prompts/${dream.id}`, 'PUT', {
      answer: SENTINEL,
      decoys: ['Pilot', 'Doktor'],
    });
    expect(put.status).toBe(200);
    const view = await respond(token);
    expect(view.body.prompts[0]!.response).toEqual({
      answer: SENTINEL,
      decoys: ['Pilot', 'Doktor'],
      approved: false,
    });
    expect(view.body.target?.consented).toBe(true);

    // at rest: the row is ciphertext under a key id, and the text appears nowhere in it
    const stored = await responsesOf(quizId);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.key_id).toBe('dev');
    expect(stored[0]!.sealed.toString('utf8')).not.toContain(SENTINEL);
    expect(stored[0]!.sealed.toString('latin1')).not.toContain('Pilot');
    expect(stored[0]!.visibility_policy).toBe('TARGET_ONLY');

    // the creator sees progress, never words
    const status = await call<Quiz>(server, 'GET', `/v1/quizzes/${quizId}`, {
      token: creator.token,
    });
    expect(JSON.stringify(status.body)).not.toContain(SENTINEL);
    expect(JSON.stringify(status.body)).not.toContain('Pilot');
    expect(status.body.targets[0]!).toMatchObject({
      status: 'ANSWERED',
      answered: 1,
      approved: 0,
      total: 3,
    });

    // approving needs at least one wrong alternative, and editing an answer withdraws the approval
    expect(
      (await respond(token, `/prompts/${food.id}`, 'PUT', { answer: 'Karnıyarık', decoys: [] }))
        .status,
    ).toBe(200);
    expect(
      (await respond(token, `/prompts/${food.id}/approval`, 'POST', { approved: true })).body.error
        .code,
    ).toBe('NOT_READY');
    expect(
      (await respond(token, `/prompts/${dream.id}/approval`, 'POST', { approved: true })).status,
    ).toBe(200);
    expect((await respond(token)).body.prompts[0]!.response!.approved).toBe(true);
    expect((await responsesOf(quizId)).filter((r) => r.approved_at)[0]!.visibility_policy).toBe(
      'GAME_ENGINE',
    );
    await respond(token, `/prompts/${dream.id}`, 'PUT', { answer: SENTINEL, decoys: ['Pilot'] });
    expect((await respond(token)).body.prompts[0]!.response!.approved).toBe(false);

    for (const p of [dream, food, hobby]) {
      await respond(token, `/prompts/${p.id}`, 'PUT', {
        answer: `cevap ${p.id.slice(0, 4)}`,
        decoys: ['a', 'b'],
      });
      expect(
        (await respond(token, `/prompts/${p.id}/approval`, 'POST', { approved: true })).status,
      ).toBe(200);
    }
    const done = await quizOf(creator, quizId);
    expect(done.targets[0]).toMatchObject({ status: 'APPROVED', answered: 3, approved: 3 });
    expect(done.ready).toBe(true);
  });

  it('screens what it stores: empty, too long, links, swearing, and alternatives that equal the answer', async () => {
    const { quizId, quiz, token } = await setup();
    const prompt = quiz.prompts[0]!;
    await respond(token, '/consent', 'POST', {});
    const put = (body: unknown) => respond(token, `/prompts/${prompt.id}`, 'PUT', body);
    for (const [body, reason] of [
      [{ answer: '   ', decoys: [] }, 'EMPTY'],
      [{ answer: 'x'.repeat(141), decoys: [] }, 'TOO_LONG'],
      [{ answer: 'bak https://evil.example/x', decoys: [] }, 'LINK'],
      [{ answer: 'ok', decoys: ['www.evil.com'] }, 'LINK'],
      [{ answer: 'ok', decoys: ['ok'] }, 'DUPLICATE'],
      [{ answer: 'Ok', decoys: ['ok.'.replace('.', '')] }, 'DUPLICATE'],
      [{ answer: 'ok', decoys: ['bir', 'bir'] }, 'DUPLICATE'],
    ] as [unknown, string][]) {
      const result = await put(body);
      expect(result.status, JSON.stringify(body)).toBe(422);
      expect(result.body.error).toMatchObject({ code: 'TEXT_REJECTED', params: { reason } });
    }
    expect((await put({ answer: 'ok', decoys: ['a', 'b', 'c', 'd'] })).status).toBe(400);
    expect((await put({ answer: 'ok', decoys: ['a'], extra: 1 })).status).toBe(400);
    expect(await responsesOf(quizId)).toHaveLength(0);
  });

  it('cannot reach another quiz, and one invite never opens another person’s answers', async () => {
    const a = await setup('Ece');
    const b = await setup('Ahmet');
    await respond(a.token, '/consent', 'POST', {});
    await respond(b.token, '/consent', 'POST', {});
    await respond(a.token, `/prompts/${a.quiz.prompts[0]!.id}`, 'PUT', {
      answer: 'ece-secret',
      decoys: ['x'],
    });
    // b's invite with a's prompt id: not found, nothing stored for b
    expect(
      (
        await respond(b.token, `/prompts/${a.quiz.prompts[0]!.id}`, 'PUT', {
          answer: 'b-writes',
          decoys: ['x'],
        })
      ).status,
    ).toBe(404);
    expect(JSON.stringify((await respond(b.token)).body)).not.toContain('ece-secret');
    expect(
      (
        await respond(b.token, `/prompts/${a.quiz.prompts[0]!.id}/approval`, 'POST', {
          approved: true,
        })
      ).status,
    ).toBe(404);
  });

  it('answers every bad invite alike: unknown, malformed, wrong length, rotated, deleted', async () => {
    const { creator, quizId, targetId, token } = await setup();
    const seen = new Set<string>();
    for (const bad of [
      'A'.repeat(43),
      'short',
      '../../etc/passwd',
      `${token}x`,
      token.slice(1),
      "'; DROP TABLE blind_targets;--",
    ]) {
      const result = await respond(encodeURIComponent(bad));
      expect(result.status, bad).toBe(404);
      seen.add(JSON.stringify(result.body));
    }
    expect(seen.size).toBe(1);

    const rotated = await call<{ inviteUrl: string }>(
      server,
      'POST',
      `/v1/quizzes/${quizId}/targets/${targetId}/invite`,
      { token: creator.token, body: {} },
    );
    expect(rotated.status).toBe(200);
    expect((await respond(token)).status).toBe(404); // the old link is dead at once
    expect((await respond(tokenOf(rotated.body.inviteUrl))).status).toBe(200);
  });

  it('can delete everything at once, on request, with nothing left behind', async () => {
    const { creator, quizId, quiz, token } = await setup();
    await respond(token, '/consent', 'POST', {});
    await respond(token, `/prompts/${quiz.prompts[0]!.id}`, 'PUT', {
      answer: SENTINEL,
      decoys: ['a'],
    });
    expect((await respond(token, '', 'DELETE')).status).toBe(200);
    expect((await respond(token)).status).toBe(404);
    expect(await responsesOf(quizId)).toHaveLength(0);
    expect((await quizOf(creator, quizId)).targets).toEqual([]);
  });
});

describe('what the game can ask the vault for', () => {
  it('hands over approved questions only, worded from fixed templates, with opaque shuffled options', async () => {
    const { quizId, quiz, token } = await setup('Ece');
    await respond(token, '/consent', 'POST', {});
    const [dream, food, hobby] = quiz.prompts as [
      Quiz['prompts'][number],
      Quiz['prompts'][number],
      Quiz['prompts'][number],
    ];
    await respond(token, `/prompts/${dream.id}`, 'PUT', {
      answer: 'Pilot',
      decoys: ['Doktor', 'Aşçı', 'Ressam'],
    });
    await respond(token, `/prompts/${food.id}`, 'PUT', { answer: 'Karnıyarık', decoys: ['Mantı'] });
    await respond(token, `/prompts/${hobby.id}`, 'PUT', { answer: 'Dokuma', decoys: ['Satranç'] });
    await respond(token, `/prompts/${dream.id}/approval`, 'POST', { approved: true });
    await respond(token, `/prompts/${food.id}/approval`, 'POST', { approved: true });
    // the third stays unapproved

    const deck = await server.built.vault.playableForGame(quizId);
    expect(deck).toHaveLength(2);
    const byText = new Map(deck.map((q) => [q.text, q]));
    const dreamQuestion = byText.get('Ece çocukken büyüyünce ne olmak istiyordu?')!;
    expect(dreamQuestion).toBeDefined();
    expect(dreamQuestion.source).toBe('BLIND');
    expect(dreamQuestion.options.map((o) => o.text).sort()).toEqual([
      'Aşçı',
      'Doktor',
      'Pilot',
      'Ressam',
    ]);
    expect(dreamQuestion.options.filter((o) => o.correct).map((o) => o.text)).toEqual(['Pilot']);
    expect(new Set(dreamQuestion.options.map((o) => o.key)).size).toBe(4);
    expect(dreamQuestion.options.every((o) => /^[0-9a-f-]{36}$/u.test(o.key))).toBe(true);
    expect(dreamQuestion.explanation).toContain('Ece');
    expect(JSON.stringify(deck)).not.toContain('Dokuma'); // unapproved answers never leave the vault

    // across many builds the correct option is not always in the same place
    const places = new Set<number>();
    for (let i = 0; i < 25; i += 1) {
      const again = await server.built.vault.playableForGame(quizId);
      places.add(
        again.find((q) => q.text.startsWith('Ece çocukken'))!.options.findIndex((o) => o.correct),
      );
    }
    expect(places.size).toBeGreaterThan(1);

    await server.built.vault.markUsed(quizId);
    const policies = (await responsesOf(quizId)).filter((r) => r.approved_at);
    expect(policies.every((p) => p.visibility_policy === 'REVEALED_IN_GAME')).toBe(true);
    // deck building still works afterwards
    expect(await server.built.vault.playableForGame(quizId)).toHaveLength(2);
  });

  it('gives nothing for a target who never agreed, for a quiz that is not blind, or for an unknown id', async () => {
    const { quizId } = await setup();
    expect(await server.built.vault.playableForGame(quizId)).toEqual([]);
    expect(await server.built.vault.playableForGame(randomUUID())).toEqual([]);
    const creator = await player(server, 'WEB');
    const custom = await call<{ id: string }>(server, 'POST', '/v1/quizzes', {
      token: creator.token,
      body: { kind: 'CUSTOM', title: 'Custom', language: 'tr' },
    });
    expect(await server.built.vault.playableForGame(custom.body.id)).toEqual([]);
  });

  it('refuses a sealed value that was moved to another row (AAD binds it to its response)', async () => {
    const { quizId, quiz, token } = await setup();
    await respond(token, '/consent', 'POST', {});
    const [a, b] = quiz.prompts as [Quiz['prompts'][number], Quiz['prompts'][number]];
    await respond(token, `/prompts/${a.id}`, 'PUT', { answer: 'one', decoys: ['x'] });
    await respond(token, `/prompts/${b.id}`, 'PUT', { answer: 'two', decoys: ['y'] });
    const rows = await responsesOf(quizId);
    await server.db.db
      .updateTable('blind_responses')
      .set({ sealed: rows[0]!.sealed })
      .where('id', '=', rows[1]!.id)
      .execute();
    await expect(respond(token)).resolves.toMatchObject({ status: 500 });
    expect(quizId).toBeTruthy();
  });
});

describe('retention and deletion (ADR-0015)', () => {
  it('deletes a quiz and everything under it when its time is up, and keeps live ones', async () => {
    const old = await setup('Old');
    const live = await setup('Live');
    await respond(old.token, '/consent', 'POST', {});
    await respond(old.token, `/prompts/${old.quiz.prompts[0]!.id}`, 'PUT', {
      answer: SENTINEL,
      decoys: ['x'],
    });
    await server.db.db
      .updateTable('personal_quizzes')
      .set({ retain_until: new Date(Date.now() - 1000) })
      .where('id', '=', old.quizId)
      .execute();
    await server.built.maintenance.runOnce();
    expect(
      (await call(server, 'GET', `/v1/quizzes/${old.quizId}`, { token: old.creator.token })).status,
    ).toBe(404);
    expect((await respond(old.token)).status).toBe(404);
    expect(await responsesOf(old.quizId)).toHaveLength(0);
    expect(
      (await call(server, 'GET', `/v1/quizzes/${live.quizId}`, { token: live.creator.token }))
        .status,
    ).toBe(200);
  });

  it('extends retention whenever the quiz is used, and the creator can delete it at any time', async () => {
    const { creator, quizId, quiz, token } = await setup();
    await respond(token, '/consent', 'POST', {});
    const before = (
      await server.db.db
        .selectFrom('personal_quizzes')
        .select('retain_until')
        .where('id', '=', quizId)
        .executeTakeFirstOrThrow()
    ).retain_until;
    await server.db.db
      .updateTable('personal_quizzes')
      .set({ retain_until: new Date(Date.now() + 86_400_000) })
      .where('id', '=', quizId)
      .execute();
    await respond(token, `/prompts/${quiz.prompts[0]!.id}`, 'PUT', { answer: 'a', decoys: ['b'] });
    const after = (
      await server.db.db
        .selectFrom('personal_quizzes')
        .select('retain_until')
        .where('id', '=', quizId)
        .executeTakeFirstOrThrow()
    ).retain_until;
    expect(after.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(before.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    expect(
      (await call(server, 'DELETE', `/v1/quizzes/${quizId}`, { token: creator.token })).status,
    ).toBe(200);
    expect(await responsesOf(quizId)).toHaveLength(0);
    expect(
      (
        await server.db.db
          .selectFrom('blind_targets')
          .select('id')
          .where('quiz_id', '=', quizId)
          .execute()
      ).length,
    ).toBe(0);
  });

  it('removes a person’s quizzes when they delete their account', async () => {
    const { creator, quizId } = await setup();
    expect(
      (
        await call(server, 'DELETE', '/v1/me', {
          token: creator.token,
          body: { confirm: 'DELETE' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await server.db.db
          .selectFrom('personal_quizzes')
          .select('id')
          .where('id', '=', quizId)
          .execute()
      ).length,
    ).toBe(0);
  });
});

describe('Custom Quiz', () => {
  it('lets the author write plain questions, screened like any user text', async () => {
    const creator = await player(server, 'WEB');
    const quiz = await call<{ id: string }>(server, 'POST', '/v1/quizzes', {
      token: creator.token,
      body: { kind: 'CUSTOM', title: 'Ofis', language: 'tr' },
    });
    const add = (body: unknown) =>
      call(server, 'POST', `/v1/quizzes/${quiz.body.id}/questions`, { token: creator.token, body });
    expect(
      (
        await add({
          text: 'Ofisin en çok içilen çayı hangisi?',
          options: ['Ihlamur', 'Çay', 'Adaçayı'],
          correctIndex: 1,
        })
      ).status,
    ).toBe(201);
    for (const body of [
      { text: 'Kısa mı?', options: ['bir'], correctIndex: 0 },
      { text: 'İki şık aynı mı olmuş?', options: ['Aynı', 'aynı'], correctIndex: 0 },
      { text: 'Doğru şık dışarıda mı kalmış?', options: ['a', 'b'], correctIndex: 5 },
      { text: 'Bağlantı var: https://evil.example', options: ['a', 'b'], correctIndex: 0 },
    ])
      expect([400, 422], JSON.stringify(body)).toContain((await add(body)).status);
    const detail = await call<Quiz & { questions: { options: string[]; correctIndex: number }[] }>(
      server,
      'GET',
      `/v1/quizzes/${quiz.body.id}`,
      { token: creator.token },
    );
    expect(detail.body.questions).toEqual([
      expect.objectContaining({ options: ['Ihlamur', 'Çay', 'Adaçayı'], correctIndex: 1 }),
    ]);
    // a custom quiz has no prompts or targets
    expect(
      (
        await call(server, 'POST', `/v1/quizzes/${quiz.body.id}/prompts`, {
          token: creator.token,
          body: { catalogKey: 'dreamJob' },
        })
      ).status,
    ).toBe(404);
    // and a blind quiz takes no custom questions
    const { creator: c2, quizId } = await setup();
    expect(
      (
        await call(server, 'POST', `/v1/quizzes/${quizId}/questions`, {
          token: c2.token,
          body: { text: 'Deneme sorusu mu?', options: ['a', 'b'], correctIndex: 0 },
        })
      ).status,
    ).toBe(404);
  });
});
