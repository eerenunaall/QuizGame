import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseInboundLink } from '@quizparty/validation';
import { TestClient } from '../helpers/client';
import { liveRoom } from '../helpers/oracle';
import { closeParty, createParty } from '../helpers/party';
import { preRevealLeaks } from '../helpers/scan';
import { waitForSecurityEvent } from '../helpers/security';
import { createRoom, startServer, type TestServer } from '../helpers/server';

/**
 * Attacks on identity, discovery and the network edge (brief §26 ATTACK 7, 8, 11, 12).
 */

describe('ATTACK 7 — enumerate room codes', () => {
  let strict: TestServer;
  beforeAll(async () => {
    // Production limits: the shared test server scales them up so ordinary tests never trip them.
    strict = await startServer({ env: { RATE_LIMIT_SCALE: '1' } });
  });
  afterAll(async () => {
    await strict.dispose();
  });

  const randomCode = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(
      { length: 6 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join('');
  };

  it('throttles HTTP guessing hard and answers every miss identically', async () => {
    const responses: { status: number; body: string }[] = [];
    for (let i = 0; i < 60; i++) {
      const response = await fetch(`${strict.httpUrl}/v1/rooms/${randomCode()}/preview`);
      responses.push({ status: response.status, body: await response.text() });
    }
    const misses = responses.filter((r) => r.status === 404);
    const limited = responses.filter((r) => r.status === 429);
    expect(misses.length).toBeLessThanOrEqual(12); // every miss is billed several tokens
    expect(limited.length).toBeGreaterThanOrEqual(48);
    expect(new Set(misses.map((r) => r.body)).size).toBe(1); // nothing to tell codes apart by
    expect(JSON.parse(limited[0]!.body)).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('gives a valid room no more oracle value than a missing one once throttled', async () => {
    const created = await createRoom(strict);
    const statuses: number[] = [];
    for (let i = 0; i < 50; i++) {
      const response = await fetch(`${strict.httpUrl}/v1/rooms/${randomCode()}/preview`);
      statuses.push(response.status);
    }
    expect(statuses.at(-1)).toBe(429);
    // the attacker's IP is exhausted: even the real code is refused, indistinguishably
    const real = await fetch(`${strict.httpUrl}/v1/rooms/${created.code}/preview`);
    expect(real.status).toBe(429);
  });

  it('throttles WebSocket join guessing and logs the misses', async () => {
    const client = await TestClient.connect(strict.wsUrl);
    const codes: string[] = [];
    for (let i = 0; i < 16; i++) {
      client.send(
        'JOIN_ROOM',
        {
          code: randomCode(),
          nickname: 'Guesser',
          avatarId: 'fox',
          deviceId: `device-${'x'.repeat(16)}${i}`,
          client: { kind: 'WEB', version: 't' },
        },
        { roomId: null, sessionId: null },
      );
      const reply = await client.nextOfType('ERROR');
      codes.push(reply.payload.code);
    }
    expect(codes.slice(0, 3).every((code) => code === 'ROOM_NOT_FOUND')).toBe(true);
    expect(codes.filter((code) => code === 'RATE_LIMITED').length).toBeGreaterThanOrEqual(8);
    await waitForSecurityEvent(strict, {}, 'ROOM_CODE_MISS');
    await client.close();
  });

  it('keeps the code space large enough that guessing is impractical', () => {
    const space = 31 ** 6; // 31-letter alphabet, 6 characters
    expect(space).toBeGreaterThan(8.8e8);
    // sustained rate under the limiter: one miss costs 4 tokens, refill is 0.5 tokens/s
    const missesPerSecond = 0.5 / 4;
    const activeRooms = 1_000;
    const expectedGuesses = space / activeRooms;
    const secondsForOneIp = expectedGuesses / missesPerSecond;
    expect(secondsForOneIp / 86_400).toBeGreaterThan(30); // > 30 days per IP for one hit among 1000 rooms
  });
});

describe('ATTACK 8 — steal a reconnect token', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    await server.dispose();
  });

  async function takeOver(
    room: { roomId: string },
    stolen: { sessionId: string; token: string },
    sequence: number,
  ): Promise<{ thief: TestClient; token: string }> {
    const thief = await TestClient.connect(server.wsUrl);
    Object.assign(thief, {
      sessionId: stolen.sessionId,
      roomId: room.roomId,
      token: stolen.token,
      sequence,
    });
    await thief.reconnect();
    return { thief, token: thief.token! };
  }

  it('limits the thief to one player slot and kills the session when the victim comes back', async () => {
    const party = await createParty(server, 3);
    const [leader, victim, bystander] = party.players as [TestClient, TestClient, TestClient];
    const stolen = { sessionId: victim.sessionId!, token: victim.token! }; // leaked from a log

    // 1. The thief uses the token while the victim is online: the victim is superseded.
    const { thief, token: thiefToken } = await takeOver(party.created, stolen, 500);
    await victim.nextOfType('SESSION_SUPERSEDED');

    // 2. The thief is exactly one ordinary player: no host powers, no hidden information.
    thief.send('START_GAME', {});
    expect((await thief.nextOfType('ERROR')).payload.code).toBe('NOT_HOST');
    thief.send('KICK_PLAYER', { playerId: leader.playerId });
    expect((await thief.nextOfType('ERROR')).payload.code).toBe('NOT_HOST');
    expect(preRevealLeaks(thief)).toEqual([]);
    expect(liveRoom(server, party.created.roomId).state.phase).toBe('LOBBY');

    // 3. Time passes beyond the grace window; the victim's device presents its (now old) token.
    await server.db.db
      .updateTable('room_sessions')
      .set({ prev_valid_until: new Date(Date.now() - 1_000) })
      .where('id', '=', stolen.sessionId)
      .execute();
    const returning = await TestClient.connect(server.wsUrl);
    Object.assign(returning, {
      sessionId: stolen.sessionId,
      roomId: party.created.roomId,
      token: stolen.token,
      sequence: 900,
    });
    returning.send('RECONNECT', {
      reconnectToken: stolen.token,
      client: { kind: 'WEB', version: 't' },
    });
    expect((await returning.nextOfType('ERROR')).payload.code).toBe('SESSION_REVOKED');

    // 4. Both parties are out; the live thief connection was cut and the token is dead.
    await thief.next((m) => m.type === 'SESSION_REVOKED', 3_000, 'revocation of the thief');
    const retry = await TestClient.connect(server.wsUrl);
    Object.assign(retry, {
      sessionId: stolen.sessionId,
      roomId: party.created.roomId,
      token: thiefToken,
      sequence: 950,
    });
    retry.send('RECONNECT', { reconnectToken: thiefToken, client: { kind: 'WEB', version: 't' } });
    expect((await retry.nextOfType('ERROR')).payload.code).toBe('SESSION_EXPIRED');
    await waitForSecurityEvent(server, { sessionId: stolen.sessionId }, 'RECONNECT_TOKEN_REUSE');

    // 5. Blast radius: nobody else was touched and the room carries on.
    const state = liveRoom(server, party.created.roomId).state;
    expect(state.phase).toBe('LOBBY');
    expect(state.leaderPlayerId).toBe(leader.playerId);
    bystander.send('READY', { ready: true });
    await bystander.nextOfType('ACK');
    await closeParty(party);
  });

  it('a stolen token is useless in any other room and a guessed token gets nothing', async () => {
    const a = await createParty(server, 2);
    const b = await createParty(server, 2);
    const victim = a.players[1]!;
    const wrongRoom = await TestClient.connect(server.wsUrl);
    Object.assign(wrongRoom, {
      sessionId: victim.sessionId,
      roomId: b.created.roomId, // claims the other room
      token: victim.token,
      sequence: 400,
    });
    wrongRoom.send('RECONNECT', {
      reconnectToken: victim.token,
      client: { kind: 'WEB', version: 't' },
    });
    expect((await wrongRoom.nextOfType('ERROR')).payload.code).toBe('FORBIDDEN');

    const guesser = await TestClient.connect(server.wsUrl);
    Object.assign(guesser, {
      sessionId: crypto.randomUUID(),
      roomId: a.created.roomId,
      token: 'g'.repeat(43),
      sequence: 400,
    });
    guesser.send('RECONNECT', {
      reconnectToken: 'g'.repeat(43),
      client: { kind: 'WEB', version: 't' },
    });
    // unknown session and revoked session are indistinguishable
    expect((await guesser.nextOfType('ERROR')).payload.code).toBe('SESSION_EXPIRED');
    await Promise.all([closeParty(a), closeParty(b)]);
  });
});

