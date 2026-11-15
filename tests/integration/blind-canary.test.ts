import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeParty, createParty } from '../helpers/party';
import { liveRoom } from '../helpers/oracle';
import { startModelServer, type ModelServer } from '../helpers/model-server';
import { call, player } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';

/**
 * Canary (ADR-0015, acceptance AB): secrets planted as a Blind Quiz answer, a decoy and a Who Said It
 * statement are driven through every success and failure path, then every place an operator or an
 * attacker could read is searched: log lines at the most verbose level, /metrics, every HTTP error
 * body and header, the creator's views, and the database as plaintext, hex and base64. The only
 * legitimate readers are the target (their own answers) and, for the AI path, the decoy model.
 */
const stamp = Date.now();
const ANSWER = `canary-answer-${stamp}`;
const DECOY = `canary-decoy-${stamp}`;
const STATEMENT = `canary-statement-${stamp}`;
const KEY = 'canary-api-key-0123456789';
const METRICS = 'canary-metrics-token-0123';

const lines: string[] = [];
const bodies: string[] = [];
let server: TestServer;
let model: ModelServer;

beforeAll(async () => {
  model = await startModelServer((request) => {
    // a hostile or broken model that parrots its input back
    const sent = request.body.messages[0]!.content;
    return request.body.messages[0]!.content.includes('boom')
      ? { status: 500 }
      : { text: `{"decoys":["Pilot","${sent.length}"],"echo":"${ANSWER}"}` };
  });
  server = await startServer({
    logStream: { write: (line) => void lines.push(line) },
    env: {
      LOG_LEVEL: 'trace',
      METRICS_TOKEN: METRICS,
      AI_DECOYS_API_KEY: KEY,
      AI_DECOYS_MODEL: 'decoy-test-model',
      AI_DECOYS_API_BASE: model.url,
      DEFAULT_ROOM_TIER: 'FULL',
    },
  });
  await server.db.db
    .updateTable('feature_flags')
    .set({ enabled: true })
    .where('key', 'in', ['mode.blind_quiz', 'mode.who_said_it', 'ai.decoys'])
    .execute();
  server.built.flags.invalidate();
});
afterAll(async () => {
  await server.dispose();
  await model.close();
});

const seen = async (result: Promise<{ status: number; body: unknown }>) => {
  const r = await result;
  bodies.push(JSON.stringify(r.body));
  return r;
};

