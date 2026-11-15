import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pseudonym } from '../../apps/realtime/src/security/crypto';
import { TestClient } from '../helpers/client';
import { closeParty, createParty, type Party } from '../helpers/party';
import { autoAnswer } from '../helpers/play';
import { createRoom, FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';
import { waitUntil } from '../helpers/wait';

/**
 * Reports, feature flags and bans over the real server (GDD §10, §22, §23). The reveal is held for
 * a few seconds so that a test has time to act inside it; everything else is the production path.
 */
const SLOW_REVEAL = {
  ...FAST_GAME_CONFIG,
  timings: { ...FAST_GAME_CONFIG.timings, revealMs: 4000, scoreUpdateMs: 4000 },
};

let server: TestServer;
beforeAll(async () => {
  server = await startServer({ gameConfig: SLOW_REVEAL });
});
afterAll(async () => {
  await server.dispose();
});
beforeEach(async () => {
  await server.db.db.deleteFrom('question_reports').execute();
  await server.db.db.deleteFrom('bans').execute();
  await server.db.db
    .updateTable('feature_flags')
    .set({ enabled: true })
    .where('key', '=', 'report.questions')
    .execute();
  server.built.flags.invalidate();
});

/** Starts a game and returns the party at the moment the first question is revealed. */
async function atReveal(playerCount = 2): Promise<{ party: Party; questionId: string }> {
  const party = await createParty(server, playerCount);
  party.players.forEach((client, i) => autoAnswer(client, i));
  party.leader.send('START_GAME', {});
  await party.leader.nextOfType('ACK');
  const reveal = await party.players[0]!.waitForPhase('REVEAL', 15_000);
  const data = reveal.payload.data;
  if (data.phase !== 'REVEAL') throw new Error('not a reveal');
  return { party, questionId: data.questionId };
}

const reportRows = () => server.db.db.selectFrom('question_reports').selectAll().execute();

describe('reporting a question', () => {
  it('records one report per player for the question just revealed and acknowledges it', async () => {
    const { party, questionId } = await atReveal(3);
    const [first, second] = party.players as [TestClient, TestClient];
    const id = first.send('REPORT_QUESTION', { questionId, reason: 'WRONG_ANSWER' });
    const ack = await first.next(
      (m) => m.type === 'ACK' && m.payload.messageId === id,
      3_000,
      'ack',
    );
    expect(ack.type).toBe('ACK');

    // The same player changing their mind replaces the report; a second player adds one.
    first.send('REPORT_QUESTION', { questionId, reason: 'TYPO' });
    second.send('REPORT_QUESTION', { questionId, reason: 'OUTDATED' });
    await waitUntil(async () => (await reportRows()).length === 2, 3_000);
    await first.idle(150);
    const rows = await reportRows();
    expect(rows.map((row) => row.reason).sort()).toEqual(['OUTDATED', 'TYPO']);
    expect(
      rows.every(
        (row) =>
          row.question_id === questionId &&
          row.room_id === party.created.roomId &&
          row.status === 'OPEN',
      ),
    ).toBe(true);
    // Who reported is a keyed pseudonym: never the session id, the player id or the nickname.
    for (const row of rows) {
      for (const client of party.players)
        for (const secret of [client.sessionId!, client.playerId!, 'Oyuncu'])
          expect(row.reporter_hash).not.toContain(secret);
    }
    const question = await server.db.db
      .selectFrom('questions')
      .select('report_count')
      .where('id', '=', questionId)
      .executeTakeFirstOrThrow();
    expect(Number(question.report_count)).toBe(2);
    await closeParty(party);
  });

  it('refuses a report before the answer is public, for another question, from the TV, and for a feature that is off', async () => {
    const party = await createParty(server, 2);
    party.players.forEach((client, i) => autoAnswer(client, i));
    const [phone] = party.players as [TestClient, TestClient];
    // Lobby: there is no question yet.
    phone.send('REPORT_QUESTION', { questionId: randomUUID(), reason: 'TYPO' });
    expect((await phone.nextOfType('ERROR')).payload.code).toBe('INVALID_STATE');

    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    const answering = await phone.waitForPhase('ANSWERING', 15_000);
    const live = answering.payload.data;
    if (live.phase !== 'ANSWERING') throw new Error('not answering');
    // While the question is open its answer is secret, and so is the right to flag it.
    phone.send('REPORT_QUESTION', { questionId: live.questionId, reason: 'WRONG_ANSWER' });
    expect((await phone.nextOfType('ERROR')).payload.code).toBe('INVALID_STATE');

    await phone.waitForPhase('REVEAL', 15_000);
    phone.send('REPORT_QUESTION', { questionId: randomUUID(), reason: 'WRONG_ANSWER' });
    expect((await phone.nextOfType('ERROR')).payload.code).toBe('QUESTION_MISMATCH');
    party.display.send('REPORT_QUESTION', { questionId: live.questionId, reason: 'WRONG_ANSWER' });
    expect((await party.display.nextOfType('ERROR')).payload.code).toBe('FORBIDDEN');

    await server.db.db
      .updateTable('feature_flags')
      .set({ enabled: false })
      .where('key', '=', 'report.questions')
      .execute();
    server.built.flags.invalidate();
    phone.send('REPORT_QUESTION', { questionId: live.questionId, reason: 'WRONG_ANSWER' });
    expect((await phone.nextOfType('ERROR')).payload.code).toBe('FEATURE_DISABLED');
    expect(await reportRows()).toEqual([]);
    await closeParty(party);
  });

  it('only accepts the reasons of the protocol, and nothing else in the message', async () => {
    const { party, questionId } = await atReveal(2);
    const [phone] = party.players as [TestClient, TestClient];
    phone.send('REPORT_QUESTION', { questionId, reason: 'I_DISLIKE_IT' });
    expect((await phone.nextOfType('ERROR')).payload.code).toBe('INVALID_MESSAGE');
    phone.send('REPORT_QUESTION', { questionId, reason: 'TYPO', note: 'bkz http://kotu.example' });
    expect((await phone.nextOfType('ERROR')).payload.code).toBe('INVALID_MESSAGE');
    expect(await reportRows()).toEqual([]);
    await closeParty(party);
  });
});

describe('public feature flags', () => {
  it('lists the public switches and never a private one', async () => {
    const response = await fetch(`${server.httpUrl}/v1/flags`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { flags: Record<string, boolean> };
    expect(body.flags['report.questions']).toBe(true);
    expect(body.flags['mode.blind_quiz']).toBe(false);
    expect(Object.keys(body.flags)).not.toContain('sabotage.noise');
    expect(Object.keys(body.flags)).not.toContain('ai.decoys');
  });

  it('follows a change once the cache is refreshed', async () => {
    await server.db.db
      .updateTable('feature_flags')
      .set({ enabled: true })
      .where('key', '=', 'mode.blind_quiz')
      .execute();
    server.built.flags.invalidate();
    const body = (await (await fetch(`${server.httpUrl}/v1/flags`)).json()) as {
      flags: Record<string, boolean>;
    };
    expect(body.flags['mode.blind_quiz']).toBe(true);
    await server.db.db
      .updateTable('feature_flags')
      .set({ enabled: false })
      .where('key', '=', 'mode.blind_quiz')
      .execute();
    server.built.flags.invalidate();
  });
});

describe('bans', () => {
  const ipHash = () => pseudonym(server.config.serverSecret, 'ip', '127.0.0.1');
  const deviceHash = (deviceId: string) =>
    pseudonym(server.config.serverSecret, 'device', deviceId);
  const ban = (
    kind: 'IP' | 'DEVICE',
    subject: string,
    extra: { expiresAt?: Date; lifted?: boolean } = {},
  ) =>
    server.db.db
      .insertInto('bans')
      .values({
        kind,
        subject_hash: subject,
        reason: 'test ban',
        expires_at: extra.expiresAt ?? null,
        lifted_at: extra.lifted ? new Date() : null,
      })
      .execute();

  it('blocks a banned device from joining any room, and only that device', async () => {
    const created = await createRoom(server);
    const blocked = 'blocked-device-0123456789abcdef';
    await ban('DEVICE', deviceHash(blocked));
    const bad = await TestClient.connect(server.wsUrl);
    bad.send(
      'JOIN_ROOM',
      {
        code: created.code,
        nickname: 'Kotu',
        avatarId: 'fox',
        deviceId: blocked,
        client: { kind: 'WEB', version: 't' },
      },
      { roomId: null, sessionId: null },
    );
    expect((await bad.nextOfType('ERROR')).payload.code).toBe('BANNED');
    // The answer does not depend on the room: a wrong code gets the same answer.
    bad.send(
      'JOIN_ROOM',
      {
        code: 'ZZZZZZ',
        nickname: 'Kotu',
        avatarId: 'fox',
        deviceId: blocked,
        client: { kind: 'WEB', version: 't' },
      },
      { roomId: null, sessionId: null },
    );
    expect((await bad.nextOfType('ERROR')).payload.code).toBe('BANNED');
    const good = await TestClient.connect(server.wsUrl);
    await expect(good.join(server.wsUrl, created.code, 'Iyi')).resolves.toBeDefined();
    await Promise.all([bad.close(), good.close()]);
  });

  it('blocks a banned address from creating rooms, joining and reconnecting; lifting or expiry ends it', async () => {
    const created = await createRoom(server);
    const player = await TestClient.connect(server.wsUrl);
    await player.join(server.wsUrl, created.code, 'Ece');
    await ban('IP', ipHash());

    const response = await fetch(`${server.httpUrl}/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: { kind: 'DISPLAY', version: 't' } }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'BANNED' } });

    const late = await TestClient.connect(server.wsUrl);
    late.send(
      'JOIN_ROOM',
      {
        code: created.code,
        nickname: 'Can',
        avatarId: 'fox',
        deviceId: `dev-${randomUUID().replaceAll('-', '')}`,
        client: { kind: 'WEB', version: 't' },
      },
      { roomId: null, sessionId: null },
    );
    expect((await late.nextOfType('ERROR')).payload.code).toBe('BANNED');

    // A player who was already in cannot come back with a valid token either.
    player.drop();
    const back = await TestClient.connect(server.wsUrl);
    back.sessionId = player.sessionId;
    back.roomId = player.roomId;
    back.token = player.token;
    back.send('RECONNECT', { reconnectToken: player.token, client: { kind: 'WEB', version: 't' } });
    expect((await back.nextOfType('ERROR')).payload.code).toBe('BANNED');
    await waitUntil(() => back.closeInfo !== null, 2_000);
    expect(back.closeInfo?.code).toBe(4003);

    await server.db.db.updateTable('bans').set({ lifted_at: new Date() }).execute();
    expect(
      (
        await fetch(`${server.httpUrl}/v1/rooms`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client: { kind: 'DISPLAY', version: 't' } }),
        })
      ).status,
    ).toBe(201);

    await ban('IP', ipHash(), { expiresAt: new Date(Date.now() - 1000) });
    expect(
      (
        await fetch(`${server.httpUrl}/v1/rooms`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client: { kind: 'DISPLAY', version: 't' } }),
        })
      ).status,
    ).toBe(201);
    await Promise.all([late.close(), back.close()]);
  });

  it('stores the pseudonyms of address and device with every session so a moderator can ban from a live room', async () => {
    const created = await createRoom(server);
    const device = 'dev-observed-0123456789abcdef';
    const phone = await TestClient.connect(server.wsUrl);
    await phone.join(server.wsUrl, created.code, 'Gozlenen', device);
    const row = await server.db.db
      .selectFrom('room_sessions')
      .select(['ip_hash', 'device_hash'])
      .where('id', '=', phone.sessionId!)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ ip_hash: ipHash(), device_hash: deviceHash(device) });
    const display = await server.db.db
      .selectFrom('room_sessions')
      .select('ip_hash')
      .where('id', '=', created.display.sessionId)
      .executeTakeFirstOrThrow();
    expect(display.ip_hash).toBe(ipHash());
    await phone.close();
  });
});

describe('the maintenance job', () => {
  it('runs on demand, never twice at once, and reports what it moved', async () => {
    const [first, second] = await Promise.all([
      server.built.maintenance.runOnce(),
      server.built.maintenance.runOnce(),
    ]);
    expect([first, second].filter((report) => report === null)).toHaveLength(1);
    const done = first ?? second;
    expect(done).toEqual({ expired: 0, reverify: 0, telemetry: 0, ran: true });
  });
});
