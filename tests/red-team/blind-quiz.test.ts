import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLES } from '../../apps/realtime/src/auth/accounts';
import { PersonalReports } from '../../apps/realtime/src/blind/reports';
import { adminApi, staff } from '../helpers/admin';
import { startModelServer, type ModelServer } from '../helpers/model-server';
import { call, player, type CookieJar, type Player } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';

/**
 * ATTACK 10 — the creator of a Blind Quiz tries to read the target's raw answers (GDD §11,
 * ADR-0015, acceptance AB). The creator holds the invite link (they hand it to the target), so the
 * link alone must never be enough to read, write or delete once the target has taken the invite.
 */
const ANSWER = `attack10-answer-${Date.now()}`;
const DECOY = `attack10-decoy-${Date.now()}`;
let server: TestServer;
let model: ModelServer;
let creator: Player;
let invite: string;
let promptIds: string[];
let quizId: string;
let targetId: string;
const targetBrowser: CookieJar = new Map();
const everything: string[] = [];

const save = async <T extends { status: number; body: unknown }>(
  pending: T | Promise<T>,
): Promise<T> => {
  const result = await pending;
  everything.push(JSON.stringify(result.body));
  return result;
};
const asCreator = (method: string, path: string, body?: unknown) =>
  save(
    call(server, method, path, {
      token: creator.token,
      cookies: false,
      ...(body !== undefined ? { body } : {}),
    }),
  );
const withInvite = (
  method: string,
  path = '',
  body?: unknown,
  opts: { jar?: CookieJar; cookies?: boolean } = {},
) =>
  call<Record<string, unknown>>(server, method, `/v1/blind/respond/${invite}${path}`, {
    ...(body !== undefined ? { body } : {}),
    ...opts,
  });

