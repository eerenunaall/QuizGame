import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@quizparty/protocol';
import { CSRF_HEADER, SESSION_COOKIE } from '../../apps/realtime/src/auth/guard';
import { staff as adminStaff } from '../helpers/admin';
import { correctOptionId, wrongOptionId } from '../helpers/oracle';
import { closeParty, createParty } from '../helpers/party';
import { call } from '../helpers/payments';
import { createRoom, startServer, type TestServer } from '../helpers/server';
import { makeVenue, person, setVenueFlag, staffApi, type VenueFixture } from '../helpers/venue';

/**
 * ATTACK 36 — venue mode (ADR-0024). The meter is money in a café: whoever can extend, pause or end a
 * table, or redeem a code, takes something from the venue. Every venue route is walked as a stranger,
 * as staff of another venue and with forged ids; the reward code is guessed, raced and looked for in
 * every frame that is not the winner's.
 */
let server: TestServer;
let strict: TestServer;
let a: VenueFixture;
let b: VenueFixture;
beforeAll(async () => {
  server = await startServer();
  strict = await startServer({ seed: false, env: { RATE_LIMIT_SCALE: '1' } });
  await setVenueFlag(server, true);
  await setVenueFlag(strict, true);
  a = await makeVenue(server, {
    reward: { enabled: true, text: 'Gizli ödül metni', minPlayers: 3 },
  });
  b = await makeVenue(server);
});
afterAll(async () => {
  await Promise.all([server.dispose(), strict.dispose()]);
});

const venueRoutes = (s: TestServer) =>
  s.built.routes.filter(
    (route) => route.url.startsWith('/v1/venues/:venueId') && !route.url.includes('/questions'),
  );
const fill = (url: string, venueId: string, sessionId: string, accountId: string) =>
  url
    .replace(':venueId', venueId)
    .replace(':sessionId', sessionId)
    .replace(':accountId', accountId);

async function openTable(fixture: VenueFixture) {
  const room = await createRoom(server);
  const opened = await staffApi(server, fixture.staff, fixture.venueId).open({
    minutes: 60,
    roomCode: room.code,
  });
  expect(opened.status).toBe(201);
  return { room, sessionId: opened.body.id };
}