describe('ATTACK 11 — malicious deep-link parameters', () => {
  const HOSTS = ['quizparty.example'];
  const HOSTILE_LINKS = [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://evil.example/join/ABCDEF',
    'https://quizparty.example@evil.example/join/ABCDEF',
    'https://evil.example@quizparty.example/join/ABCDEF',
    'https://user:pass@quizparty.example/join/ABCDEF',
    'http://quizparty.example/join/ABCDEF',
    'https://quizparty.example:8443/join/ABCDEF',
    'https://quizparty.example/join/ABCDEF/../../admin',
    'https://quizparty.example/join/..%2f..%2fadmin',
    'https://quizparty.example/join/ABC%00DEF',
    'https://quizparty.example/join/ABC DEF',
    'https://quizparty.example/join/ABCDEF?next=https://evil.example',
    'https://quizparty.example//evil.example/join/ABCDEF',
    'https://quizparty.example/join/%41%42%43%44%45%46',
    `https://quizparty.example/join/${'A'.repeat(5_000)}`,
    'https://quizparty.example/unlock/../../join/ABCDEF',
    'https://quizparty.example/blind/' + 'a'.repeat(44),
    'https://quizparty.example/join/АВСDEF', // Cyrillic lookalikes
    'https://quizparty.example\\@evil.example/join/ABCDEF',
    'file:///etc/passwd',
    '//evil.example/join/ABCDEF',
    '',
  ];

  it('never turns a hostile link into a navigation target', () => {
    for (const link of HOSTILE_LINKS) {
      const parsed = parseInboundLink(link, HOSTS);
      // the only acceptable results are rejection or a plain validated identifier on our host
      if (parsed !== null) {
        expect(link.startsWith('https://quizparty.example/'), link).toBe(true);
        expect(JSON.stringify(parsed)).not.toMatch(/evil|<|>|%|\.\./u);
      }
    }
    // the unambiguous attacks are all refused outright
    for (const link of HOSTILE_LINKS.slice(0, 12))
      expect(parseInboundLink(link, HOSTS), link).toBeNull();
  });

  describe('against the live server', () => {
    let server: TestServer;
    beforeAll(async () => {
      server = await startServer();
    });
    afterAll(async () => {
      await server.dispose();
    });

    it('answers hostile room-code parameters with a clean 404 and never reflects them', async () => {
      const payloads = [
        "'; DROP TABLE rooms;--",
        '<script>alert(1)</script>',
        '..%2f..%2f..%2fetc%2fpasswd',
        '%00',
        '%ff%fe',
        'A'.repeat(4_000),
        '${7*7}',
        '{{constructor.constructor("return process")()}}',
      ];
      for (const payload of payloads) {
        const response = await fetch(`${server.httpUrl}/v1/rooms/${payload}/preview`);
        const body = await response.text();
        expect([400, 404, 414, 431], payload.slice(0, 40)).toContain(response.status);
        expect(body).not.toContain('<script>');
        expect(body).not.toMatch(/stack|at .*\.ts|node_modules|SELECT |DROP /iu);
        expect(
          response.headers.get('x-content-type-options'),
          `${response.status} ${payload.slice(0, 30)}`,
        ).toBe('nosniff');
      }
      expect((await fetch(`${server.httpUrl}/healthz`)).status).toBe(200);
    });

    it('survives hostile WebSocket join parameters without echoing them or crashing', async () => {
      const client = await TestClient.connect(server.wsUrl);
      const hostile = [
        { code: "ABC'; DROP TABLE rooms;--", nickname: 'Zed' },
        { code: '\u0000\u0000\u0000\u0000\u0000\u0000', nickname: 'Zed' },
        { code: '😀😀😀😀😀😀', nickname: 'Zed' },
        { code: 'ABCDEF', nickname: '<img src=x onerror=alert(1)>' },
        { code: 'ABCDEF', nickname: 'A\u202eB' },
        { code: 'ABCDEF', nickname: 'x'.repeat(5_000) },
      ];
      for (const [index, entry] of hostile.entries()) {
        client.send(
          'JOIN_ROOM',
          {
            ...entry,
            avatarId: 'fox',
            deviceId: `device-hostile-${String(index).padStart(10, '0')}`,
            client: { kind: 'WEB', version: 't' },
          },
          { roomId: null, sessionId: null },
        );
        const reply = await client.nextOfType('ERROR');
        expect(['ROOM_NOT_FOUND', 'NICKNAME_INVALID', 'INVALID_MESSAGE']).toContain(
          reply.payload.code,
        );
        expect(JSON.stringify(reply)).not.toContain('<img');
      }
      expect((await fetch(`${server.httpUrl}/healthz`)).status).toBe(200);
      await client.close();
    });

    it('never lets a nickname carry markup, direction overrides or invisible characters into a room', async () => {
      const party = await createParty(server, 1);
      const probe = await TestClient.connect(server.wsUrl);
      for (const nickname of ['<b>Bold</b>', 'Ali\u200bce', 'evil\u202etxt', 'a&amp;b']) {
        probe.send(
          'JOIN_ROOM',
          {
            code: party.created.code,
            nickname,
            avatarId: 'fox',
            deviceId: `device-probe-${crypto.randomUUID().replaceAll('-', '')}`,
            client: { kind: 'WEB', version: 't' },
          },
          { roomId: null, sessionId: null },
        );
        const reply = await probe.next(
          (m) => m.type === 'ERROR' || m.type === 'ROOM_JOINED',
          3_000,
          'a join verdict',
        );
        expect(reply.type, nickname).toBe('ERROR');
      }
      const names = liveRoom(server, party.created.roomId).state.playerOrder.map(
        (id) => liveRoom(server, party.created.roomId).state.players[id]!.nickname,
      );
      expect(names.every((name) => !/[<>&\u200b\u202e]/u.test(name))).toBe(true);
      await probe.close();
      await closeParty(party);
    });
  });
});

