import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminApi, staff as adminStaff } from '../helpers/admin';
import { createRoom, startServer, type TestServer } from '../helpers/server';
import { makeVenue, person, setVenueFlag, staffApi, type VenueFixture } from '../helpers/venue';
import { waitUntil } from '../helpers/wait';

/**
 * Venue mode over HTTP (ADR-0024): the flag, who may do what at which venue, the table meter as it is
 * stored, the reward code check, the admin report. One metered minute lasts one second here
 * (`VENUE_MINUTE_MS`), so time-up and extensions are observable in a test run.
 */
let server: TestServer;
let venue: VenueFixture;
beforeAll(async () => {
  server = await startServer({
    seed: false,
    env: { VENUE_MINUTE_MS: '1000', DEFAULT_ROOM_TIER: 'FREE' },
  });
  await setVenueFlag(server, true);
  venue = await makeVenue(server, { reward: { enabled: true, text: 'Bir içecek bizden' } });
});
afterAll(async () => {
  await server.dispose();
});

const api = (who: { token: string } | null, venueId = venue.venueId) =>
  staffApi(server, who, venueId);

describe('the switch', () => {
  it('answers FEATURE_DISABLED on every staff route while venue.sessions is off', async () => {
    await setVenueFlag(server, false);
    try {
      const staffPage = api(venue.staff);
      for (const result of [
        await staffPage.me(),
        await staffPage.sessions(),
        await staffPage.open({ minutes: 60, roomCode: 'ABCDEF' }),
        await staffPage.redeem('ABCD2345'),
      ])
        expect(result).toEqual({ status: 404, body: { error: { code: 'FEATURE_DISABLED' } } });
    } finally {
      await setVenueFlag(server, true);
    }
  });

  it('is off in a fresh database and not one of the public flags', async () => {
    const flag = await server.db.db
      .selectFrom('feature_flags')
      .selectAll()
      .where('key', '=', 'venue.sessions')
      .executeTakeFirstOrThrow();
    expect(flag.public).toBe(false);
    const fresh = await startServer({ seed: false });
    try {
      expect(await fresh.built.flags.isEnabled('venue.sessions')).toBe(false);
    } finally {
      await fresh.dispose();
    }
  });
});

describe('who may use the staff page', () => {
  it('lists the venues an account works at, with its role', async () => {
    const mine = await api(venue.staff).me();
    expect(mine.status).toBe(200);
    expect(mine.body.venues).toEqual([
      expect.objectContaining({ id: venue.venueId, role: 'STAFF' }),
    ]);
    const owner = await api(venue.owner).me();
    expect(owner.body.venues).toEqual([expect.objectContaining({ role: 'OWNER' })]);
    expect((await api(await person(server)).me()).body.venues).toEqual([]);
  });

  it('needs a signed-in person; an admin-console session is not one', async () => {
    expect((await api(null).sessions()).status).toBe(401);
    const admin = await adminStaff(server, ['ADMIN']);
    expect((await api(admin).sessions()).status).toBe(403);
  });

  it('answers the same 404 for a stranger and for a venue that does not exist', async () => {
    const stranger = await person(server);
    expect(await api(stranger).sessions()).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND' } },
    });
    expect(await api(venue.staff, '00000000-0000-4000-8000-000000000000').sessions()).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND' } },
    });
  });

  it('keeps settings and people to the owner; staff may read the settings they work with', async () => {
    expect((await api(venue.staff).settings()).status).toBe(200);
    expect((await api(venue.staff).saveSettings({ defaultMinutes: 30 })).status).toBe(403);
    expect((await api(venue.staff).staff()).status).toBe(403);
    expect((await api(venue.staff).invite('x@example.com')).status).toBe(403);

    const saved = await api(venue.owner).saveSettings({
      extendSteps: [10, 20],
      defaultMinutes: 45,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.settings).toMatchObject({
      extendSteps: [10, 20],
      defaultMinutes: 45,
      reward: { enabled: true, text: 'Bir içecek bizden', minPlayers: 3, maxPerDay: 10 },
    });
    // an enabled reward without words, a bad zone, an unknown key: refused whole
    for (const patch of [
      { reward: { text: '' } },
      { timezone: 'Mars/Olympus' },
      { extendSteps: [] },
      { price: 100 },
    ])
      expect((await api(venue.owner).saveSettings(patch)).status).toBe(400);
    await api(venue.owner).saveSettings({ extendSteps: [15, 30, 60], defaultMinutes: 60 });
  });

  it('lets the owner add staff by email (the account exists once they sign in) and remove them', async () => {
    const invited = await api(venue.owner).invite('New.Garson@Example.com ');
    expect(invited.status).toBe(201);
    const account = await server.built.accounts.signIn('new.garson@example.com', 'tr');
    expect(account!.id).toBe(invited.body.accountId);
    const people = await api(venue.owner).staff();
    expect(people.body.staff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'new.garson@example.com', role: 'STAFF' }),
        expect.objectContaining({ email: venue.owner.email, role: 'OWNER' }),
      ]),
    );
    // inviting the owner never demotes them, and the owner cannot be removed here
    await api(venue.owner).invite(venue.owner.email);
    expect((await api(venue.owner).me()).body.venues).toEqual([
      expect.objectContaining({ role: 'OWNER' }),
    ]);
    expect((await api(venue.owner).remove(venue.owner.accountId)).status).toBe(409);
    expect((await api(venue.owner).remove(invited.body.accountId as string)).status).toBe(200);
    expect((await api(venue.owner).invite('not-an-address')).status).toBe(400);
  });
});

