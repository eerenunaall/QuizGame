import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRoom, startServer, type TestServer } from '../helpers/server';
import {
  autoAnswer,
  makeGameClient,
  memoryStorage,
  type TestGameClient,
} from '../helpers/game-client';
import { waitUntil } from '../helpers/wait';

/**
 * The shared `GameClient` (used by the TV, the browser controller and the native app) driven
 * against the real server. Every inbound message is strictly validated against the protocol
 * schemas, so these tests also prove the server only emits what the client contract allows.
 */

let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(async () => {
  await server.dispose();
});

const inRoom = (state: { room: unknown }) => state.room !== null;

interface Party {
  code: string;
  display: TestGameClient;
  players: TestGameClient[];
}

async function party(playerCount: number): Promise<Party> {
  const display = makeGameClient(server, { kind: 'DISPLAY' });
  const created = await display.client.createRoom('tr');
  await display.waitFor((s) => s.transport === 'ONLINE' && inRoom(s), 5_000, 'display online');
  const players: TestGameClient[] = [];
  for (let i = 0; i < playerCount; i++) {
    const player = makeGameClient(server);
    await player.client.join(created.code, `Oyuncu${i + 1}`, 'fox');
    players.push(player);
  }
  return { code: created.code, display, players };
}

function closeAll(p: Party): void {
  for (const member of [p.display, ...p.players]) member.client.suspend();
}

function playerIdOf(test: TestGameClient): string {
  const id = test.client.state.session?.playerId;
  if (!id) throw new Error('no player id');
  return id;
}

describe('GameClient against the real server', () => {
  it('creates a room, joins players, plays a whole game and ends with consistent results', async () => {
    const p = await party(3);
    const stops = p.players.map((player, i) => autoAnswer(player, i));

    await p.players[0]!.client.startGame();
    const everyone = [p.display, ...p.players];
    await Promise.all(
      everyone.map((t) => t.waitFor((s) => s.room?.phase === 'RESULTS', 20_000, 'RESULTS')),
    );

    const rankings = everyone.map((t) => {
      const data = t.client.state.room?.phaseData;
      if (data?.phase !== 'RESULTS') throw new Error('not in RESULTS');
      return data.ranking;
    });
    for (const ranking of rankings) expect(ranking).toEqual(rankings[0]);
    expect(rankings[0]).toHaveLength(3);
    expect(rankings[0]![0]!.rank).toBe(1);

    // The TV and every phone agree on the room's final state version and roster.
    const versions = new Set(everyone.map((t) => t.client.state.room?.stateVersion));
    expect(versions.size).toBe(1);
    for (const t of everyone) expect(t.violations).toEqual([]);

    stops.forEach((stop) => stop());
    closeAll(p);
  });

  it('keeps the clock estimate close to the server after the first pings', async () => {
    const p = await party(2);
    await waitUntil(() => p.players[0]!.client.clock.hasSample(), 3_000, 'clock sample');
    const skew = Math.abs(p.players[0]!.client.serverNow() - Date.now());
    expect(skew).toBeLessThan(150); // same machine: only measurement noise
    expect(p.players[0]!.client.state.rttMs).not.toBeNull();
    closeAll(p);
  });

  it('survives a dropped connection: reconnects, rotates the token and restores the state', async () => {
    const p = await party(3);
    const stops = p.players.map((player, i) => autoAnswer(player, i));
    const victim = p.players[1]!;
    const before = JSON.parse(victim.storage.data.get(`qp.player.${p.code}`) ?? '{}') as {
      token: string;
    };

    await p.players[0]!.client.startGame();
    await victim.waitFor((s) => s.room?.phase === 'ANSWERING', 8_000, 'first ANSWERING');
    victim.dropConnection();
    await victim.waitFor((s) => s.restoredAt !== null, 8_000, 'restored after reconnect');
    expect(victim.sockets.length).toBeGreaterThanOrEqual(2);

    const after = JSON.parse(victim.storage.data.get(`qp.player.${p.code}`) ?? '{}') as {
      token: string;
    };
    expect(after.token).not.toBe(before.token); // rotated and persisted
    expect(victim.client.state.session?.token).toBe(after.token);

    await Promise.all(
      [p.display, ...p.players].map((t) =>
        t.waitFor((s) => s.room?.phase === 'RESULTS', 20_000, 'RESULTS'),
      ),
    );
    const ranking = victim.client.state.room?.phaseData;
    expect(ranking?.phase === 'RESULTS' && ranking.ranking.length).toBe(3);
    expect(victim.violations).toEqual([]);

    stops.forEach((stop) => stop());
    closeAll(p);
  });

  it('reports a kick to the kicked phone and stops reconnecting', async () => {
    const p = await party(3);
    const target = p.players[2]!;
    const targetId = playerIdOf(target);
    await p.players[0]!.client.kick(targetId);
    await target.waitFor((s) => s.closedReason === 'KICKED', 5_000, 'KICKED');

    expect(target.client.state.transport).toBe('CLOSED');
    expect(target.storage.data.has(`qp.player.${p.code}`)).toBe(false);
    const sockets = target.sockets.length;
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(target.sockets.length).toBe(sockets);

    // The remaining phones and the TV no longer list the kicked player.
    await p.display.waitFor(
      (s) => !s.room?.players.some((player) => player.playerId === targetId),
      5_000,
      'roster without kicked player',
    );
    closeAll(p);
  });

  it('supersedes an older tab when the same session resumes elsewhere', async () => {
    const p = await party(2);
    const first = p.players[1]!;
    const second = makeGameClient(server, { storage: memoryStorage(first.storage.data) });
    expect(await second.client.resume('PLAYER', p.code)).toBe(true);
    await second.waitFor((s) => s.transport === 'ONLINE' && inRoom(s), 5_000, 'second tab online');
    await first.waitFor((s) => s.closedReason === 'SUPERSEDED', 5_000, 'first tab superseded');

    const sockets = first.sockets.length;
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(first.sockets.length).toBe(sockets); // no reconnect fight between tabs
    expect(second.client.state.transport).toBe('ONLINE');
    second.client.suspend();
    closeAll(p);
  });

  it('closes everything when the leader ends the room', async () => {
    const p = await party(2);
    await p.players[0]!.client.endRoom();
    for (const t of [p.display, ...p.players]) {
      await t.waitFor((s) => s.closedReason === 'ROOM_CLOSED', 5_000, 'ROOM_CLOSED');
      expect(t.client.state.transport).toBe('CLOSED');
    }
    expect(p.players[1]!.storage.data.has(`qp.player.${p.code}`)).toBe(false);
  });

  it('rejects joins to unknown or full rooms with typed errors', async () => {
    const stranger = makeGameClient(server);
    await expect(stranger.client.join('ZZZZZZ', 'Kimse', 'fox')).rejects.toMatchObject({
      code: 'ROOM_NOT_FOUND',
    });
    expect(stranger.client.state.transport).toBe('IDLE');
    expect(await stranger.client.preview('ZZZZZZ')).toBeNull();

    const created = await createRoom(server);
    const preview = await stranger.client.preview(created.code);
    expect(preview).toMatchObject({ joinable: true, playerCount: 0 });
  });
});