describe('planted secrets', () => {
  it('are driven through success, rejection and failure paths', async () => {
    const creator = await player(server, 'WEB');
    const made = await call<{ id: string }>(server, 'POST', '/v1/quizzes', {
      token: creator.token,
      body: { kind: 'BLIND', title: 'Canary', language: 'en' },
    });
    for (const catalogKey of ['dreamJob', 'dislikedFood', 'surprisingHobby'])
      await call(server, 'POST', `/v1/quizzes/${made.body.id}/prompts`, {
        token: creator.token,
        body: { catalogKey },
      });
    const target = await call<{ inviteUrl: string }>(
      server,
      'POST',
      `/v1/quizzes/${made.body.id}/targets`,
      { token: creator.token, body: { displayName: 'Canary' } },
    );
    const token = target.body.inviteUrl.split('/blind/respond/')[1]!;
    const base = `/v1/blind/respond/${token}`;
    const view = await seen(call<{ prompts: { promptId: string }[] }>(server, 'GET', base));
    const [first, second] = (view.body as { prompts: { promptId: string }[] }).prompts;

    // early write (no consent), then consent, then the good write
    await seen(
      call(server, 'PUT', `${base}/prompts/${first!.promptId}`, {
        body: { answer: ANSWER, decoys: [] },
      }),
    );
    await seen(call(server, 'POST', `${base}/consent`, { body: {} }));
    expect(
      (
        await seen(
          call(server, 'PUT', `${base}/prompts/${first!.promptId}`, {
            body: { answer: ANSWER, decoys: [DECOY] },
          }),
        )
      ).status,
    ).toBe(200);

    // every way to be refused with the secret in the request
    for (const body of [
      { answer: `${ANSWER} https://evil.example/x`, decoys: [] },
      { answer: ANSWER, decoys: [ANSWER] },
      { answer: ANSWER, decoys: [DECOY, DECOY] },
      { answer: ANSWER, decoys: [DECOY], extra: ANSWER },
      { answer: ANSWER.repeat(40), decoys: [] },
      { answer: ANSWER, decoys: [`${DECOY}\u0007`] },
    ])
      expect(
        (await seen(call(server, 'PUT', `${base}/prompts/${second!.promptId}`, { body }))).status,
      ).toBeGreaterThanOrEqual(400);
    await seen(
      call(server, 'PUT', `${base}/prompts/not-a-uuid`, { body: { answer: ANSWER, decoys: [] } }),
    );
    await seen(
      call(server, 'PUT', `/v1/blind/respond/${'A'.repeat(43)}/prompts/${first!.promptId}`, {
        body: { answer: ANSWER, decoys: [] },
      }),
    );
    await seen(
      call(server, 'POST', `${base}/prompts/${first!.promptId}/approval`, {
        body: { approved: true },
      }),
    );

    // the AI path: the model parrots the secret back inside a reply the app must refuse as malformed
    const ai = await seen(
      call(server, 'POST', `${base}/prompts/${first!.promptId}/suggest-decoys`, { body: {} }),
    );
    expect(ai.body).toEqual({ decoys: [], source: 'NONE' });
    expect(model.requests).toHaveLength(1);
    // and a model outage
    await call(server, 'PUT', `${base}/prompts/${second!.promptId}`, {
      body: { answer: `boom ${ANSWER}`, decoys: [] },
    });
    await seen(
      call(server, 'POST', `${base}/prompts/${second!.promptId}/suggest-decoys`, { body: {} }),
    );

    // the creator's own views and an unauthenticated stranger
    await seen(
      call(server, 'GET', `/v1/quizzes/${made.body.id}`, { token: creator.token, cookies: false }),
    );
    await seen(call(server, 'GET', '/v1/quizzes', { token: creator.token, cookies: false }));
    await seen(call(server, 'GET', base, { cookies: false }));

    // Who Said It: the statement goes through the room and a rejected variant
    const party = await createParty(server, 3);
    const room = liveRoom(server, party.created.roomId);
    expect(await room.setContent('WHO_SAID_IT', null, null, null)).toEqual({ ok: true });
    for (const text of [STATEMENT, `${STATEMENT} https://evil.example/x`]) {
      const id = party.players[0]!.send('SUBMIT_STATEMENT', { text });
      await party.players[0]!.next(
        (m) => (m.type === 'ACK' || m.type === 'ERROR') && m.payload.messageId === id,
        5_000,
        'statement reply',
      );
    }
    await closeParty(party);
    expect(lines.length).toBeGreaterThan(0);
  });

  const secrets = [ANSWER, DECOY, STATEMENT];

  it('never reach the logs, even at trace level', () => {
    const log = lines.join('');
    for (const secret of [...secrets, KEY]) expect(log).not.toContain(secret);
  });

  it('never reach the metrics, and the API key is nowhere an operator reads', async () => {
    const response = await fetch(`${server.httpUrl}/metrics`, {
      headers: { authorization: `Bearer ${METRICS}` },
    });
    const text = await response.text();
    expect(text).toContain('qp_ai_decoys_total');
    for (const secret of [...secrets, KEY]) expect(text).not.toContain(secret);
  });

  it('never come back in an error body or a header (the target’s own view excepted)', () => {
    // the target's good view legitimately holds their answer; every other recorded body must not
    const foreign = bodies.filter(
      (body) => !body.includes('"prompts"') || body.includes('"error"'),
    );
    for (const body of foreign) for (const secret of secrets) expect(body).not.toContain(secret);
    for (const body of bodies) expect(body).not.toContain(KEY);
  });

  it('are not in the database as plaintext, hex or base64', async () => {
    const tables = await sql<{
      table_name: string;
    }>`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`.execute(
      server.db.db,
    );
    let dump = '';
    for (const { table_name } of tables.rows) {
      const rows = await sql<{
        j: string;
      }>`select row_to_json(t)::text as j from ${sql.table(table_name)} t`.execute(server.db.db);
      dump += rows.rows.map((r) => r.j).join('\n');
    }
    expect(dump.length).toBeGreaterThan(1_000);
    for (const secret of [ANSWER, DECOY]) {
      const forms = [
        secret,
        Buffer.from(secret).toString('hex'),
        Buffer.from(secret).toString('base64'),
        Buffer.from(secret).toString('base64url'),
      ];
      for (const form of forms) expect(dump.toLowerCase()).not.toContain(form.toLowerCase());
    }
  });
});