const sessionRow = (id: string) =>
  server.db.db
    .selectFrom('venue_sessions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

describe('ATTACK 36 — a stranger at the counter', () => {
  it('walks every venue route: no credentials 401, a stranger and a player app 404, a console session 403', async () => {
    const { sessionId } = await openTable(a);
    const before = await sessionRow(sessionId);
    const stranger = await person(server, 'stranger');
    const app = await person(server, 'app', 'MOBILE');
    const console = await adminStaff(server, ['ADMIN']);
    expect(venueRoutes(server).length).toBe(12);
    for (const route of venueRoutes(server)) {
      const path = fill(route.url, a.venueId, sessionId, a.staff.accountId);
      const body =
        route.method === 'POST'
          ? { minutes: 60, roomCode: 'ABCDEF', code: 'ABCD2345', email: 'x@y.co' }
          : undefined;
      const label = `${route.method} ${route.url}`;
      const as = async (token?: string) =>
        (
          await call(server, route.method, path, {
            cookies: false,
            ...(token ? { token } : {}),
            ...(body ? { body } : {}),
          })
        ).status;
      expect({ label, status: await as() }).toEqual({ label, status: 401 });
      expect({ label, status: await as(stranger.token) }).toEqual({ label, status: 404 });
      expect({ label, status: await as(app.token) }).toEqual({ label, status: 404 });
      expect({ label, status: await as(console.token) }).toEqual({ label, status: 403 });
    }
    // nothing about the table changed, and the staff were not removed
    expect(await sessionRow(sessionId)).toEqual(before);
    const people = await staffApi(server, a.owner, a.venueId).staff();
    expect(JSON.stringify(people.body)).toContain(a.staff.email);
  });

  it('refuses cookie writes without the CSRF proof (a hostile page in the waiter’s browser)', async () => {
    const { sessionId } = await openTable(a);
    const cookie = `${SESSION_COOKIE}=${a.staff.token}`;
    for (const headers of [
      { cookie } as Record<string, string>,
      { cookie, origin: 'https://evil.example', [CSRF_HEADER]: '1' },
      { cookie, origin: 'http://localhost:5173' },
    ]) {
      const result = await call(
        server,
        'POST',
        `/v1/venues/${a.venueId}/sessions/${sessionId}/end`,
        {
          cookies: false,
          headers,
          body: {},
        },
      );
      expect(result.status).toBe(403);
    }
    expect((await sessionRow(sessionId)).state).toBe('RUNNING');
  });
});

describe('ATTACK 36 — staff of venue A reach for venue B', () => {
  it('cannot list, extend, pause, end, redeem or configure anything of B, by B’s path or by A’s', async () => {
    const { sessionId } = await openTable(b);
    const before = await sessionRow(sessionId);
    const asA = staffApi(server, a.owner, b.venueId);
    for (const result of [
      await asA.sessions(),
      await asA.extend(sessionId, 60),
      await asA.pause(sessionId),
      await asA.end(sessionId),
      await asA.redeem('ABCD2345'),
      await asA.saveSettings({ defaultMinutes: 5 }),
      await asA.invite(a.owner.email),
    ])
      expect(result.status).toBe(404);
    // B's session through A's own venue path: unknown there
    const own = staffApi(server, a.owner, a.venueId);
    for (const result of [
      await own.extend(sessionId, 60),
      await own.pause(sessionId),
      await own.resume(sessionId),
      await own.end(sessionId),
    ])
      expect(result.status).toBe(404);
    expect(await sessionRow(sessionId)).toEqual(before);
  });

  it('cannot attach B’s open table again or steal its TV with a second table', async () => {
    const { room } = await openTable(b);
    const steal = await staffApi(server, a.staff, a.venueId).open({
      minutes: 600,
      roomCode: room.code,
    });
    expect(steal.status).toBe(409);
  });
});

describe('ATTACK 36 — forged ids and links', () => {
  it('answers 404 for random, malformed and injected session ids; 404 for dead or foreign link tokens', async () => {
    const api = staffApi(server, a.staff, a.venueId);
    for (const id of [
      '00000000-0000-4000-8000-000000000000',
      'not-a-uuid',
      "1' OR '1'='1",
      '..%2F..%2Fadmin',
    ])
      for (const result of [await api.extend(id, 5), await api.end(id), await api.pause(id)])
        expect(result.status).toBe(404);
    for (const link of ['A'.repeat(22), 'B'.repeat(40)])
      expect((await api.open({ minutes: 60, link })).status).toBe(404);

    // a link the TV handed to someone else (claimed by another account) is not the waiter's to use;
    // the TV's own fresh link is (that is how staff open a table by scanning the QR)
    const party = await createParty(server, 1);
    await server.built.manager.get(party.created.roomId)!.applyEntitlement('FREE', null, 'REVOKED');
    const links: string[] = [];
    for (let i = 0; i < 2; i++) {
      party.display.send('REQUEST_UNLOCK_LINK', {});
      links.push((await party.display.nextOfType('UNLOCK_LINK')).payload.url.split('/unlock/')[1]!);
    }
    const guest = await person(server, 'guest');
    const claimed = await call(server, 'POST', `/v1/link-intents/${links[0]}/claim`, {
      cookies: false,
      token: guest.token,
      body: {},
    });
    expect(claimed.status).toBe(200);
    expect((await api.open({ minutes: 60, link: links[0]! })).status).toBe(404);
    const viaQr = await api.open({ minutes: 60, link: links[1]! });
    expect(viaQr.status).toBe(201);
    expect(viaQr.body.roomCode).toBe(party.created.code);
    await api.end(viaQr.body.id);
    await closeParty(party);
  });

  it('does not open a table on a TV in the middle of a game', async () => {
    const party = await createParty(server, 2);
    party.leader.send('START_GAME', {});
    await party.display.waitForPhase('COUNTDOWN');
    const result = await staffApi(server, a.staff, a.venueId).open({
      minutes: 60,
      roomCode: party.created.code,
    });
    expect(result.body).toEqual({ error: { code: 'GAME_IN_PROGRESS' } });
    await closeParty(party);
  });

  it('no client message can touch the meter: the engine input has no wire form', async () => {
    const party = await createParty(server, 1);
    for (const type of ['VENUE_METER', 'VENUE_METER_CHANGED', 'VENUE_REWARD']) {
      party.leader.sendRaw(
        JSON.stringify({
          protocolVersion: 1,
          type,
          messageId: crypto.randomUUID(),
          roomId: party.created.roomId,
          sessionId: party.leader.sessionId,
          sequence: 99,
          sentAt: Date.now(),
          payload: { meter: { state: 'RUNNING', endsAt: Date.now() + 9e9, remainingMs: 0 } },
        }),
      );
      const reply = await party.leader.nextOfType('ERROR');
      expect(reply.payload.code).toBe('INVALID_MESSAGE');
    }
    expect(server.built.manager.get(party.created.roomId)!.venueMeter()).toBeNull();
    await closeParty(party);
  });
});

describe('ATTACK 36 — guessing and racing reward codes', () => {
  it('rate-limits guessing per account, and per venue across several waiters', async () => {
    await setVenueFlag(strict, true);
    const venue = await makeVenue(strict);
    const helpers = [venue.staff, venue.owner];
    for (let i = 0; i < 3; i++) {
      const extra = await person(strict, `garson${i}`);
      await strict.built.venues.addStaff(venue.venueId, extra.email, 'STAFF', null);
      helpers.push(extra);
    }
    const one = staffApi(strict, venue.staff, venue.venueId);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push((await one.redeem(`ZZZZ${2222 + i}`.slice(0, 8))).status);
    // wrong codes cost double: an account is stopped after a handful of guesses
    expect(statuses.filter((s) => s === 404).length).toBeLessThanOrEqual(5);
    expect(statuses.at(-1)).toBe(429);

    // the venue bucket stops a crew of accounts too
    const crew: number[] = [];
    for (let round = 0; round < 6; round++)
      for (const who of helpers.slice(1))
        crew.push((await staffApi(strict, who, venue.venueId).redeem('YYYY3333')).status);
    expect(crew.filter((s) => s === 404).length).toBeLessThan(20);
    expect(crew.at(-1)).toBe(429);
  });

  it('lets exactly one of many simultaneous redeems win', async () => {
    const { room, sessionId } = await openTable(a);
    await server.db.db
      .insertInto('venue_rewards')
      .values({
        venue_id: a.venueId,
        session_id: sessionId,
        room_id: room.roomId,
        game_id: crypto.randomUUID(),
        winner_display_name: 'Ece',
        reward_text: 'Gizli ödül metni',
        code_hash: server.built.venues.rewardHash('RACE2345'),
        issued_at: new Date(),
        expires_at: new Date(Date.now() + 3_600_000),
      })
      .execute();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        staffApi(server, i % 2 ? a.owner : a.staff, a.venueId).redeem('RACE2345'),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200))
      expect(r.body.error?.code).toBe('REWARD_ALREADY_REDEEMED');
    const events = await server.db.db
      .selectFrom('venue_session_events')
      .select('kind')
      .where('session_id', '=', sessionId)
      .where('kind', '=', 'REDEEM')
      .execute();
    expect(events).toHaveLength(1);
  });

  it('a code of venue A is unknown at venue B', async () => {
    const { room, sessionId } = await openTable(a);
    await server.db.db
      .insertInto('venue_rewards')
      .values({
        venue_id: a.venueId,
        session_id: sessionId,
        room_id: room.roomId,
        game_id: crypto.randomUUID(),
        winner_display_name: 'Ece',
        reward_text: 'Gizli ödül metni',
        code_hash: server.built.venues.rewardHash('CROS2345'),
        issued_at: new Date(),
        expires_at: new Date(Date.now() + 3_600_000),
      })
      .execute();
    expect((await staffApi(server, b.staff, b.venueId).redeem('CROS2345')).status).toBe(404);
  });
});

