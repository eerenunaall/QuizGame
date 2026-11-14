import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { appleTransaction } from '../helpers/apple-store';
import type { TestClient } from '../helpers/client';
import { closeParty, createParty, type Party } from '../helpers/party';
import { call, player, startShop, type Player, type Shop } from '../helpers/payments';
import { enablePersonalQuizzes } from '../helpers/quizzes';
import { waitUntil } from '../helpers/wait';

/**
 * Who Said It in a room (ADR-0015, GDD §7.9): the TV's link selects the mode, every phone hands in
 * one moderated statement, the game asks "who said this?" once per statement, the author sits their
 * own question out, and the room's durable traces of the words are erased when it closes.
 */
let shop: Shop;
beforeAll(async () => {
  shop = await startShop({ DEFAULT_ROOM_TIER: 'FREE' });
  await enablePersonalQuizzes(shop.server);
});
afterAll(async () => {
  await shop.dispose();
});
const server = () => shop.server;
const tokenOf = (url: string): string => url.split('/unlock/')[1]!;

async function owner(): Promise<Player> {
  const who = await player(server(), 'WEB');
  const result = await call(server(), 'POST', '/v1/purchases/verify', {
    token: who.token,
    body: {
      platform: 'IOS',
      signedTransaction: shop.apple.sign(appleTransaction(who.storeToken)),
    },
  });
  expect(result.status).toBe(200);
  return who;
}
async function linkFor(party: Party): Promise<string> {
  party.display.send('REQUEST_UNLOCK_LINK', {});
  return tokenOf((await party.display.nextOfType('UNLOCK_LINK')).payload.url);
}
const attachMode = (who: Player, token: string) =>
  call<{ mode?: string; error?: { code: string } }>(
    server(),
    'POST',
    `/v1/link-intents/${token}/quiz`,
    { token: who.token, body: { mode: 'WHO_SAID_IT' } },
  );

async function submit(client: TestClient, text: string) {
  const id = client.send('SUBMIT_STATEMENT', { text });
  return client.next(
    (m) =>
      (m.type === 'ACK' && m.payload.messageId === id) ||
      (m.type === 'ERROR' && m.payload.messageId === id),
    5_000,
    'statement reply',
  );
}

describe('selecting the mode', () => {
  it('needs the flag and the full game, like the other personal modes', async () => {
    // an account that does not own the game cannot select it in a FREE room
    const stranger = await player(server(), 'WEB');
    const first = await createParty(server(), 2);
    expect(await attachMode(stranger, await linkFor(first))).toMatchObject({
      status: 403,
      body: { error: { code: 'TIER_REQUIRED' } },
    });
    expect(server().built.manager.getByCode(first.created.code)!.mode()).toBe('CLASSIC');
    await closeParty(first);

    // an owner is refused while the flag is off, and succeeds (unlocking the room) when it is on
    const buyer = await owner();
    const party = await createParty(server(), 2);
    const token = await linkFor(party);
    const off = server().db.db.updateTable('feature_flags').where('key', '=', 'mode.who_said_it');
    try {
      await off.set({ enabled: false }).execute();
      server().built.flags.invalidate();
      expect(await attachMode(buyer, token)).toMatchObject({
        status: 404,
        body: { error: { code: 'FEATURE_DISABLED' } },
      });
    } finally {
      await enablePersonalQuizzes(server());
    }
    expect(await attachMode(buyer, token)).toMatchObject({
      status: 200,
      body: { mode: 'WHO_SAID_IT' },
    });
    expect(server().built.manager.getByCode(party.created.code)!.mode()).toBe('WHO_SAID_IT');
    await closeParty(party);
  });
});