describe('ATTACK 12 — join from another network', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    await server.dispose();
  });

  it('lets phones on different source addresses (other networks) join and play in one room', async () => {
    // Linux routes all of 127.0.0.0/8 to loopback: three genuinely different source IPs.
    const party = await createParty(server, 3, {
      localAddresses: ['127.0.0.2', '127.0.0.3', '127.0.0.4'],
    });
    expect(party.players).toHaveLength(3);
    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    for (const client of party.players) await client.waitForPhase('ANSWERING', 10_000);
    await closeParty(party);

    // The server never bound the room to one network: sessions are not tied to an address.
    const sessions = await server.db.db
      .selectFrom('room_sessions')
      .select(['id', 'role'])
      .where('room_id', '=', party.created.roomId)
      .execute();
    expect(sessions).toHaveLength(4); // TV + three phones
  });

  it('survives a phone changing network mid-game (new source address, same session)', async () => {
    const party = await createParty(server, 2, { localAddresses: ['127.0.0.2', '127.0.0.3'] });
    const roamer = party.players[1]!;
    roamer.drop();
    const moved = await TestClient.connect(server.wsUrl, { localAddress: '127.0.0.5' });
    Object.assign(moved, {
      sessionId: roamer.sessionId,
      roomId: party.created.roomId,
      token: roamer.token,
      sequence: roamer.sequence + 50,
    });
    const view = await moved.reconnect();
    expect(view.you?.playerId).toBe(roamer.playerId);
    await moved.close();
    await closeParty(party);
  });
});

describe('Attacks that need features from later milestones', () => {
  it.todo('ATTACK 5 — replay a sabotage packet (needs sabotage powers, M2)');
  it.todo('ATTACK 9 — fake a purchase (needs payment verification, M4)');
  it.todo('ATTACK 10 — creator requests Blind Quiz raw answers (needs Blind Quiz, M5)');
});