beforeAll(async () => {
  model = await startModelServer(() => ({
    text: JSON.stringify({ decoys: ['Pilot', 'Doktor', 'Aşçı'] }),
  }));
  server = await startServer({
    env: {
      AI_DECOYS_API_KEY: 'attack10-key-0123456789',
      AI_DECOYS_MODEL: 'decoy-test-model',
      AI_DECOYS_API_BASE: model.url,
    },
  });
  await server.db.db
    .updateTable('feature_flags')
    .set({ enabled: true })
    .where('key', 'in', ['mode.blind_quiz', 'ai.decoys'])
    .execute();
  server.built.flags.invalidate();

  creator = await player(server, 'WEB');
  const made = await call<{ id: string }>(server, 'POST', '/v1/quizzes', {
    token: creator.token,
    body: { kind: 'BLIND', title: 'Ece hakkında', language: 'tr' },
  });
  quizId = made.body.id;
  for (const catalogKey of ['dreamJob', 'dislikedFood', 'surprisingHobby'])
    await call(server, 'POST', `/v1/quizzes/${quizId}/prompts`, {
      token: creator.token,
      body: { catalogKey },
    });
  const target = await call<{ id: string; inviteUrl: string }>(
    server,
    'POST',
    `/v1/quizzes/${quizId}/targets`,
    {
      token: creator.token,
      body: { displayName: 'Ece' },
    },
  );
  targetId = target.body.id;
  invite = target.body.inviteUrl.split('/blind/respond/')[1]!;

  // the target, in their own browser, takes the invite and answers
  const view = await withInvite('GET', '', undefined, { jar: targetBrowser });
  promptIds = (view.body.prompts as { promptId: string }[]).map((p) => p.promptId);
  expect((await withInvite('POST', '/consent', {}, { jar: targetBrowser })).status).toBe(200);
  expect(
    (
      await withInvite(
        'PUT',
        `/prompts/${promptIds[0]}`,
        { answer: ANSWER, decoys: [DECOY] },
        { jar: targetBrowser },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await withInvite(
        'POST',
        `/prompts/${promptIds[0]}/suggest-decoys`,
        {},
        { jar: targetBrowser },
      )
    ).status,
  ).toBe(200);
});
afterAll(async () => {
  await server.dispose();
  await model.close();
});

describe('ATTACK 10: the creator reads a target’s answers', () => {
  it('the target, in their own browser, still reads their own answers', async () => {
    const mine = await withInvite('GET', '', undefined, { jar: targetBrowser });
    expect(JSON.stringify(mine.body)).toContain(ANSWER);
  });

  it('the invite link alone (what the creator holds) reads, writes, approves, suggests and deletes nothing', async () => {
    const attempts: [string, string, unknown?][] = [
      ['GET', ''],
      ['POST', '/consent', {}],
      ['PUT', `/prompts/${promptIds[0]}`, { answer: 'x', decoys: [] }],
      ['POST', `/prompts/${promptIds[0]}/approval`, { approved: true }],
      ['POST', `/prompts/${promptIds[0]}/suggest-decoys`, {}],
      ['DELETE', ''],
    ];
    for (const [method, path, body] of attempts) {
      const result = await save(withInvite(method, path, body, { cookies: false }));
      expect({ method, path, status: result.status }).toEqual({ method, path, status: 403 });
      expect(result.body.error).toMatchObject({ code: 'FORBIDDEN' });
    }
    // forged or guessed claims are no better
    for (const cookie of ['', 'qp_blind_x=1', `qp_blind_${'a'.repeat(16)}=${'b'.repeat(43)}`]) {
      const result = await save(
        call<Record<string, unknown>>(server, 'GET', `/v1/blind/respond/${invite}`, {
          cookies: false,
          headers: cookie ? { cookie } : {},
        }),
      );
      expect(result.status).toBe(403);
    }
    // nothing was damaged: the target still has their answer
    expect(
      JSON.stringify((await withInvite('GET', '', undefined, { jar: targetBrowser })).body),
    ).toContain(ANSWER);
  });

  it('rotating the invite after the target took it is refused (a fresh link would be a skeleton key)', async () => {
    const rotate = await asCreator('POST', `/v1/quizzes/${quizId}/targets/${targetId}/invite`);
    expect(rotate.status).toBe(409);
    expect(JSON.stringify(rotate.body)).not.toContain('/blind/respond/');
  });

  it('a creator who takes the invite first only locks themselves in: the target is refused, nothing leaks', async () => {
    const other = await call<{ id: string; inviteUrl: string }>(
      server,
      'POST',
      `/v1/quizzes/${quizId}/targets`,
      {
        token: creator.token,
        body: { displayName: 'Deniz' },
      },
    );
    const token = other.body.inviteUrl.split('/blind/respond/')[1]!;
    const creatorBrowser: CookieJar = new Map();
    const consent = await call(server, 'POST', `/v1/blind/respond/${token}/consent`, {
      body: {},
      jar: creatorBrowser,
    });
    expect(consent.status).toBe(200);
    const late = await call<Record<string, unknown>>(server, 'GET', `/v1/blind/respond/${token}`, {
      cookies: false,
    });
    expect(late.status).toBe(403);
    // the creator’s browser only ever sees what the creator wrote themselves
    await call(server, 'PUT', `/v1/blind/respond/${token}/prompts/${promptIds[0]}`, {
      body: { answer: 'creator wrote this', decoys: [] },
      jar: creatorBrowser,
    });
    const status = await asCreator('GET', `/v1/quizzes/${quizId}`);
    expect(JSON.stringify(status.body)).not.toContain(ANSWER);
  });

  it('every registered route, replayed as creator, another player, nobody and each staff role, never carries an answer', async () => {
    // a player reported the target's question (acceptance AC): the moderation queue must not leak it either
    const response = await server.db.db
      .selectFrom('blind_responses')
      .select('id')
      .where('target_id', '=', targetId)
      .executeTakeFirstOrThrow();
    const reported = await new PersonalReports(server.db.db, server.config.serverSecret, {
      now: () => Date.now(),
    }).submit({
      quizId,
      kind: 'BLIND',
      questionId: response.id,
      sessionId: 'attack10-reporter',
      roomId: quizId,
      reason: 'OFFENSIVE',
    });
    expect(reported).toBe(true);
    const other = await player(server, 'WEB');
    const members = await Promise.all(ROLES.map((role) => staff(server, [role])));
    const fill = (url: string): string =>
      url
        .replace(':token', invite)
        .replace(':promptId', promptIds[0]!)
        .replace(':sub', targetId)
        .replace(':id', quizId)
        .replace(/:[A-Za-z]+/gu, 'x');
    const audiences: { name: string; headers: Record<string, string> }[] = [
      { name: 'creator', headers: { authorization: `Bearer ${creator.token}` } },
      { name: 'other player', headers: { authorization: `Bearer ${other.token}` } },
      { name: 'anonymous', headers: {} },
      ...members.map((m) => ({
        name: `staff ${m.roles.join()}`,
        headers: { authorization: `Bearer ${m.token}` },
      })),
    ];
    let replayed = 0;
    for (const route of server.built.routes) {
      if (
        ['DELETE', 'POST', 'PUT', 'PATCH'].includes(route.method) &&
        /quizzes|blind|rooms|accounts|admin/u.test(route.url) === false
      )
        continue;
      // destructive calls on the quiz itself would end the scenario for the next audience
      if (route.method === 'DELETE' || route.url === '/v1/quizzes/:id/targets/:sub') continue;
      for (const audience of audiences) {
        const response = await fetch(`${server.httpUrl}${fill(route.url)}`, {
          method: route.method,
          headers: {
            ...audience.headers,
            ...(route.method === 'GET' ? {} : { 'content-type': 'application/json' }),
          },
          ...(route.method === 'GET' ? {} : { body: '{}' }),
        });
        const text = await response.text();
        const headers = JSON.stringify([...response.headers]);
        expect({
          route: `${route.method} ${route.url}`,
          audience: audience.name,
          leak: text.includes(ANSWER) || text.includes(DECOY) || headers.includes(ANSWER),
        }).toEqual({
          route: `${route.method} ${route.url}`,
          audience: audience.name,
          leak: false,
        });
        replayed += 1;
      }
    }
    expect(replayed).toBeGreaterThan(100);
    // the admin API too, by name, for the roles the ADR calls out
    for (const member of members) {
      const api = adminApi(server, member);
      for (const path of [
        '/v1/admin/reports',
        '/v1/admin/personal-reports',
        '/v1/admin/rooms',
        '/v1/admin/incidents',
      ]) {
        const result = await api.call('GET', path);
        expect(result.text).not.toContain(ANSWER);
      }
    }
  });

  it('the answer reached nothing but the target and, on request, the decoy model', () => {
    expect(everything.join('\n')).not.toContain(ANSWER);
    expect(everything.join('\n')).not.toContain(DECOY);
    expect(model.requests).toHaveLength(1);
  });
});
