import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestClient } from '../helpers/client';
import { createRoom, startServer, type TestServer } from '../helpers/server';
import { waitForSecurityEvent } from '../helpers/security';

let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(async () => {
  await server.dispose();
});

describe('room creation (HTTP)', () => {
  it('creates a room with a code, join link and display credentials, and persists it', async () => {
    const room = await createRoom(server);
    expect(room.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(room.joinUrl).toBe(`http://localhost:5173/join/${room.code}`);
    expect(room.display.reconnectToken.length).toBeGreaterThanOrEqual(40);
    expect(room.tier).toBe('FULL');
    const row = await server.db.db
      .selectFrom('rooms')
      .selectAll()
      .where('id', '=', room.roomId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('ACTIVE');
    expect(row.owner_instance_id).toBe('test-instance');
    // the display token is stored only as a hash
    const session = await server.db.db
      .selectFrom('room_sessions')
      .selectAll()
      .where('room_id', '=', room.roomId)
      .executeTakeFirstOrThrow();
    expect(session.token_hash).not.toBe(room.display.reconnectToken);
    expect(session.token_hash).toHaveLength(64);
  });

  it('rejects malformed bodies and unknown fields', async () => {
    for (const body of [
      '{}',
      '{"client":{"kind":"DISPLAY","version":"1"},"tier":"FULL"}',
      '[]',
      'nope',
    ]) {
      const response = await fetch(`${server.httpUrl}/v1/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(response.status, body).toBe(400);
      const json = (await response.json()) as { error: { code: string } };
      expect(JSON.stringify(json)).not.toMatch(/stack|at .*\(/);
    }
  });

  it('serves a generic preview and the same 404 for every kind of miss', async () => {
    const room = await createRoom(server);
    const ok = await fetch(`${server.httpUrl}/v1/rooms/${room.code}/preview`);
    expect(await ok.json()).toEqual({
      code: room.code,
      joinable: true,
      phase: 'LOBBY',
      playerCount: 0,
      maxPlayers: 8,
    });
    const bodies = new Set<string>();
    for (const code of ['AAAAAA', 'zz', '../etc/passwd', 'X7P4KQ']) {
      const miss = await fetch(`${server.httpUrl}/v1/rooms/${encodeURIComponent(code)}/preview`);
      expect(miss.status).toBe(404);
      bodies.add(await miss.text());
    }
    expect(bodies.size).toBe(1);
  });

  it('exposes health, readiness and protocol discovery', async () => {
    expect((await fetch(`${server.httpUrl}/healthz`)).status).toBe(200);
    const ready = await fetch(`${server.httpUrl}/readyz`);
    expect(ready.status).toBe(200);
    const config = (await (await fetch(`${server.httpUrl}/v1/config`)).json()) as {
      protocolVersion: number;
    };
    expect(config.protocolVersion).toBe(1);
  });

  it('sets security headers and never reveals internals for unknown routes', async () => {
    const response = await fetch(`${server.httpUrl}/v1/does-not-exist`);
    expect(response.status).toBe(404);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers CORS preflight only for allowed origins', async () => {
    const allowed = await fetch(`${server.httpUrl}/v1/rooms`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const denied = await fetch(`${server.httpUrl}/v1/rooms`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses to boot a route without an explicit auth/limit policy', () => {
    const policies = server.built.routes;
    expect(policies.length).toBeGreaterThan(4);
    for (const route of policies) {
      expect(['public', 'metrics-token']).toContain(route.auth);
      expect(route.limit).toBeTruthy();
    }
  });
});

describe('display and players in the lobby (WebSocket)', () => {
  it('lets the display attach, players join in realtime and the first joiner lead', async () => {
    const created = await createRoom(server);
    const display = await TestClient.connect(server.wsUrl);
    const initial = await display.attachDisplay(created);
    expect(initial).toMatchObject({
      phase: 'WAITING',
      displayConnected: true,
      you: null,
      code: created.code,
    });
    expect(display.token).not.toBe(created.display.reconnectToken); // rotated on reconnect

    const ece = await TestClient.connect(server.wsUrl);
    const view = await ece.join(server.wsUrl, created.code, 'Ece');
    expect(view.phase).toBe('LOBBY');
    expect(view.players).toHaveLength(1);
    expect(view.you).toMatchObject({ isLeader: true, canHost: true, answer: null });
    const joined = await display.nextOfType('PLAYER_JOINED');
    expect(joined.payload.player).toMatchObject({
      nickname: 'Ece',
      isLeader: true,
      connection: 'CONNECTED',
    });
    await display.waitForPhase('LOBBY');

    const goktug = await TestClient.connect(server.wsUrl);
    const second = await goktug.join(server.wsUrl, created.code, 'Göktuğ');
    expect(second.players.map((p) => p.nickname)).toEqual(['Ece', 'Göktuğ']);
    expect(second.you?.isLeader).toBe(false);
    expect((await display.nextOfType('PLAYER_JOINED')).payload.player.nickname).toBe('Göktuğ');
    expect((await ece.nextOfType('PLAYER_JOINED')).payload.player.nickname).toBe('Göktuğ');
    await Promise.all([display.close(), ece.close(), goktug.close()]);
  });

  it('rejects duplicate and invalid nicknames, unknown rooms and the same device joining twice', async () => {
    const created = await createRoom(server);
    const a = await TestClient.connect(server.wsUrl);
    await a.join(server.wsUrl, created.code, 'Zeynep', 'device-aaaaaaaaaaaaaaaaaaaa');

    const b = await TestClient.connect(server.wsUrl);
    b.send(
      'JOIN_ROOM',
      {
        code: created.code,
        nickname: 'ZEYNEP',
        avatarId: 'cat',
        deviceId: 'device-bbbbbbbbbbbbbbbbbbbb',
        client: { kind: 'WEB', version: 't' },
      },
      { roomId: null, sessionId: null },
    );
    expect((await b.nextOfType('ERROR')).payload.code).toBe('NICKNAME_TAKEN');

    b.send(
      'JOIN_ROOM',
      {
        code: created.code,
        nickname: 'Аdmin',
        avatarId: 'cat',
        deviceId: 'device-bbbbbbbbbbbbbbbbbbbb',
        client: { kind: 'WEB', version: 't' },
      },
      { roomId: null, sessionId: null },
    );
    const invalid = await b.nextOfType('ERROR');
    expect(invalid.payload).toMatchObject({
      code: 'NICKNAME_INVALID',
      params: { reason: 'MIXED_SCRIPT' },
    });

    b.send(
      'JOIN_ROOM',
      {
        code: 'AAAAAA',
        nickname: 'Valid',
        avatarId: 'cat',
        deviceId: 'device-bbbbbbbbbbbbbbbbbbbb',
        client: { kind: 'WEB', version: 't' },
      },
      { roomId: null, sessionId: null },
    );
    expect((await b.nextOfType('ERROR')).payload.code).toBe('ROOM_NOT_FOUND');

    b.send(
      'JOIN_ROOM',
      {
        code: created.code,
        nickname: 'Other',
        avatarId: 'cat',
        deviceId: 'device-aaaaaaaaaaaaaaaaaaaa',
        client: { kind: 'WEB', version: 't' },
      },
      { roomId: null, sessionId: null },
    );
    expect((await b.nextOfType('ERROR')).payload.code).toBe('ALREADY_JOINED');
    await Promise.all([a.close(), b.close()]);
  });

  it('keeps unauthenticated sockets on a short leash', async () => {
    const created = await createRoom(server);
    const anon = await TestClient.connect(server.wsUrl);
    anon.send(
      'SUBMIT_ANSWER',
      { questionId: 'q', optionId: 'AAAAAAAA' },
      { roomId: created.roomId, sessionId: created.display.sessionId },
    );
    expect((await anon.nextOfType('ERROR')).payload.code).toBe('UNAUTHORIZED');
    // PING is allowed before authentication (clock sync), nothing else is
    anon.send('PING', { clientSentAt: Date.now() }, { roomId: null, sessionId: null });
    const pong = await anon.nextOfType('PONG');
    expect(Math.abs(pong.payload.serverTime - Date.now())).toBeLessThan(2_000);
    await anon.idle(900);
    expect(anon.closeInfo?.code).toBe(4008);
  });

  it('rejects hostile WebSocket upgrades: foreign origin and wrong path', async () => {
    await expect(
      TestClient.connect(server.wsUrl, { origin: 'https://evil.example' }),
    ).rejects.toThrow(/403/);
    await expect(TestClient.connect(server.wsUrl.replace('/ws', '/not-ws'))).rejects.toThrow(/404/);
    const allowed = await TestClient.connect(server.wsUrl, { origin: 'http://localhost:5173' });
    await allowed.close();
  });

  it('survives malformed and unsupported frames without leaking details', async () => {
    const client = await TestClient.connect(server.wsUrl);
    client.sendRaw('{not json');
    client.sendRaw(
      JSON.stringify({ type: 'JOIN_ROOM', protocolVersion: 99, messageId: crypto.randomUUID() }),
    );
    client.sendRaw(
      JSON.stringify({
        type: 'SET_SCORE',
        protocolVersion: 1,
        messageId: crypto.randomUUID(),
        roomId: null,
        sessionId: null,
        sequence: 1,
        timestamp: 1,
        payload: { score: 1e9 },
      }),
    );
    await client.idle(200);
    const errors = client.messages
      .filter((m) => m.type === 'ERROR')
      .map((m) => (m.type === 'ERROR' ? m.payload.code : ''));
    expect(errors).toEqual(['INVALID_MESSAGE', 'UNSUPPORTED_PROTOCOL', 'INVALID_MESSAGE']);
    expect(client.frames.join('')).not.toMatch(/Error:|stack|\.ts:|node_modules/);
    await client.close();
  });

  it('drops oversized frames (1009) and binary frames (1003)', async () => {
    const oversized = await TestClient.connect(server.wsUrl);
    oversized.sendRaw('x'.repeat(40_000));
    await oversized.idle(300);
    expect(oversized.closeInfo?.code).toBe(1009);

    const binary = await TestClient.connect(server.wsUrl);
    binary.ws.send(Buffer.from([1, 2, 3]));
    await binary.idle(300);
    expect(binary.closeInfo?.code).toBe(1003);
  });
});

describe('host authority', () => {
  it('only the display or the leader may run host commands; others are refused and logged', async () => {
    const created = await createRoom(server);
    const display = await TestClient.connect(server.wsUrl);
    await display.attachDisplay(created);
    const leader = await TestClient.connect(server.wsUrl);
    await leader.join(server.wsUrl, created.code, 'Lider');
    const guest = await TestClient.connect(server.wsUrl);
    await guest.join(server.wsUrl, created.code, 'Misafir');
    await guest.nextOfType('ROOM_JOINED').catch(() => undefined);

    for (const [type, payload] of [
      ['START_GAME', {}],
      ['KICK_PLAYER', { playerId: leader.playerId }],
      ['END_ROOM', {}],
      ['SET_SETTINGS', { rounds: 3 }],
      ['TRANSFER_LEADER', { playerId: guest.playerId }],
    ] as const) {
      guest.send(type, payload);
      const error = await guest.nextOfType('ERROR');
      expect(error.payload.code, type).toBe('NOT_HOST');
    }
    expect(server.built.manager.get(created.roomId)?.state.phase).toBe('LOBBY');
    await waitForSecurityEvent(server, { roomId: created.roomId }, 'HOST_COMMAND_FORBIDDEN');

    leader.send('SET_SETTINGS', { rounds: 5 });
    await leader.nextOfType('ACK');
    expect(server.built.manager.get(created.roomId)?.state.settings.rounds).toBe(5);
    await Promise.all([display.close(), leader.close(), guest.close()]);
  });
});
