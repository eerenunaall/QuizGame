import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminApi, staff as adminStaff } from '../helpers/admin';
import { TestClient } from '../helpers/client';
import { TvBrowser, displayApi, pairTv } from '../helpers/displays';
import { createRoom, startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, staffApi, type VenueFixture } from '../helpers/venue';
import { waitUntil } from '../helpers/wait';

/**
 * Venue displays over HTTP (ADR-0028): VENUE_LOCK enforced by the server, the pairing flow, seats, the
 * credential's rotation and revocation, "open a game on this TV" and the admin console's view. The server's
 * clock is the wall clock plus an offset the tests move (codes expire, credentials age).
 */
let offset = 0;
const clock = { now: () => Date.now() + offset };
let server: TestServer;
let venue: VenueFixture;
beforeAll(async () => {
  server = await startServer({ seed: false, clock, env: { VENUE_LOCK: '1' } });
  await setVenueFlag(server, true);
  venue = await makeVenue(server);
  // Most tests pair a fresh TV; the seat limit has its own test on a small venue.
  await server.db.db
    .updateTable('venues')
    .set({ display_seats: 50 })
    .where('id', '=', venue.venueId)
    .execute();
});
afterAll(async () => {
  await server.dispose();
});

const panel = (who: { token: string } | null, venueId = venue.venueId) =>
  displayApi(server, who, venueId);

describe('VENUE_LOCK', () => {
  it('refuses room creation without a paired display, from any client', async () => {
    const tv = new TvBrowser(server);
    expect((await tv.createRoom()).status).toBe(403);
    await expect(createRoom(server)).rejects.toThrow(/403/u);
    // An account session (an owner's own phone) is not a display either.
    await expect(
      createRoom(server, { authorization: `Bearer ${venue.owner.token}` }),
    ).rejects.toThrow(/403/u);
  });

  it('tells the TV page the mode, and that it is not paired', async () => {
    const tv = new TvBrowser(server);
    expect((await tv.poll()).body).toEqual({ lock: true, paired: false, pairing: null });
  });

  it('lets a paired TV create a room, and phones join it by code as before', async () => {
    const { tv } = await pairTv(server, venue.owner, venue.venueId);
    const created = await tv.createRoom();
    expect(created.status).toBe(201);
    const preview = await fetch(`${server.httpUrl}/v1/rooms/${created.body.code}/preview`);
    expect(preview.status).toBe(200);
    const phone = await TestClient.connect(server.wsUrl);
    try {
      const room = await phone.join(server.wsUrl, created.body.code, 'Ayşe');
      expect(room.code).toBe(created.body.code);
    } finally {
      await phone.close();
    }
  });
});

