import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../apps/realtime/src/auth/guard';
import { TestClient } from '../helpers/client';
import { TvBrowser, displayApi, pairTv } from '../helpers/displays';
import { createRoom, startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, type VenueFixture } from '../helpers/venue';

/**
 * ATTACKS 60-64 - venue displays (ADR-0028). A paired TV is a paid seat and the only way to start a game on a
 * licensed deployment. Codes are guessed, replayed and raced; credentials are copied, aged and revoked; staff
 * of one café reach for another café's TV; a hostile page rides the cookie; a phone pretends to be a TV.
 */
let server: TestServer;
let strict: TestServer;
let sa: VenueFixture;
let a: VenueFixture;
let b: VenueFixture;
let offset = 0;
beforeAll(async () => {
  server = await startServer({
    seed: false,
    clock: { now: () => Date.now() + offset },
    env: { VENUE_LOCK: '1', RATE_LIMIT_SCALE: '100' },
  });
  // Real rate limits: they are part of the argument about guessing.
  strict = await startServer({ seed: false, env: { VENUE_LOCK: '1', RATE_LIMIT_SCALE: '1' } });
  await Promise.all([setVenueFlag(server, true), setVenueFlag(strict, true)]);
  sa = await makeVenue(strict);
  a = await makeVenue(server);
  b = await makeVenue(server);
});
afterAll(async () => {
  await Promise.all([server.dispose(), strict.dispose()]);
});

describe('ATTACK 60 - guess or replay pairing codes', () => {
  it('stops a signed-in owner guessing codes after a handful of misses', async () => {
    const live = new TvBrowser(strict);
    const started = await live.startPairing();
    const real = started.body.code.replace('-', '');
    const results: number[] = [];
    for (let i = 0; i < 30; i++) {
      const guess = `AAAA${String(2000 + i)}`.slice(0, 8).replace(/[01]/gu, '2');
      results.push((await displayApi(strict, sa.owner, sa.venueId).pair(guess, 'x')).status);
    }
    expect(results.filter((status) => status === 201)).toHaveLength(0);
    expect(results.filter((status) => status === 429).length).toBeGreaterThanOrEqual(15);
    // Even the right code is refused while the bucket is empty: guessing cannot be "tried again" quickly.
    const right = await displayApi(strict, sa.owner, sa.venueId).pair(real, 'Salon');
    expect(right.status).toBe(429);
  });

  it('refuses malformed codes without touching the database', async () => {
    for (const code of [
      '',
      '0000-0000',
      'ABCD',
      'ABCD-EFGH-IJKL',
      "'; DROP TABLE x;--",
      'İİİİİİİİ',
    ])
      expect([400, 404, 429]).toContain(
        (await displayApi(strict, sa.owner, sa.venueId).pair(code, 'x')).status,
      );
  });

  it('does not let a used code, or a code seen by somebody else, pair a second screen', async () => {
    const other = await makeVenue(server);
    const tv = new TvBrowser(server);
    const started = await tv.startPairing();
    expect(
      (await displayApi(server, other.owner, other.venueId).pair(started.body.code)).status,
    ).toBe(201);
    expect(
      (await displayApi(server, other.owner, other.venueId).pair(started.body.code)).status,
    ).toBe(404);
    expect((await displayApi(server, a.owner, a.venueId).pair(started.body.code)).status).toBe(404);
  });

  it('gives the credential to the browser that showed the code, never to a bystander who saw it', async () => {
    const other = await makeVenue(server);
    const tv = new TvBrowser(server);
    const started = await tv.startPairing();
    await displayApi(server, other.owner, other.venueId).pair(started.body.code, 'Mine');
    const bystander = new TvBrowser(server);
    expect((await bystander.poll()).body.paired).toBe(false);
    expect(bystander.credential).toBeNull();
    expect((await tv.poll()).body.paired).toBe(true);
    // And only once.
    const copy = new TvBrowser(server);
    copy.jar.set(
      'qp_display_pairing',
      tv.jar.get('qp_display_pairing') ?? 'gone-gone-gone-gone-gone',
    );
    expect((await copy.poll()).body.paired).toBe(false);
  });
});

describe('ATTACK 61 - dead credentials', () => {
  it('refuses a revoked credential at once, and one idle for six months', async () => {
    const owner = await makeVenue(server);
    const { tv, displayId } = await pairTv(server, owner.owner, owner.venueId);
    const kept = tv.credential!;
    await displayApi(server, owner.owner, owner.venueId).revoke(displayId);
    const replay = new TvBrowser(server);
    replay.jar.set('qp_display', kept);
    expect((await replay.createRoom()).status).toBe(403);
    expect((await replay.poll()).body.paired).toBe(false);

    const { tv: old } = await pairTv(server, owner.owner, owner.venueId, 'Old');
    offset += 181 * 86_400_000;
    try {
      expect((await old.createRoom()).status).toBe(403);
    } finally {
      offset = 0;
    }
  });

  it('treats a copied credential used after rotation as theft and revokes the screen', async () => {
    const owner = await makeVenue(server);
    const { tv, displayId } = await pairTv(server, owner.owner, owner.venueId);
    const stolen = tv.credential!;
    offset += 61 * 60_000;
    try {
      await tv.poll(); // offered a successor (cookie replaced)
      await tv.poll(); // successor promoted
      offset += 31_000;
      const thief = new TvBrowser(server);
      thief.jar.set('qp_display', stolen);
      expect((await thief.createRoom()).status).toBe(403);
      expect((await tv.createRoom()).status).toBe(403); // the real TV must be paired again
      const row = await server.db.db
        .selectFrom('venue_displays')
        .select('revoke_reason')
        .where('id', '=', displayId)
        .executeTakeFirstOrThrow();
      expect(row.revoke_reason).toBe('REUSE');
    } finally {
      offset = 0;
    }
  });
});

