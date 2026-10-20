import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiErrorBodySchema,
  CategoryCatalogSchema,
  ConfigResponseSchema,
  CreateRoomResponseSchema,
  RoomPreviewSchema,
} from '@quizparty/protocol';
import { closeParty, createParty } from '../helpers/party';
import { startServer, type TestServer } from '../helpers/server';
import { waitUntil } from '../helpers/wait';

let server: TestServer;
let freeServer: TestServer;
beforeAll(async () => {
  server = await startServer();
  freeServer = await startServer({ env: { DEFAULT_ROOM_TIER: 'FREE' } });
});
afterAll(async () => {
  await server.dispose();
  await freeServer.dispose();
});

describe('HTTP contract', () => {
  it('serves the category catalog in the room language, validated against the shared schema', async () => {
    const response = await fetch(`${server.httpUrl}/v1/categories?language=tr`);
    expect(response.status).toBe(200);
    const catalog = CategoryCatalogSchema.parse(await response.json());
    expect(catalog.language).toBe('tr');
    expect(catalog.categories.map((c) => c.id)).toEqual(
      expect.arrayContaining(['history', 'geography', 'science', 'sports', 'music', 'cinema']),
    );
    expect(catalog.categories.find((c) => c.id === 'history')).toMatchObject({
      label: 'Tarih',
      questions: 12,
    });
    // exactly one category is the free one this week, and it exists in the list
    expect(catalog.categories.filter((c) => c.free)).toHaveLength(1);
    expect(catalog.categories.find((c) => c.free)!.id).toBe(catalog.freeCategoryId);

    const english = CategoryCatalogSchema.parse(
      await (await fetch(`${server.httpUrl}/v1/categories?language=en`)).json(),
    );
    // the seed bank is Turkish only: an English lobby offers nothing instead of a broken game
    expect(english.categories).toEqual([]);
    expect(english.freeCategoryId).toBeNull();
  });

  it('defaults to Turkish and refuses unknown languages or parameters', async () => {
    const fallback = CategoryCatalogSchema.parse(
      await (await fetch(`${server.httpUrl}/v1/categories`)).json(),
    );
    expect(fallback.language).toBe('tr');
    for (const query of ['?language=de', '?language=tr&extra=1', '?language=']) {
      const response = await fetch(`${server.httpUrl}/v1/categories${query}`);
      expect(response.status, query).toBe(400);
      expect(ApiErrorBodySchema.parse(await response.json()).error.code).toBe('INVALID_MESSAGE');
    }
  });

  it('keeps the room creation, preview and config responses on their schemas', async () => {
    const created = await fetch(`${server.httpUrl}/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: { kind: 'DISPLAY', version: 'test' }, locale: 'tr' }),
    });
    expect(created.status).toBe(201);
    const room = CreateRoomResponseSchema.parse(await created.json());
    const preview = RoomPreviewSchema.parse(
      await (await fetch(`${server.httpUrl}/v1/rooms/${room.code}/preview`)).json(),
    );
    expect(preview).toMatchObject({ code: room.code, joinable: true, playerCount: 0 });
    ConfigResponseSchema.parse(await (await fetch(`${server.httpUrl}/v1/config`)).json());
    const missing = await fetch(`${server.httpUrl}/v1/rooms/ZZZZZZ/preview`);
    expect(ApiErrorBodySchema.parse(await missing.json()).error.code).toBe('ROOM_NOT_FOUND');
  });
});

describe('lobby settings over the wire', () => {
  it('lets the leader pick rounds and difficulty and tells everyone', async () => {
    const party = await createParty(server, 2);
    party.leader.send('SET_SETTINGS', { rounds: 15, difficulty: 'HARD' });
    await party.leader.nextOfType('ACK');
    for (const client of [party.display, ...party.players]) {
      const changed = await waitUntil(
        () => client.messages.find((message) => message.type === 'SETTINGS_CHANGED'),
        5_000,
        'SETTINGS_CHANGED',
      );
      if (changed.type !== 'SETTINGS_CHANGED') throw new Error('unexpected message');
      expect(changed.payload.settings).toMatchObject({ rounds: 15, difficulty: 'HARD' });
    }
    // a snapshot (what a reconnecting phone receives) carries the same settings and the tier limits
    const phone = party.players[1]!;
    phone.send('REQUEST_STATE', {});
    const { room } = (await phone.nextOfType('ROOM_STATE')).payload;
    expect(room.settings).toMatchObject({ rounds: 15, difficulty: 'HARD' });
    expect(room.limits.maxRounds).toBe(20);
    await closeParty(party);
  });

  it('refuses out-of-range rounds and unknown difficulties without changing anything', async () => {
    const party = await createParty(server, 2);
    for (const payload of [
      { rounds: 2 },
      { rounds: 21 },
      { difficulty: 'EXPERT' },
      { rounds: 10.5 },
    ]) {
      party.leader.send('SET_SETTINGS', payload);
      expect((await party.leader.nextOfType('ERROR')).payload.code).toBe('INVALID_MESSAGE');
    }
    party.leader.send('REQUEST_STATE', {});
    const state = await party.leader.nextOfType('ROOM_STATE');
    expect(state.payload.room.settings).toMatchObject({ rounds: 3, difficulty: 'MEDIUM' }); // the fast test config's default
    await closeParty(party);
  });

  it('clamps a free room to its shorter game and reports the limit', async () => {
    const party = await createParty(freeServer, 2);
    party.leader.send('SET_SETTINGS', { rounds: 20 });
    await party.leader.nextOfType('ACK');
    party.leader.send('REQUEST_STATE', {});
    const state = await party.leader.nextOfType('ROOM_STATE');
    expect(state.payload.room.tier).toBe('FREE');
    expect(state.payload.room.settings.rounds).toBe(state.payload.room.limits.maxRounds);
    expect(state.payload.room.limits.maxRounds).toBe(5);
    await closeParty(party);
  });
});