describe('pairing', () => {
  it('pairs a TV with the code it shows, in any case and spacing, once', async () => {
    const tv = new TvBrowser(server);
    const started = await tv.startPairing();
    expect(started.status).toBe(201);
    expect(started.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u);
    expect(started.body.pairUrl).toBe(
      `http://localhost:5173/staff?pair=${started.body.code.replace('-', '')}`,
    );
    const pairingCookie = started.setCookies.find((line) => line.startsWith('qp_display_pairing='));
    expect(pairingCookie).toMatch(/HttpOnly/u);
    expect(pairingCookie).toMatch(/SameSite=Strict/u);

    const waiting = await tv.poll();
    expect(waiting.body.paired).toBe(false);
    expect(waiting.body.pairing?.expiresAt).toBe(started.body.expiresAt);

    const typed = ` ${started.body.code.toLowerCase().replace('-', ' - ')} `;
    const claimed = await panel(venue.owner).pair(typed, 'Salon TV 2');
    expect(claimed.status).toBe(201);
    expect(claimed.body.name).toBe('Salon TV 2');

    const paired = await tv.poll();
    expect(paired.body).toMatchObject({
      lock: true,
      paired: true,
      display: { name: 'Salon TV 2' },
    });
    const credential = paired.setCookies.find((line) => line.startsWith('qp_display='));
    expect(credential).toMatch(/HttpOnly/u);
    expect(credential).toMatch(/SameSite=Strict/u);
    expect(credential).toMatch(/Path=\//u);
    expect(tv.jar.has('qp_display_pairing')).toBe(false);
    // The credential is never in a body.
    expect(JSON.stringify(paired.body)).not.toContain(tv.credential!);

    // Single use: the same code again is unknown.
    expect((await panel(venue.owner).pair(started.body.code)).status).toBe(404);
    const listed = await panel(venue.staff).list();
    expect(listed.body.items.find((item) => item.id === claimed.body.id)).toMatchObject({
      name: 'Salon TV 2',
      online: true,
    });
  });

  it('stores only keyed hashes of codes, secrets and credentials', async () => {
    const tv = new TvBrowser(server);
    const started = await tv.startPairing();
    const code = started.body.code.replace('-', '');
    const rows = await server.db.db.selectFrom('venue_display_pairings').selectAll().execute();
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(tv.jar.get('qp_display_pairing')!);
    await panel(venue.owner).pair(code);
    await tv.poll();
    const displays = JSON.stringify(
      await server.db.db.selectFrom('venue_displays').selectAll().execute(),
    );
    expect(displays).not.toContain(tv.credential!);
  });

  it('expires a code after five minutes', async () => {
    const tv = new TvBrowser(server);
    const started = await tv.startPairing();
    offset += 5 * 60_000 + 1000;
    try {
      expect((await panel(venue.owner).pair(started.body.code)).status).toBe(404);
      expect((await tv.poll()).body).toEqual({ lock: true, paired: false, pairing: null });
    } finally {
      offset = 0;
    }
  });

  it('is for the OWNER: staff may not pair, a stranger learns nothing', async () => {
    const tv = new TvBrowser(server);
    const started = await tv.startPairing();
    expect((await panel(venue.staff).pair(started.body.code)).status).toBe(403);
    const other = await makeVenue(server);
    expect((await panel(other.owner).pair(started.body.code)).status).toBe(404);
    expect((await panel(null).pair(started.body.code)).status).toBe(401);
  });

  it('never pairs more TVs than the venue has seats, also when claims race', async () => {
    const small = await makeVenue(server);
    await server.db.db
      .updateTable('venues')
      .set({ display_seats: 2 })
      .where('id', '=', small.venueId)
      .execute();
    const tvs = Array.from({ length: 5 }, () => new TvBrowser(server));
    const codes = await Promise.all(tvs.map(async (tv) => (await tv.startPairing()).body.code));
    const results = await Promise.all(
      codes.map((code, i) => panel(small.owner, small.venueId).pair(code, `TV ${i}`)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409).map((r) => r.body.error?.code)).toEqual([
      'LIMIT_REACHED',
      'LIMIT_REACHED',
      'LIMIT_REACHED',
    ]);
    expect((await panel(small.owner, small.venueId).list()).body.items).toHaveLength(2);
  });
});

describe('the credential', () => {
  it('rotates after an hour, survives a lost response, and treats a replayed old copy as theft', async () => {
    const { tv, displayId } = await pairTv(server, venue.owner, venue.venueId, 'Rotating');
    const first = tv.credential!;
    offset += 61 * 60_000;
    try {
      // The successor's cookie is "lost": the TV keeps presenting the current one and is offered again.
      const offered = await tv.poll();
      expect(offered.body.paired).toBe(true);
      expect(tv.credential).not.toBe(first);
      tv.jar.set('qp_display', first);
      const again = await tv.poll();
      expect(again.body.paired).toBe(true);
      const second = tv.credential!;
      expect(second).not.toBe(first);
      // Presenting the successor promotes it.
      expect((await tv.poll()).body.paired).toBe(true);
      // A copy of the old one inside the grace still works (requests already in flight)...
      const copy = new TvBrowser(server);
      copy.jar.set('qp_display', first);
      expect((await copy.poll()).body.paired).toBe(true);
      // ...after it, it revokes the display.
      offset += 31_000;
      expect((await copy.poll()).body.paired).toBe(false);
      expect((await tv.poll()).body.paired).toBe(false);
      const row = await server.db.db
        .selectFrom('venue_displays')
        .select(['revoke_reason'])
        .where('id', '=', displayId)
        .executeTakeFirstOrThrow();
      expect(row.revoke_reason).toBe('REUSE');
      await waitUntil(async () => {
        const events = await server.db.db
          .selectFrom('security_events')
          .select('kind')
          .where('kind', '=', 'DISPLAY_TOKEN_REUSE')
          .execute();
        return events.length > 0;
      });
    } finally {
      offset = 0;
    }
  });

  it('is gone the moment the owner removes the TV: its room closes, it shows the pairing screen', async () => {
    const { tv, displayId } = await pairTv(server, venue.owner, venue.venueId, 'Removed');
    const created = await tv.createRoom();
    const screen = await TestClient.connect(server.wsUrl);
    try {
      await screen.attachDisplay({
        roomId: created.body.roomId,
        display: created.body.display,
      });
      expect((await panel(venue.staff).revoke(displayId)).status).toBe(403);
      expect((await panel(venue.owner).revoke(displayId)).status).toBe(200);
      await screen.next(
        (m) => m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'ROOM_CLOSED',
        5_000,
        'ROOM_CLOSED',
      );
      const after = await tv.poll();
      expect(after.body).toEqual({ lock: true, paired: false, pairing: null });
      expect(tv.credential).toBeNull();
      expect((await tv.createRoom()).status).toBe(403);
    } finally {
      await screen.close();
    }
  });

  it('refuses a cross-site page using the TV cookie (Origin)', async () => {
    const { tv } = await pairTv(server, venue.owner, venue.venueId, 'Origin');
    tv.origin = 'https://evil.example';
    expect((await tv.createRoom()).status).toBe(403);
    expect((await tv.poll()).status).toBe(403);
  });
});

describe('open a game on a TV', () => {
  it('creates a room for the TV, hands it over once, and opens a metered table on it', async () => {
    const { tv, displayId } = await pairTv(server, venue.owner, venue.venueId, 'Bar TV');
    const opened = await panel(venue.staff).open(displayId, 60);
    expect(opened.status).toBe(200);
    expect(opened.body.created).toBe(true);
    expect(opened.body.table).not.toBeNull();
    const polled = await tv.poll();
    expect(polled.body.delivery?.code).toBe(opened.body.roomCode);
    expect((await tv.poll()).body.delivery).toBeUndefined();
    const screen = await TestClient.connect(server.wsUrl);
    try {
      const room = await screen.attachDisplay(polled.body.delivery!);
      expect(room.venue?.state).toBe('RUNNING');
      expect(room.tier).toBe('FULL');
      // The same TV again: its room is in the lobby but already has a table.
      expect((await panel(venue.owner).open(displayId, 30)).body.error?.code).toBe('INVALID_STATE');
      // Without minutes it is just "show me the lobby": the live room is reused.
      const reuse = await panel(venue.owner).open(displayId);
      expect(reuse.body).toMatchObject({ roomCode: opened.body.roomCode, created: false });
      const tables = await staffApi(server, venue.staff, venue.venueId).sessions();
      expect(tables.body.items.some((item) => item.roomCode === opened.body.roomCode)).toBe(true);
    } finally {
      await screen.close();
    }
  });

  it('attaches the table to the room the TV already shows', async () => {
    const { tv, displayId } = await pairTv(server, venue.owner, venue.venueId, 'Own room');
    const created = await tv.createRoom();
    const opened = await panel(venue.staff).open(displayId, 45);
    expect(opened.body).toMatchObject({ roomCode: created.body.code, created: false });
  });

  it('refuses a TV that is not online, and a TV of another venue', async () => {
    const { displayId } = await pairTv(server, venue.owner, venue.venueId, 'Sleeping');
    offset += 20_000;
    try {
      const refused = await panel(venue.owner).open(displayId, 60);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toEqual({ code: 'INVALID_STATE', params: { reason: 'offline' } });
    } finally {
      offset = 0;
    }
    const other = await makeVenue(server);
    expect((await panel(other.owner, other.venueId).open(displayId, 60)).status).toBe(404);
    expect((await panel(other.owner, other.venueId).revoke(displayId)).status).toBe(404);
  });
});

describe('admin console', () => {
  it('lists, revokes and sets the seats', async () => {
    const admin = await adminStaff(server, ['ADMIN']);
    const support = await adminStaff(server, ['SUPPORT']);
    const { tv, displayId } = await pairTv(server, venue.owner, venue.venueId, 'Admin view');
    const listed = await adminApi(server, support).get<{
      items: { id: string; revokedAt: number | null }[];
      seats: number;
    }>(`/v1/admin/venues/${venue.venueId}/displays`);
    expect(listed.status).toBe(200);
    expect(listed.body.items.some((item) => item.id === displayId)).toBe(true);
    expect(
      (
        await adminApi(server, support).post(
          `/v1/admin/venues/${venue.venueId}/displays/${displayId}/revoke`,
          {},
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await adminApi(server, admin).post(
          `/v1/admin/venues/${venue.venueId}/displays/${displayId}/revoke`,
          {},
        )
      ).status,
    ).toBe(200);
    expect((await tv.poll()).body.paired).toBe(false);
    const seats = await adminApi(server, admin).post<{ seats: number }>(
      `/v1/admin/venues/${venue.venueId}/seats`,
      { seats: 7 },
    );
    expect(seats.body).toEqual({ seats: 7 });
    expect((await panel(venue.owner).list()).body.seats).toBe(7);
  });
});

describe('VENUE_LOCK off (the default)', () => {
  it('changes nothing for the public game', async () => {
    const open = await startServer({ seed: false });
    try {
      expect((await createRoom(open)).code).toMatch(/^[A-Z2-9]{6}$/u);
      const tv = new TvBrowser(open);
      expect((await tv.poll()).body).toEqual({ lock: false, paired: false });
      expect((await tv.startPairing()).status).toBe(404);
    } finally {
      await open.dispose();
    }
  });
});
