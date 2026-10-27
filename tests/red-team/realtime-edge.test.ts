import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestClient } from '../helpers/client';
import { liveRoom } from '../helpers/oracle';
import { createRoom, startServer, type TestServer } from '../helpers/server';
import { waitUntil } from '../helpers/wait';

/**
 * Attacks on the realtime edge outside venue mode: the WebSocket gateway's handshake, its
 * authentication races and the room lifecycle behind it (ATTACK 38 onward).
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const device = () => `device-${randomUUID().replaceAll('-', '')}`;

function joinFrame(code: string, nickname: string, deviceId = device()): string {
  return JSON.stringify({
    type: 'JOIN_ROOM',
    protocolVersion: 1,
    messageId: randomUUID(),
    roomId: null,
    sessionId: null,
    sequence: 1,
    timestamp: Date.now(),
    payload: { code, nickname, avatarId: 'fox', deviceId, client: { kind: 'WEB', version: 't' } },
  });
}

describe('ATTACK 38 — one socket, many seats; seats that outlive their socket', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    await server.dispose();
  });

  const seats = (roomId: string) => Object.values(liveRoom(server, roomId).state.players);

  it('lets one socket hold at most one seat, however fast it sends JOIN_ROOM', async () => {
    const created = await createRoom(server);
    const display = await TestClient.connect(server.wsUrl);
    await display.attachDisplay(created);
    const other = await createRoom(server);

    const attacker = await TestClient.connect(server.wsUrl);
    // Three joins in one burst (two rooms): each would pass "no session yet" before the first lands.
    attacker.sendRaw(joinFrame(created.code, 'Ghost1'));
    attacker.sendRaw(joinFrame(created.code, 'Ghost2'));
    attacker.sendRaw(joinFrame(other.code, 'Ghost3'));
    await attacker.nextOfType('ROOM_JOINED');
    await sleep(400);
    expect(attacker.messages.filter((m) => m.type === 'ROOM_JOINED')).toHaveLength(1);
    const all = [...seats(created.roomId), ...seats(other.roomId)];
    expect(all).toHaveLength(1);

    // Closing the one socket takes its one seat offline: nothing stays "connected" without a socket.
    attacker.drop();
    await waitUntil(
      () =>
        [...seats(created.roomId), ...seats(other.roomId)].every(
          (p) => p.connection === 'DISCONNECTED',
        ),
      3_000,
      'every seat of the dropped socket offline',
    );
    await display.close();
  });

  it('never leaves a seat "connected" when the socket dies while its JOIN_ROOM is in flight', async () => {
    const created = await createRoom(server);
    const display = await TestClient.connect(server.wsUrl);
    await display.attachDisplay(created);
    for (let i = 0; i < 3; i++) {
      const phone = await TestClient.connect(server.wsUrl);
      phone.sendRaw(joinFrame(created.code, `Vanish${i}`));
      phone.drop(); // gone before the server has finished seating it
    }
    const honest = await TestClient.connect(server.wsUrl);
    await honest.join(server.wsUrl, created.code, 'Honest');
    await sleep(300);
    // Whatever got seated must be offline (so leadership, "everyone gone" and early locks work) and
    // must not be holding a dead socket in the room's connection table.
    await waitUntil(
      () =>
        seats(created.roomId)
          .filter((p) => p.nickname !== 'Honest')
          .every((p) => p.connection === 'DISCONNECTED'),
      3_000,
      'ghost seats offline',
    );
    expect(liveRoom(server, created.roomId).connectionCount()).toBe(2); // the TV and Honest
    await Promise.all([display.close(), honest.close()]);
  });
});

describe('ATTACK 40 — flip a lobby switch to grow the durable event log', () => {
  let strict: TestServer;
  beforeAll(async () => {
    // Production limits: the shared test server scales them up so ordinary tests never trip them.
    strict = await startServer({ env: { RATE_LIMIT_SCALE: '1' } });
  });
  afterAll(async () => {
    await strict.dispose();
  });

  it('bills lobby state changes apart from chatter, so a toggle loop cannot write thousands of rows', async () => {
    const created = await createRoom(strict);
    const display = await TestClient.connect(strict.wsUrl);
    await display.attachDisplay(created);
    const player = await TestClient.connect(strict.wsUrl);
    await player.join(strict.wsUrl, created.code, 'Toggler');
    const before = liveRoom(strict, created.roomId).state.version;
    // Every flip is a real state change: one durable event, one fan-out to every screen.
    for (let i = 0; i < 38; i++) player.send('READY', { ready: i % 2 === 0 });
    await sleep(800);
    const written = liveRoom(strict, created.roomId).state.version - before;
    expect(written).toBeLessThanOrEqual(24);
    expect(
      player.messages.some((m) => m.type === 'ERROR' && m.payload.code === 'RATE_LIMITED'),
    ).toBe(true);
    await Promise.all([display.close(), player.close()]);
  });
});

describe('ATTACK 39— look-alike letters that are "Latin" slip past the name rules', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    await server.dispose();
  });

  async function tryJoin(code: string, nickname: string): Promise<string> {
    const phone = await TestClient.connect(server.wsUrl);
    phone.sendRaw(joinFrame(code, nickname));
    const reply = await phone.next(
      (m) => m.type === 'ROOM_JOINED' || m.type === 'ERROR',
      5_000,
      'join answer',
    );
    phone.drop();
    return reply.type === 'ERROR' ? reply.payload.code : 'JOINED';
  }

  it('refuses reserved names, twins of a seated player and hidden profanity written in them', async () => {
    const created = await createRoom(server);
    const display = await TestClient.connect(server.wsUrl);
    await display.attachDisplay(created);
    const alice = await TestClient.connect(server.wsUrl);
    await alice.join(server.wsUrl, created.code, 'Alice');

    // small capitals, single-storey a/g and a dental click all draw like ASCII letters
    expect(await tryJoin(created.code, 'ɑdmin')).toBe('NICKNAME_INVALID');
    expect(await tryJoin(created.code, 'ᴀdmin')).toBe('NICKNAME_INVALID');
    expect(await tryJoin(created.code, 'ꜰᴜᴄᴋ')).toBe('NICKNAME_INVALID');
    expect(await tryJoin(created.code, 'Aǀice')).toBe('NICKNAME_TAKEN');
    expect(await tryJoin(created.code, 'ᴀlice')).toBe('NICKNAME_TAKEN');
    // honest names with accents or other letters still pass
    expect(await tryJoin(created.code, 'Ayşe')).toBe('JOINED');
    await Promise.all([display.close(), alice.close()]);
  });
});