describe('a table', () => {
  it('opens on a live TV by its room code, unlocks it, and records who did it', async () => {
    const room = await createRoom(server);
    expect(room.tier).toBe('FREE');
    const opened = await api(venue.staff).open({ minutes: 60, roomCode: room.code.toLowerCase() });
    expect(opened.status).toBe(201);
    expect(opened.body).toMatchObject({
      roomCode: room.code,
      state: 'RUNNING',
      purchasedMinutes: 60,
    });
    const live = server.built.manager.get(room.roomId)!;
    await waitUntil(() => live.tier() === 'FULL', 3000, 'tier FULL');
    expect(live.venueMeter()).toMatchObject({ state: 'RUNNING' });

    const events = await server.db.db
      .selectFrom('venue_session_events')
      .selectAll()
      .where('session_id', '=', opened.body.id)
      .execute();
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'OPEN',
        staff_account_id: venue.staff.accountId,
        seconds: 3600,
      }),
    ]);
    // one table per TV
    expect((await api(venue.owner).open({ minutes: 30, roomCode: room.code })).status).toBe(409);
    await api(venue.staff).end(opened.body.id);
  });

  it('refuses unknown codes, junk and absurd minutes', async () => {
    expect((await api(venue.staff).open({ minutes: 60, roomCode: 'ZZZZZZ' })).status).toBe(404);
    for (const body of [
      { minutes: 0, roomCode: 'ABCDEF' },
      { minutes: 100_000, roomCode: 'ABCDEF' },
      { minutes: 60 },
      { minutes: 60, roomCode: 'ABCDEF', link: 'x'.repeat(22) },
      { minutes: 60, roomCode: 'ABCDEF', price: 5 },
    ])
      expect((await api(venue.staff).open(body)).status).toBe(400);
  });

  it('meters time: extend, pause, resume, time-up, an extension that does not bill the overrun, end', async () => {
    const room = await createRoom(server);
    const live = server.built.manager.get(room.roomId)!;
    const opened = await api(venue.staff).open({ minutes: 2, roomCode: room.code });
    const id = opened.body.id;
    expect(opened.body.remainingMs).toBeGreaterThan(1500);

    const extended = await api(venue.staff).extend(id, 1);
    expect(extended.body.purchasedMinutes).toBe(3);
    expect(extended.body.remainingMs).toBeGreaterThan(2500);

    const paused = await api(venue.staff).pause(id);
    expect(paused.body.state).toBe('PAUSED');
    const left = paused.body.remainingMs;
    await new Promise((resolve) => setTimeout(resolve, 400));
    const still = (await api(venue.staff).sessions()).body.items.find((s) => s.id === id)!;
    expect(still.remainingMs).toBe(left);
    expect((await api(venue.staff).pause(id)).status).toBe(409);
    expect((await api(venue.staff).resume(id)).body.state).toBe('RUNNING');

    // time runs out; the server tells the room and takes the full game back (no guest account linked)
    await waitUntil(() => live.tier() === 'FREE', 6000, 'time-up drops the tier');
    const up = (await api(venue.staff).sessions()).body.items.find((s) => s.id === id)!;
    expect(up).toMatchObject({ timeUp: true, remainingMs: 0 });
    expect((await api(venue.staff).pause(id)).status).toBe(409);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const again = await api(venue.staff).extend(id, 2);
    // two minutes from now, not two minus the overrun since the time ran out
    expect(again.body.remainingMs).toBeGreaterThan(1700);
    await waitUntil(() => live.tier() === 'FULL', 3000, 'extension unlocks again');

    const ended = await api(venue.staff).end(id);
    expect(ended.body.state).toBe('ENDED');
    expect(live.venueMeter()?.state).toBe('ENDED');
    for (const result of [
      await api(venue.staff).extend(id, 5),
      await api(venue.staff).end(id),
      await api(venue.staff).resume(id),
    ])
      expect(result.status).toBe(409);

    const kinds = (
      await server.db.db
        .selectFrom('venue_session_events')
        .select('kind')
        .where('session_id', '=', id)
        .orderBy('id')
        .execute()
    ).map((row) => row.kind);
    expect(kinds).toEqual(['OPEN', 'EXTEND', 'PAUSE', 'RESUME', 'EXTEND', 'END']);
  });

  it('a late push of an older row cannot roll the TV back (two waiters extending at once)', async () => {
    const room = await createRoom(server);
    const live = server.built.manager.get(room.roomId)!;
    const opened = await api(venue.staff).open({ minutes: 2, roomCode: room.code });
    const id = opened.body.id;
    const older = await server.db.db
      .selectFrom('venue_sessions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    const extended = await api(venue.owner).extend(id, 30);
    expect(extended.status).toBe(200);
    const fresh = live.venueMeter()!.endsAt!;
    // the first waiter's continuation runs after the second one's push, with the row it committed
    const service = server.built.venues as unknown as {
      push(row: typeof older, reason: 'GRANTED'): Promise<void>;
    };
    await service.push(older, 'GRANTED');
    expect(live.venueMeter()!.endsAt!).toBeGreaterThanOrEqual(fresh);
    await api(venue.staff).end(id);
  });

  it('the kill switch lets go of running tables: a TV does not wait for staff who can no longer reach it', async () => {
    const room = await createRoom(server);
    const live = server.built.manager.get(room.roomId)!;
    const opened = await api(venue.staff).open({ minutes: 1, roomCode: room.code });
    const id = opened.body.id;
    await waitUntil(() => live.tier() === 'FULL', 3000, 'tier FULL');
    await setVenueFlag(server, false);
    try {
      await server.built.venues.sweep();
      // base product again: no meter on the room, no time-up screen, nothing to extend
      expect(live.venueMeter()).toBeNull();
      await waitUntil(() => live.tier() === 'FREE', 3000, 'tier back to the free game');
    } finally {
      await setVenueFlag(server, true);
    }
    // switched on again, the same table is the staff's to extend
    const back = await api(venue.staff).extend(id, 5);
    expect(back.status).toBe(200);
    await waitUntil(() => live.venueMeter()?.state === 'RUNNING', 3000, 'meter is back');
    await waitUntil(() => live.tier() === 'FULL', 3000, 'full game is back');
    await api(venue.staff).end(id);
  });

  it('caps the minutes one table may hold', async () => {
    const room = await createRoom(server);
    const opened = await api(venue.staff).open({ minutes: 720, roomCode: room.code });
    expect((await api(venue.staff).extend(opened.body.id, 720)).status).toBe(200);
    expect((await api(venue.staff).extend(opened.body.id, 1)).body).toEqual({
      error: { code: 'LIMIT_REACHED' },
    });
    await api(venue.staff).end(opened.body.id);
  });

  it('keeps the audit log append-only', async () => {
    await expect(
      server.db.db.updateTable('venue_session_events').set({ seconds: 1 }).execute(),
    ).rejects.toThrow(/append-only/u);
  });
});