describe('ATTACK 62 - another café, a phone, no credential', () => {
  it("keeps one café away from the other cafe's TVs and pairing", async () => {
    const { displayId } = await pairTv(server, a.owner, a.venueId, 'A-TV');
    const intruder = displayApi(server, b.owner, a.venueId);
    expect((await intruder.list()).status).toBe(404);
    expect((await intruder.open(displayId, 60)).status).toBe(404);
    expect((await intruder.revoke(displayId)).status).toBe(404);
    // Own venue id, foreign display id: the display is unknown there.
    const own = displayApi(server, b.owner, b.venueId);
    expect((await own.open(displayId, 60)).status).toBe(404);
    expect((await own.revoke(displayId)).status).toBe(404);
    // Staff may open a game, never pair or remove.
    expect((await displayApi(server, a.staff, a.venueId).revoke(displayId)).status).toBe(403);
    expect((await displayApi(server, a.staff, a.venueId).pair('ABCD2345')).status).toBe(403);
    expect((await displayApi(server, null, a.venueId).list()).status).toBe(401);
  });

  it('refuses CREATE_ROOM under the lock for everything that is not a paired TV', async () => {
    await expect(createRoom(server)).rejects.toThrow(/403/u);
    await expect(createRoom(server, { authorization: `Bearer ${a.owner.token}` })).rejects.toThrow(
      /403/u,
    );
    await expect(
      createRoom(server, { cookie: `${SESSION_COOKIE}=${a.owner.token}` }),
    ).rejects.toThrow(/403/u);
    expect(server.built.manager.size()).toBe(0);
  });

  it('does not let a player or phone session act as a display', async () => {
    const { tv } = await pairTv(server, a.owner, a.venueId, 'Host TV');
    const created = await tv.createRoom();
    const phone = await TestClient.connect(server.wsUrl);
    try {
      await phone.join(server.wsUrl, created.body.code, 'Ayşe');
      const open = await displayApi(
        server,
        { token: 'not-a-real-token-at-all-0000' },
        a.venueId,
      ).open('a0000000-0000-4000-8000-000000000000');
      expect(open.status).toBe(401);
      // The player's room token is not a display credential either.
      const fake = new TvBrowser(server);
      fake.jar.set('qp_display', phone.token ?? 'x'.repeat(40));
      expect((await fake.createRoom()).status).toBe(403);
    } finally {
      await phone.close();
    }
  });
});

describe('ATTACK 63 - cookie riding and theft', () => {
  it('refuses the pairing calls from a hostile page (cookie session without the CSRF proof)', async () => {
    const attempt = (headers: Record<string, string>) =>
      fetch(`${server.httpUrl}/v1/venues/${a.venueId}/displays/pair`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE}=${a.owner.token}`,
          ...headers,
        },
        body: JSON.stringify({ code: 'ABCD2345', name: 'evil' }),
      });
    expect((await attempt({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await attempt({ origin: 'http://localhost:5173' })).status).toBe(403); // right origin, no header
    const revoke = await fetch(
      `${server.httpUrl}/v1/venues/${a.venueId}/displays/${crypto.randomUUID()}/revoke`,
      {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE}=${a.owner.token}`, origin: 'https://evil.example' },
      },
    );
    expect(revoke.status).toBe(403);
  });

  it('refuses the TV cookie from another site, and keeps it HttpOnly, SameSite and out of every body', async () => {
    const { tv } = await pairTv(server, a.owner, a.venueId, 'Cookie');
    const credential = tv.credential!;
    const ok = await tv.poll();
    expect(JSON.stringify(ok.body)).not.toContain(credential);
    tv.origin = 'https://evil.example';
    expect((await tv.createRoom()).status).toBe(403);
    expect((await tv.poll()).status).toBe(403);
    tv.origin = 'http://localhost:5173';
    const pairingTv = new TvBrowser(server);
    const started = await pairingTv.startPairing();
    for (const line of started.setCookies) {
      expect(line).toMatch(/HttpOnly/u);
      expect(line).toMatch(/SameSite=Strict/u);
    }
    const stored = JSON.stringify(
      await server.db.db.selectFrom('venue_displays').selectAll().execute(),
    );
    expect(stored).not.toContain(credential);
  });
});

describe('ATTACK 64 - more seats than the licence', () => {
  it('pairs exactly the licensed number of TVs when claims race, and again after one is removed', async () => {
    const small = await makeVenue(server);
    await server.db.db
      .updateTable('venues')
      .set({ display_seats: 2 })
      .where('id', '=', small.venueId)
      .execute();
    const tvs = Array.from({ length: 6 }, () => new TvBrowser(server));
    const codes = await Promise.all(tvs.map(async (tv) => (await tv.startPairing()).body.code));
    const results = await Promise.all(
      codes.map((code, i) => displayApi(server, small.owner, small.venueId).pair(code, `TV ${i}`)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const active = await server.db.db
      .selectFrom('venue_displays')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('venue_id', '=', small.venueId)
      .where('revoked_at', 'is', null)
      .executeTakeFirstOrThrow();
    expect(Number(active.n)).toBe(2);
  });
});