describe('playing Who Said It', () => {
  it('collects moderated statements, asks who said each one, spares the author and erases the words at close', async () => {
    const run = Date.now();
    const words = [
      `traces-${run}-kediler suyu sever`,
      `traces-${run}-pizza gece yenir`,
      `traces-${run}-ben ağlamam`,
    ];
    const buyer = await owner();
    const party = await createParty(server(), 3);
    const token = await linkFor(party);
    expect((await attachMode(buyer, token)).status).toBe(200);
    for (const client of [party.display, ...party.players]) {
      await client.next(
        (m) => m.type === 'SETTINGS_CHANGED' && m.payload.settings.mode === 'WHO_SAID_IT',
        5_000,
        'mode',
      );
    }

    // moderation, length and shape: refused statements are never echoed and nothing is stored
    const refused = await submit(party.players[0]!, 'bak https://evil.example/x');
    expect(refused).toMatchObject({
      type: 'ERROR',
      payload: { code: 'TEXT_REJECTED', params: { reason: 'LINK' } },
    });
    expect(await submit(party.players[0]!, 'amk')).toMatchObject({
      payload: { code: 'TEXT_REJECTED', params: { reason: 'PROFANITY' } },
    });
    expect(await submit(party.players[0]!, 'x'.repeat(150))).toMatchObject({
      payload: { code: 'TEXT_REJECTED', params: { reason: 'TOO_LONG' } },
    });
    expect(party.display.send('SUBMIT_STATEMENT', { text: 'tv yazamaz' })).toBeTruthy();
    expect((await party.display.nextOfType('ERROR')).payload.code).toBe('FORBIDDEN');
    // not a single frame carries the refused words
    for (const client of [party.display, ...party.players])
      expect(client.frames.join('\n')).not.toContain('evil.example');

    // one per player, editable until the start
    expect((await submit(party.players[0]!, 'ilk fikrim')).type).toBe('ACK');
    expect((await submit(party.players[0]!, words[0]!)).type).toBe('ACK');
    expect((await submit(party.players[1]!, words[1]!)).type).toBe('ACK');
    // the TV and the other phones learn who is in, never what
    const progress = await party.display.next(
      (m) => m.type === 'STATEMENTS_CHANGED' && m.payload.playerIds.length === 2,
      5_000,
      'progress',
    );
    expect(progress.payload).toEqual({
      playerIds: [party.players[0]!.playerId, party.players[1]!.playerId],
    });
    for (const client of [party.display, party.players[1]!, party.players[2]!])
      expect(
        JSON.stringify(client.messages.filter((m) => m.type === 'STATEMENTS_CHANGED')),
      ).not.toContain('fikrim');
    // the display's whole lobby so far holds none of the words; another phone neither
    for (const client of [party.display, party.players[2]!])
      expect(client.frames.join('\n')).not.toContain(`traces-${run}`);

    // two statements are enough to play, but everyone writes one here
    expect((await submit(party.players[2]!, words[2]!)).type).toBe('ACK');
    // the author's own phone can show their words back for editing
    party.players[0]!.send('REQUEST_STATE', {});
    const mine = await party.players[0]!.nextOfType('ROOM_STATE');
    expect(mine.payload.room.you?.myStatement).toBe(words[0]);

    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');

    const byText = new Map(words.map((w, i) => [w, party.players[i]!]));
    const asked: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const entered = await party.players[1]!.waitForPhase('ANSWERING', 20_000);
      const data = entered.payload.data;
      if (data.phase !== 'ANSWERING') throw new Error('not answering');
      asked.push(data.text);
      const author = byText.get(data.text)!;
      // the options are the players, with their avatars' ids, in no revealing order
      expect(data.options.map((o) => o.playerId).sort()).toEqual(
        party.players.map((p) => p.playerId!).sort(),
      );
      const rejectedId = author.send('SUBMIT_ANSWER', {
        questionId: data.questionId,
        optionId: data.options[0]!.optionId,
      });
      const rejected = await author.next(
        (m) => m.type === 'ANSWER_REJECTED' && m.payload.messageId === rejectedId,
      );
      expect(rejected.type === 'ANSWER_REJECTED' && rejected.payload.code).toBe(
        'ANSWER_NOT_ALLOWED',
      );
      for (const client of party.players) {
        if (client === author) continue;
        client.send('SUBMIT_ANSWER', {
          questionId: data.questionId,
          optionId: data.options.find((o) => o.playerId === author.playerId)!.optionId,
        });
      }
      const reveal = await party.players[1]!.waitForPhase('REVEAL', 20_000);
      const revealed = reveal.payload.data;
      if (revealed.phase !== 'REVEAL') throw new Error('not a reveal');
      expect(revealed.options.find((o) => o.optionId === revealed.correctOptionId)!.playerId).toBe(
        author.playerId,
      );
      expect(revealed.results.map((r) => r.playerId)).not.toContain(author.playerId);
      expect(revealed.results.every((r) => r.outcome === 'CORRECT')).toBe(true);
    }
    expect(asked.sort()).toEqual([...words].sort());
    const results = await party.players[1]!.waitForPhase('RESULTS', 40_000);
    if (results.payload.data.phase !== 'RESULTS') throw new Error('not results');
    // every player was right twice and sat one out
    expect(results.payload.data.ranking.map((r) => r.correctCount)).toEqual([2, 2, 2]);

    // close: the log and the snapshot go, and no table keeps a word
    party.leader.send('END_ROOM', {});
    await waitUntil(
      () => server().built.manager.getByCode(party.created.code) === undefined,
      8000,
      'room gone',
    );
    await waitUntil(
      async () =>
        (
          await server()
            .db.db.selectFrom('room_events')
            .select('seq')
            .where('room_id', '=', party.created.roomId)
            .execute()
        ).length === 0,
      5000,
      'events scrubbed',
    );
    const tables = (await server()
      .db.db.selectFrom('information_schema.tables' as never)
      .select('table_name' as never)
      .where('table_schema' as never, '=', 'public' as never)
      .execute()) as unknown as { table_name: string }[];
    for (const { table_name } of tables) {
      const hits = await sql<{
        n: string;
      }>`SELECT count(*)::text AS n FROM ${sql.table(table_name)} t WHERE t::text LIKE ${`%traces-${run}%`}`.execute(
        server().db.db,
      );
      expect(Number(hits.rows[0]!.n), table_name).toBe(0);
    }
    await closeParty(party);
  });

  it('does not start with fewer than two statements and keeps the lobby', async () => {
    const buyer = await owner();
    const party = await createParty(server(), 2);
    const token = await linkFor(party);
    expect((await attachMode(buyer, token)).status).toBe(200);
    await party.leader.next((m) => m.type === 'SETTINGS_CHANGED');
    expect((await submit(party.players[0]!, 'tek cümle')).type).toBe('ACK');
    const id = party.leader.send('START_GAME', {});
    const refused = await party.leader.next(
      (m) => m.type === 'ERROR' && m.payload.messageId === id,
    );
    expect(refused.type === 'ERROR' && refused.payload.code).toBe('NOT_ENOUGH_QUESTIONS');
    await closeParty(party);
  });
});
