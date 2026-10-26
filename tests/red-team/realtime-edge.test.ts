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
    await attacker.idle(400);
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
    await honest.idle(300);
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