describe('reward codes at the counter', () => {
  async function plantReward(code: string, expiresAt = Date.now() + 3_600_000) {
    const room = await createRoom(server);
    const opened = await api(venue.staff).open({ minutes: 60, roomCode: room.code });
    await server.db.db
      .insertInto('venue_rewards')
      .values({
        venue_id: venue.venueId,
        session_id: opened.body.id,
        room_id: room.roomId,
        game_id: crypto.randomUUID(),
        winner_display_name: 'Ece',
        reward_text: 'Bir içecek bizden',
        code_hash: server.built.venues.rewardHash(code),
        issued_at: new Date(),
        expires_at: new Date(expiresAt),
      })
      .execute();
    return opened.body.id;
  }

  it('redeems once, shows what was won, then refuses with the time it was used', async () => {
    await plantReward('ABCD2345');
    const first = await api(venue.staff).redeem('abcd-2345');
    expect(first).toEqual({
      status: 200,
      body: expect.objectContaining({ text: 'Bir içecek bizden', winner: 'Ece' }),
    });
    const second = await api(venue.owner).redeem('ABCD2345');
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('REWARD_ALREADY_REDEEMED');
    const row = await server.db.db
      .selectFrom('venue_rewards')
      .select(['redeemed_at', 'redeemed_by'])
      .where('code_hash', '=', server.built.venues.rewardHash('ABCD2345'))
      .executeTakeFirstOrThrow();
    expect(row.redeemed_by).toBe(venue.staff.accountId);
  });

  it('says a code of a past day is expired, and an unknown one is just unknown', async () => {
    await plantReward('EFGH6789', Date.now() - 1000);
    expect((await api(venue.staff).redeem('EFGH6789')).body.error?.code).toBe('REWARD_EXPIRED');
    expect((await api(venue.staff).redeem('ZZZZ2222')).status).toBe(404);
    expect((await api(venue.staff).redeem('O0O0I1L1')).status).toBe(404);
  });

  it('never stores a code in the clear', async () => {
    const rows = JSON.stringify(
      await server.db.db.selectFrom('venue_rewards').selectAll().execute(),
    );
    expect(rows).not.toContain('ABCD2345');
  });
});