describe('ATTACK 36 — payload scan: the code and the venue stay off every other screen', () => {
  it('only the winner’s phone ever carries the code; no frame carries settings, staff or the venue name', async () => {
    const party = await createParty(server, 3);
    const opened = await staffApi(server, a.staff, a.venueId).open({
      minutes: 60,
      roomCode: party.created.code,
    });
    const stops = party.players.map((client, index) =>
      client.subscribe((message: ServerMessage) => {
        if (message.type !== 'PHASE_ENTERED' || message.payload.data.phase !== 'ANSWERING') return;
        client.send('SUBMIT_ANSWER', {
          questionId: message.payload.data.questionId,
          optionId:
            index === 1
              ? correctOptionId(server, party.created.roomId)
              : wrongOptionId(server, party.created.roomId),
        });
      }),
    );
    party.leader.send('START_GAME', {});
    await party.display.waitForPhase('RESULTS', 20_000);
    const winner = party.players[1]!;
    const reward = await winner.nextOfType('VENUE_REWARD', 5000);
    await party.display.idle(300);
    const venueName = (
      await server.db.db
        .selectFrom('venues')
        .select('name')
        .where('id', '=', a.venueId)
        .executeTakeFirstOrThrow()
    ).name;
    const secrets = [
      reward.payload.code,
      'Gizli ödül metni',
      venueName,
      a.staff.email,
      a.venueId,
      opened.body.id,
    ];
    for (const client of [party.display, party.players[0]!, party.players[2]!])
      for (const frame of client.frames)
        for (const secret of secrets) expect(frame).not.toContain(secret);
    for (const frame of [...party.display.frames, ...party.players.flatMap((p) => p.frames)])
      for (const key of [
        'maxPerDay',
        'rematchCooldownMinutes',
        'extendSteps',
        'defaultMinutes',
        'timezone',
        'purchasedMinutes',
        'staff',
        'venueId',
        'codeHash',
      ])
        expect(frame).not.toContain(`"${key}"`);
    // the winner learns their code and the reward, nothing about the venue's rules
    for (const frame of winner.frames)
      for (const secret of [venueName, a.staff.email, opened.body.id])
        expect(frame).not.toContain(secret);
    stops.forEach((stop) => stop());
    await closeParty(party);
  });
});
