import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import { TestClient } from '../helpers/client';
import { FAST_GAME_CONFIG, createRoom, startServer } from '../helpers/server';

/**
 * Every phone disconnected for `timings.allPlayersGoneMs` closes the room as ABANDONED so the TV can
 * return to its title menu; a restart (all sockets drop at once, phones come back within seconds)
 * must not (ADR-0006: recovery stamps every seat as disconnected at the recovery instant).
 */
const WINDOW_MS = 10_000; // the schema minimum
const CONFIG = {
  ...FAST_GAME_CONFIG,
  timings: { ...FAST_GAME_CONFIG.timings, allPlayersGoneMs: WINDOW_MS },
};

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.drop();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh socket that resumes `of`'s session with its latest token (what a reconnecting phone does). */
async function comeBack(url: string, of: TestClient): Promise<TestClient> {
  const back = await TestClient.connect(url);
  Object.assign(back, {
    sessionId: of.sessionId,
    roomId: of.roomId,
    token: of.token,
    sequence: of.sequence + 100,
  });
  await back.reconnect();
  return back;
}

describe('all phones gone', () => {
  it('a phone that comes back keeps the room; total silence closes it and tells the TV', async () => {
    const server = await startServer({ database, gameConfig: CONFIG });
    try {
      const created = await createRoom(server);
      const display = await TestClient.connect(server.wsUrl);
      await display.attachDisplay(created);
      const p1 = await TestClient.connect(server.wsUrl);
      await p1.join(server.wsUrl, created.code, 'Bir');
      const p2 = await TestClient.connect(server.wsUrl);
      await p2.join(server.wsUrl, created.code, 'Iki');
      const room = () => server.built.manager.getByCode(created.code)!;

      p1.drop();
      p2.drop();
      await sleep(WINDOW_MS * 0.6);
      const back = await comeBack(server.wsUrl, p1);
      // well past WINDOW_MS after the first disconnect, and also after the second one
      await sleep(WINDOW_MS * 0.7);
      expect(room().state.phase).toBe('LOBBY');

      back.drop();
      const closed = await display.next(
        (m) => m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'ROOM_CLOSED',
        WINDOW_MS + 5_000,
        'ROOM_CLOSED',
      );
      expect(closed.type === 'PHASE_ENTERED' && closed.payload.data).toMatchObject({
        phase: 'ROOM_CLOSED',
        reason: 'ABANDONED',
      });
      expect(room().state.closed?.reason).toBe('ABANDONED');
      await display.close();
    } finally {
      await server.stop();
    }
  }, 60_000);

  it('does not close a room because the server restarted (phones reconnect within seconds)', async () => {
    const a = await startServer({ database, gameConfig: CONFIG });
    const created = await createRoom(a);
    const display = await TestClient.connect(a.wsUrl);
    await display.attachDisplay(created);
    const p1 = await TestClient.connect(a.wsUrl);
    await p1.join(a.wsUrl, created.code, 'Bir');
    const p2 = await TestClient.connect(a.wsUrl);
    await p2.join(a.wsUrl, created.code, 'Iki');
    // 'p2' drops for good before the restart: its stale stamp must not shorten anyone's window
    p2.drop();
    await sleep(500);

    await a.stop();
    await sleep(WINDOW_MS * 0.3); // the outage is not part of the window
    const restartedAt = Date.now();
    const b = await startServer({ database, gameConfig: CONFIG });
    try {
      const room = () => b.built.manager.getByCode(created.code)!;
      expect(room().state.phase).toBe('LOBBY');
      for (const player of Object.values(room().state.players))
        expect(player.disconnectedAt).toBeGreaterThanOrEqual(restartedAt - 1_000);

      await sleep(2_000); // client back-off after a 1012 close
      const back1 = await comeBack(b.wsUrl, p1);
      await sleep(WINDOW_MS + 1_500); // longer than the window counted from the restart
      expect(room().state.phase).toBe('LOBBY');
      await back1.close();
    } finally {
      await b.stop();
    }
  }, 60_000);
});