describe('the admin console', () => {
  it('creates a venue with its owner, changes the owner, and reports per day as JSON and CSV', async () => {
    const admin = adminApi(server, await adminStaff(server, ['ADMIN']));
    const support = adminApi(server, await adminStaff(server, ['SUPPORT']));
    const created = await admin.post<{ id: string }>('/v1/admin/venues', {
      name: 'Gusto Board Game Cafe',
      ownerEmail: 'sahip@gusto.example',
    });
    expect(created.status).toBe(201);
    expect(
      (await support.post('/v1/admin/venues', { name: 'x', ownerEmail: 'a@b.co' })).status,
    ).toBe(403);
    const list = await support.get<{ items: { id: string; owners: string[] }[] }>(
      '/v1/admin/venues',
    );
    expect(list.body.items.find((v) => v.id === created.body.id)?.owners).toEqual([
      'sahip@gusto.example',
    ]);

    const moved = await admin.post(`/v1/admin/venues/${created.body.id}/owner`, {
      email: 'yeni@gusto.example',
    });
    expect(moved.status).toBe(200);
    const after = await support.get<{ items: { id: string; owners: string[] }[] }>(
      '/v1/admin/venues',
    );
    expect(after.body.items.find((v) => v.id === created.body.id)?.owners).toEqual([
      'yeni@gusto.example',
    ]);

    const report = await support.get<{
      days: {
        sessions: number;
        minutesSold: number;
        extensions: number;
        rewardsIssued: number;
        rewardsRedeemed: number;
      }[];
    }>(`/v1/admin/venues/${venue.venueId}/report`);
    expect(report.status).toBe(200);
    const total = report.body.days.reduce(
      (sum, d) => ({
        sessions: sum.sessions + d.sessions,
        extensions: sum.extensions + d.extensions,
        issued: sum.issued + d.rewardsIssued,
        redeemed: sum.redeemed + d.rewardsRedeemed,
      }),
      { sessions: 0, extensions: 0, issued: 0, redeemed: 0 },
    );
    expect(total.sessions).toBeGreaterThanOrEqual(5);
    expect(total.extensions).toBeGreaterThanOrEqual(3);
    expect(total.issued).toBe(2);
    expect(total.redeemed).toBe(1);

    const csv = await support.get(`/v1/admin/venues/${venue.venueId}/report?format=csv`);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toBe(
      'date,sessions,minutes_sold,extensions,rewards_issued,rewards_redeemed',
    );
    // counts only: no nicknames, no addresses, no codes
    expect(csv.text).not.toContain('Ece');
    expect(csv.text).not.toContain('@');
    expect(
      (await support.get(`/v1/admin/venues/${venue.venueId}/report?from=2026-13-01`)).status,
    ).toBe(400);
    // right shape, not a date: a bad request, never a failed query
    expect(
      (await support.get(`/v1/admin/venues/${venue.venueId}/report?from=2026-02-31&to=2026-03-01`))
        .status,
    ).toBe(400);
  });

  it("reports tonight's tables after local midnight by default: the venue's day, not UTC's", async () => {
    // 01:30 in Istanbul is still 22:30 of the day before in UTC; a café is open at that hour.
    const offset = Date.parse('2026-10-26T22:30:00Z') - Date.now();
    const late = await startServer({ seed: false, clock: { now: () => Date.now() + offset } });
    try {
      await setVenueFlag(late, true);
      const cafe = await makeVenue(late);
      const room = await createRoom(late);
      const opened = await staffApi(late, cafe.staff, cafe.venueId).open({
        minutes: 60,
        roomCode: room.code,
      });
      expect(opened.status).toBe(201);
      const admin = adminApi(late, await adminStaff(late, ['SUPPORT']));
      const report = await admin.get<{
        from: string;
        to: string;
        days: { date: string; sessions: number; minutesSold: number }[];
      }>(`/v1/admin/venues/${cafe.venueId}/report`);
      expect(report.status).toBe(200);
      expect(report.body.to).toBe('2026-10-27');
      expect(report.body.from).toBe('2026-09-27');
      expect(report.body.days).toEqual([
        expect.objectContaining({ date: '2026-10-27', sessions: 1, minutesSold: 60 }),
      ]);
      const csv = await admin.get(`/v1/admin/venues/${cafe.venueId}/report?format=csv`);
      expect(csv.text).toContain('\n2026-10-27,1,60,0,0,0\n');
    } finally {
      await late.dispose();
    }
  });
});
