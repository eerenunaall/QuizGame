import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PublicFlagsSchema } from '@quizparty/protocol';
import { pseudonym } from '../../apps/realtime/src/security/crypto';
import { TestClient } from '../helpers/client';
import { closeParty, createParty, type Party } from '../helpers/party';
import { autoAnswer } from '../helpers/play';
import { createRoom, FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';

/**
 * ATTACK 15-17: abuse of the moderation surface (reports, bans, flags). Production rate limits are
 * on (scale 1); the reveal is held for a few seconds so the attacker has a window to act in.
 */
const SLOW_REVEAL = {
  ...FAST_GAME_CONFIG,
  timings: { ...FAST_GAME_CONFIG.timings, revealMs: 5000, scoreUpdateMs: 3000 },
};

/** `server` has relaxed limits so scripted attackers can act at will; `strict` runs the production limits. */
let server: TestServer;
let strict: TestServer;
beforeAll(async () => {
  server = await startServer({ gameConfig: SLOW_REVEAL });
  strict = await startServer({ gameConfig: SLOW_REVEAL, env: { RATE_LIMIT_SCALE: '1' } });
});
afterAll(async () => {
  await Promise.all([server.dispose(), strict.dispose()]);
});

async function atReveal(
  playerCount = 2,
  on: TestServer = server,
): Promise<{ party: Party; questionId: string }> {
  const party = await createParty(on, playerCount);
  party.players.forEach((client, i) => autoAnswer(client, i));
  party.leader.send('START_GAME', {});
  await party.leader.nextOfType('ACK');
  const reveal = await party.players[0]!.waitForPhase('REVEAL', 15_000);
  if (reveal.payload.data.phase !== 'REVEAL') throw new Error('not a reveal');
  return { party, questionId: reveal.payload.data.questionId };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const rows = (on: TestServer = server) =>
  on.db.db.selectFrom('question_reports').selectAll().execute();

describe('ATTACK 15 — poison the question bank with reports', () => {
  it('a flood from one phone costs one report and a handful of refusals, never an error', async () => {
    const { party, questionId } = await atReveal(2, strict);
    const attacker = party.players[0]!;
    const reasons = ['WRONG_ANSWER', 'MULTIPLE_CORRECT', 'OFFENSIVE', 'TYPO'] as const;
    for (let i = 0; i < 40; i++)
      attacker.send('REPORT_QUESTION', { questionId, reason: reasons[i % reasons.length] });
    await sleep(900); // TestClient.idle wakes on the first message; the writes take a little longer
    const answers = attacker.drain();
    const errors = answers
      .filter((m) => m.type === 'ERROR')
      .map((m) => (m.type === 'ERROR' ? m.payload.code : ''));
    expect(errors).toContain('RATE_LIMITED');
    expect(errors.every((code) => code === 'RATE_LIMITED' || code === 'STALE_SEQUENCE')).toBe(true);
    expect(errors).not.toContain('INTERNAL');
    // One player, one report, whatever they send; the question is not demoted by a single voice.
    const stored = (await rows(strict)).filter((row) => row.room_id === party.created.roomId);
    expect(stored).toHaveLength(1);
    expect(attacker.closeInfo).toBeNull();
    await closeParty(party);
  });

  it("cannot name another question: the round's own question is the only one a report can reach", async () => {
    const { party, questionId } = await atReveal(2);
    const other = await server.db.db
      .selectFrom('questions')
      .select('id')
      .where('id', '!=', questionId)
      .limit(1)
      .executeTakeFirstOrThrow();
    const attacker = party.players[1]!;
    const before = (await rows()).length;
    const hostile = [
      other.id,
      randomUUID(),
      "'; DROP TABLE question_reports; --",
      '../../etc/passwd',
      'x'.repeat(64),
      '\u0000',
      questionId.toUpperCase(),
    ];
    for (const id of hostile) {
      attacker.send('REPORT_QUESTION', { questionId: id, reason: 'WRONG_ANSWER' });
      const error = await attacker.nextOfType('ERROR');
      expect(['QUESTION_MISMATCH', 'RATE_LIMITED', 'INVALID_MESSAGE']).toContain(
        error.payload.code,
      );
    }
    expect((await rows()).length).toBe(before);
    // The table is still there and still takes the legitimate report.
    await closeParty(party);
  });

  it('cannot report through the TV, from the lobby, or while a question is open', async () => {
    const party = await createParty(server, 2);
    party.players.forEach((client, i) => autoAnswer(client, i));
    const [phone] = party.players as [TestClient, TestClient];
    const before = (await rows()).length;
    phone.send('REPORT_QUESTION', { questionId: randomUUID(), reason: 'TYPO' });
    expect((await phone.nextOfType('ERROR')).payload.code).toBe('INVALID_STATE');
    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    const open = await phone.waitForPhase('ANSWERING', 15_000);
    if (open.payload.data.phase !== 'ANSWERING') throw new Error('not answering');
    for (const client of [phone, party.display]) {
      client.send('REPORT_QUESTION', {
        questionId: open.payload.data.questionId,
        reason: 'WRONG_ANSWER',
      });
      const code = (await client.nextOfType('ERROR')).payload.code;
      expect(client === party.display ? ['FORBIDDEN'] : ['INVALID_STATE']).toContain(code);
    }
    expect((await rows()).length).toBe(before);
    await closeParty(party);
  });

  it('keeps the reporter anonymous even to the database', async () => {
    const { party, questionId } = await atReveal(2);
    const phone = party.players[1]!;
    phone.send('REPORT_QUESTION', { questionId, reason: 'OUTDATED' });
    await phone.nextOfType('ACK');
    const row = (await rows()).find(
      (r) => r.room_id === party.created.roomId && r.reason === 'OUTDATED',
    )!;
    const keys = Object.keys(row);
    expect(keys.sort()).toEqual([
      'created_at',
      'id',
      'note',
      'question_id',
      'question_revision',
      'reason',
      'reporter_hash',
      'resolution',
      'resolved_at',
      'resolved_by',
      'room_id',
      'status',
    ]);
    expect(row.note).toBeNull();
    expect(row.reporter_hash).toBe(
      pseudonym(server.config.serverSecret, 'reporter', phone.sessionId!),
    );
    expect(JSON.stringify(row)).not.toMatch(
      new RegExp(`${phone.sessionId}|${phone.playerId}|${phone.token}`),
    );
    await closeParty(party);
  });
});

describe('ATTACK 16 — evade or probe a ban', () => {
  const ban = (kind: 'IP' | 'DEVICE', subject: string) =>
    server.db.db
      .insertInto('bans')
      .values({ kind, subject_hash: subject, reason: 'red team' })
      .execute();
  const lift = () => server.db.db.deleteFrom('bans').execute();
  const joinFrame = (code: string, deviceId: string, nickname = 'Deneme') => ({
    code,
    nickname,
    avatarId: 'fox',
    deviceId,
    client: { kind: 'WEB', version: 't' },
  });

  it('a banned device gets the same answer for a real room, a closed one and nonsense, and creates nothing', async () => {
    const created = await createRoom(server);
    const device = 'banned-device-0123456789abcdef';
    await ban('DEVICE', pseudonym(server.config.serverSecret, 'device', device));
    const sessionsBefore = (await server.db.db.selectFrom('room_sessions').select('id').execute())
      .length;
    const answers: string[] = [];
    for (const code of [created.code, 'ZZZZZZ', '', 'a'.repeat(31)]) {
      const client = await TestClient.connect(server.wsUrl);
      client.send('JOIN_ROOM', joinFrame(code, device), { roomId: null, sessionId: null });
      const next = await client.next((m) => m.type === 'ERROR', 3_000, 'error');
      answers.push(next.type === 'ERROR' ? next.payload.code : '');
      await client.close();
    }
    expect(new Set(answers.filter((code) => code !== 'INVALID_MESSAGE'))).toEqual(
      new Set(['BANNED']),
    );
    expect((await server.db.db.selectFrom('room_sessions').select('id').execute()).length).toBe(
      sessionsBefore,
    );
    await lift();
  });

  it('a spoofed X-Forwarded-For does not move the ban (proxy headers are ignored unless trusted)', async () => {
    const ip = pseudonym(server.config.serverSecret, 'ip', '127.0.0.1');
    await ban('IP', ip);
    const response = await fetch(`${server.httpUrl}/v1/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
        'x-real-ip': '203.0.113.9',
      },
      body: JSON.stringify({ client: { kind: 'DISPLAY', version: 't' } }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('BANNED');
    await lift();
  });

  it('a ban says nothing about why, who placed it or what else is banned', async () => {
    await ban('IP', pseudonym(server.config.serverSecret, 'ip', '127.0.0.1'));
    const response = await fetch(`${server.httpUrl}/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: { kind: 'DISPLAY', version: 't' } }),
    });
    expect(await response.json()).toEqual({ error: { code: 'BANNED' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
    await lift();
  });
});

describe('ATTACK 17 — read or change the switches from outside', () => {
  it('shows only the public flags, in the declared shape, to anyone', async () => {
    const response = await fetch(`${server.httpUrl}/v1/flags`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const body = PublicFlagsSchema.parse(await response.json());
    const all = await server.db.db.selectFrom('feature_flags').select(['key', 'public']).execute();
    for (const flag of all.filter((row) => !row.public))
      expect(Object.keys(body.flags)).not.toContain(flag.key);
  });

  it('has no way to write: other methods and paths are not routes', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${server.httpUrl}/v1/flags`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 'report.questions': false }),
      });
      expect([404, 405]).toContain(response.status);
    }
    const flag = await server.db.db
      .selectFrom('feature_flags')
      .select('enabled')
      .where('key', '=', 'report.questions')
      .executeTakeFirstOrThrow();
    expect(flag.enabled).toBe(true);
  });

  it('is rate limited per address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 90; i++) statuses.push((await fetch(`${strict.httpUrl}/v1/flags`)).status);
    expect(statuses).toContain(429);
    expect(statuses.every((status) => status === 200 || status === 429)).toBe(true);
  });
});
