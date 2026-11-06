import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF_HEADER, SESSION_COOKIE } from '../../apps/realtime/src/auth/guard';
import { staff as adminStaff } from '../helpers/admin';
import { GIF, HTML_AS_PNG, SVG, exifSegment, jpeg, png, pngChunk, webp } from '../helpers/images';
import { closeParty, createParty } from '../helpers/party';
import { call, startShop } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';
import {
  makeVenue,
  person,
  seedVenueQuestions,
  setVenueFlag,
  staffApi,
  type VenueFixture,
} from '../helpers/venue';

/**
 * ATTACKS 47-59 — the venue admin panel (ADR-0030). Images are the first thing a venue owner can put on
 * every guest's screen, the entrance line is free text on the TV, and the answers view hands out the
 * bank's correct options: each of these is attacked from the hostile side here.
 */
let server: TestServer;
let strict: TestServer;
let a: VenueFixture;
let b: VenueFixture;
let aStrict: VenueFixture;
beforeAll(async () => {
  server = await startServer({ seed: true });
  strict = await startServer({ seed: true, env: { RATE_LIMIT_SCALE: '1' } });
  await setVenueFlag(server, true);
  await setVenueFlag(strict, true);
  a = await makeVenue(server, {
    reward: { enabled: true, text: 'Gizli ödül metni', minPlayers: 3 },
  });
  b = await makeVenue(server);
  aStrict = await makeVenue(strict);
  await seedVenueQuestions(server, a.venueId, 3, { prefix: 'Gizli' });
  await seedVenueQuestions(server, b.venueId, 3, { prefix: 'Rakip' });
});
afterAll(async () => {
  await Promise.all([server.dispose(), strict.dispose()]);
});

const upload = (
  s: TestServer,
  who: { token: string } | null,
  venueId: string,
  file: Uint8Array,
  kind: 'LOGO' | 'TEAM' = 'LOGO',
  extra: Record<string, unknown> = {},
) =>
  call<{ asset?: { hash: string }; error?: { code: string; params?: { reason?: string } } }>(
    s,
    'POST',
    `/v1/venues/${venueId}/assets`,
    {
      cookies: false,
      ...(who ? { token: who.token } : {}),
      body: { kind, data: Buffer.from(file).toString('base64'), ...extra },
    },
  );
const fetchAsset = (s: TestServer, venueId: string, hash: string) =>
  fetch(`${s.httpUrl}/v1/venue-assets/${venueId}/${hash}`);

describe('ATTACK 47 — hostile image files', () => {
  it('stores none of: script in SVG, GIF, HTML renamed, polyglots, metadata, animation, bombs', async () => {
    const polyglot = Buffer.concat([png(), Buffer.from('<script>alert(1)</script>')]);
    const htmlInChunk = png({
      before: [pngChunk('tEXt', Buffer.from('Comment\0<script>1</script>'))],
    });
    const hostile: [string, Uint8Array][] = [
      ['svg', SVG],
      ['gif', GIF],
      ['html', HTML_AS_PNG],
      ['png+script', polyglot],
      ['png text chunk', htmlInChunk],
      ['jpeg exif', jpeg({ segments: [exifSegment()] })],
      ['animated webp', webp({ flags: 0x02 })],
      ['huge', jpeg({ width: 10000, height: 10000 })],
      ['truncated', png({ truncateTo: 60 })],
      ['empty', Buffer.alloc(0)],
    ];
    for (const [name, file] of hostile) {
      const result = await upload(server, a.owner, a.venueId, file);
      expect({ name, status: result.status }).toEqual({ name, status: result.status });
      expect(result.status, name).toBeGreaterThanOrEqual(400);
      expect(result.status, name).toBeLessThan(500);
    }
    const rows = await server.db.db
      .selectFrom('venue_assets')
      .select('id')
      .where('venue_id', '=', a.venueId)
      .execute();
    expect(rows).toHaveLength(0);
    const events = await server.db.db
      .selectFrom('security_events')
      .select('id')
      .where('kind', '=', 'VENUE_ASSET_REJECTED')
      .execute();
    expect(events.length).toBeGreaterThan(0);
  });

  it('serves even markup hidden in pixel data as an inert image: forced type, nosniff, empty CSP', async () => {
    // valid PNG whose last IDAT-adjacent bytes are not markup, but whose metadata-free body is arbitrary
    const file = png({ width: 300, height: 100 });
    const stored = await upload(server, a.owner, a.venueId, file);
    expect(stored.status).toBe(201);
    const response = await fetchAsset(server, a.venueId, stored.body.asset!.hash);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(response.headers.get('content-disposition')).toBe('inline; filename="logo"');
    expect(response.headers.get('set-cookie')).toBeNull();
    // and the type cannot be talked into anything else
    const asked = await fetch(
      `${server.httpUrl}/v1/venue-assets/${a.venueId}/${stored.body.asset!.hash}`,
      {
        headers: { accept: 'text/html', 'x-forwarded-proto': 'https' },
      },
    );
    expect(asked.headers.get('content-type')).toBe('image/png');
  });
});

describe('ATTACK 48 — a hostile page in the owner’s browser', () => {
  it('cannot upload, remove or save look settings with the owner’s cookie alone', async () => {
    const cookie = `${SESSION_COOKIE}=${a.owner.token}`;
    const stored = await upload(server, a.owner, a.venueId, png({ width: 250, height: 90 }));
    const hash = stored.body.asset!.hash;
    const attempts: [string, string, unknown][] = [
      [
        'POST',
        `/v1/venues/${a.venueId}/assets`,
        { kind: 'LOGO', data: Buffer.from(png()).toString('base64') },
      ],
      ['POST', `/v1/venues/${a.venueId}/assets/${hash}/remove`, {}],
      ['POST', `/v1/venues/${a.venueId}/settings`, { entrance: { enabled: true, text: 'Hile' } }],
    ];
    for (const headers of [
      { cookie } as Record<string, string>,
      { cookie, origin: 'https://evil.example', [CSRF_HEADER]: '1' },
      { cookie, origin: 'http://localhost:5173' },
    ])
      for (const [method, path, body] of attempts)
        expect(
          (await call(server, method, path, { cookies: false, headers, body })).status,
          path,
        ).toBe(403);
    expect((await fetchAsset(server, a.venueId, hash)).status).toBe(200);
  });
});

describe('ATTACK 49 — flooding uploads and the public image address', () => {
  it('limits uploads per account, and a flood of misses per address', async () => {
    const statuses: number[] = [];
    for (let size = 64; size < 80; size++)
      statuses.push(
        (
          await upload(
            strict,
            aStrict.owner,
            aStrict.venueId,
            png({ width: size, height: size }),
            'TEAM',
          )
        ).status,
      );
    expect(statuses.slice(0, 8).every((status) => status === 201)).toBe(true);
    expect(statuses.slice(8).every((status) => status === 429)).toBe(true);

    let blockedAt = 0;
    for (let i = 1; i <= 400; i++) {
      const miss = await fetchAsset(strict, aStrict.venueId, i.toString(16).padStart(64, '0'));
      if (miss.status === 429) {
        blockedAt = i;
        break;
      }
      expect(miss.status).toBe(404);
    }
    // a miss costs more than a hit, so the cap arrives well before the bucket's raw size
    expect(blockedAt).toBeGreaterThan(20);
    expect(blockedAt).toBeLessThan(120);
  });
});

describe('ATTACK 50 — venue A reaches for venue B’s images', () => {
  it('cannot manage, read, reference or show them, by any path', async () => {
    const theirs = await upload(server, b.owner, b.venueId, png({ width: 280, height: 90 }));
    const hash = theirs.body.asset!.hash;
    // manage B through A's own role, or through B's path
    expect((await upload(server, a.owner, b.venueId, png({ width: 281, height: 90 }))).status).toBe(
      404,
    );
    expect(
      (
        await call(server, 'GET', `/v1/venues/${b.venueId}/assets`, {
          cookies: false,
          token: a.owner.token,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(server, 'POST', `/v1/venues/${b.venueId}/assets/${hash}/remove`, {
          cookies: false,
          token: a.owner.token,
          body: {},
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(server, 'POST', `/v1/venues/${a.venueId}/assets/${hash}/remove`, {
          cookies: false,
          token: a.owner.token,
          body: {},
        })
      ).status,
    ).toBe(404);
    // read B's bytes under A's id
    expect((await fetchAsset(server, a.venueId, hash)).status).toBe(404);
    // point A's look at B's image
    expect(
      (await staffApi(server, a.owner, a.venueId).saveSettings({ look: { logo: hash } })).status,
    ).toBe(400);
    // a table of A never carries B's image
    const party = await createParty(server, 2);
    const opened = await staffApi(server, a.staff, a.venueId).open({
      minutes: 60,
      roomCode: party.created.code,
    });
    const meter = await party.display.nextOfType('VENUE_METER_CHANGED');
    expect(JSON.stringify(meter.payload)).not.toContain(hash);
    expect(JSON.stringify(meter.payload)).not.toContain(b.venueId);
    await staffApi(server, a.staff, a.venueId).end(opened.body.id);
    await closeParty(party);
  });
});

describe('ATTACK 51 — the public image address as an enumeration oracle', () => {
  it('answers every wrong pair identically and offers no listing, redirect or traversal', async () => {
    const stored = await upload(server, a.owner, a.venueId, png({ width: 260, height: 90 }));
    const hash = stored.body.asset!.hash;
    const seen = new Set<string>();
    for (const path of [
      `${b.venueId}/${hash}`,
      `${a.venueId}/${'e'.repeat(64)}`,
      `${a.venueId}/`,
      `${a.venueId}`,
      `${a.venueId}/${hash}/extra`,
      `${a.venueId}/%2e%2e%2f${hash}`,
      `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/${hash}`,
    ]) {
      const response = await fetch(`${server.httpUrl}/v1/venue-assets/${path}`, {
        redirect: 'manual',
      });
      expect([404], path).toContain(response.status);
      seen.add(`${response.status}|${await response.text()}`);
    }
    expect(seen.size).toBe(1);
  });
});

describe('ATTACK 52 — the answers view for everyone who is not the owner', () => {
  it('refuses no credentials, staff, strangers, player apps, a console session and a TV', async () => {
    const stranger = await person(server, 'stranger');
    const app = await person(server, 'app', 'MOBILE');
    const console = await adminStaff(server, ['ADMIN']);
    const paths = [
      `/v1/venues/${a.venueId}/bank/questions`,
      `/v1/venues/${a.venueId}/bank/questions?scope=VENUE`,
      `/v1/venues/${a.venueId}/bank/categories`,
    ];
    for (const path of paths) {
      const as = async (token?: string) =>
        (await call(server, 'GET', path, { cookies: false, ...(token ? { token } : {}) })).status;
      expect({ path, status: await as() }).toEqual({ path, status: 401 });
      expect({ path, status: await as(a.staff.token) }).toEqual({ path, status: 403 });
      expect({ path, status: await as(stranger.token) }).toEqual({ path, status: 404 });
      expect({ path, status: await as(app.token) }).toEqual({ path, status: 404 });
      expect({ path, status: await as(b.owner.token) }).toEqual({ path, status: 404 });
      expect({ path, status: await as(console.token) }).toEqual({ path, status: 403 });
      // a TV or a player holds a room session, not an account session
      const tv = await call(server, 'GET', path, {
        cookies: false,
        headers: { cookie: 'qp_display=not-a-real-credential; __Host-qp_display=x' },
      });
      expect({ path, status: tv.status }).toEqual({ path, status: 401 });
    }
  });

  it('never returns another venue’s private question, however it is asked', async () => {
    for (const query of [
      '?scope=VENUE&q=Rakip',
      '?scope=GLOBAL&q=Rakip',
      '?q=Rakip',
      '?scope=VENUE',
    ]) {
      const result = await call<{ items: { text: string }[] }>(
        server,
        'GET',
        `/v1/venues/${a.venueId}/bank/questions${query}`,
        { cookies: false, token: a.owner.token },
      );
      expect(result.status).toBe(200);
      expect(JSON.stringify(result.body), query).not.toContain('Rakip');
    }
    // the venue scope is the caller's venue, whatever a client puts in the query
    const forged = await call(
      server,
      'GET',
      `/v1/venues/${a.venueId}/bank/questions?scope=VENUE&venueId=${b.venueId}`,
      { cookies: false, token: a.owner.token },
    );
    expect(forged.status).toBe(400);
  });
});

describe('ATTACK 53 — scraping the bank', () => {
  it('records every read without the search words, and stops a scraper', async () => {
    const before = await strict.db.db
      .selectFrom('security_events')
      .select('id')
      .where('kind', '=', 'VENUE_BANK_READ')
      .execute();
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++)
      statuses.push(
        (
          await call(
            strict,
            'GET',
            `/v1/venues/${aStrict.venueId}/bank/questions?q=gizlikelime&offset=${i}`,
            {
              cookies: false,
              token: aStrict.owner.token,
            },
          )
        ).status,
      );
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(60).some((status) => status === 429)).toBe(true);
    const after = await strict.db.db
      .selectFrom('security_events')
      .selectAll()
      .where('kind', '=', 'VENUE_BANK_READ')
      .execute();
    expect(after.length - before.length).toBe(statuses.filter((status) => status === 200).length);
    expect(JSON.stringify(after.map((row) => row.detail))).not.toContain('gizlikelime');
  });
});

describe('ATTACK 54 — the entrance line is text for a TV, not a price engine or a billboard', () => {
  it('refuses links, markup-looking links, hidden characters, profanity, long text and money fields', async () => {
    const save = (entrance: Record<string, unknown>) =>
      staffApi(server, a.owner, a.venueId).saveSettings({ entrance });
    for (const text of [
      'bit.ly/kampanya',
      'https://evil.example/odeme',
      'www.evil.example',
      `150 TL${'​'}`,
      'x'.repeat(41),
      '',
    ])
      expect((await save({ enabled: true, text })).status, JSON.stringify(text)).toBe(400);
    expect((await save({ enabled: true, text: '150 TL', note: 'y'.repeat(81) })).status).toBe(400);
    for (const field of ['price', 'amount', 'currency', 'link', 'url'])
      expect((await save({ enabled: true, text: '150 TL', [field]: 150 })).status, field).toBe(400);
    // markup is kept as the text it is; the TV and phones render it escaped (web tests)
    const saved = await save({ enabled: true, text: '<b>150</b> TL' });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).toContain('<b>150</b> TL');
  });
});

describe('ATTACK 55 — what a table’s screens may learn about the venue', () => {
  it('carries only the allow-listed entrance, look and branding keys, nothing from the settings', async () => {
    await staffApi(server, a.owner, a.venueId).saveSettings({
      entrance: { enabled: true, text: '100 TL', note: 'Hafta sonu' },
      look: { theme: 'venue-gold', accent: 'sky' },
    });
    const party = await createParty(server, 2);
    const opened = await staffApi(server, a.staff, a.venueId).open({
      minutes: 60,
      roomCode: party.created.code,
    });
    const meter = await party.display.nextOfType('VENUE_METER_CHANGED');
    expect(Object.keys(meter.payload.venue).sort()).toEqual(
      ['endsAt', 'entrance', 'look', 'remainingMs', 'state'].sort(),
    );
    expect(Object.keys(meter.payload.venue.entrance!).sort()).toEqual(['note', 'text']);
    expect(Object.keys(meter.payload.venue.look!).sort()).toEqual(['accent', 'name', 'theme']);
    party.leader.send('REQUEST_STATE', {});
    const state = await party.leader.nextOfType('ROOM_STATE');
    for (const frame of [JSON.stringify(meter), JSON.stringify(state)])
      for (const secret of [
        'Gizli ödül metni',
        'maxPerDay',
        'rematchCooldownMinutes',
        'teamNames',
        'timezone',
      ])
        expect(frame).not.toContain(secret);
    await staffApi(server, a.staff, a.venueId).end(opened.body.id);
    await closeParty(party);
  });
});

describe('ATTACK 56 — the purchase surface follows the server’s flag', () => {
  it('reports paymentsEnabled from the server alone', async () => {
    const off = await fetch(`${server.httpUrl}/v1/config`);
    expect(((await off.json()) as { paymentsEnabled?: boolean }).paymentsEnabled).toBe(false);
    const shop = await startShop();
    try {
      const body = (await (await fetch(`${shop.server.httpUrl}/v1/config`)).json()) as {
        paymentsEnabled?: boolean;
      };
      expect(body.paymentsEnabled).toBe(true);
    } finally {
      await shop.dispose();
    }
  });
});

describe('ATTACK 57 — the admin console and the owner’s tools', () => {
  it('keeps a console session out of the owner routes and support out of removals', async () => {
    const admin = await adminStaff(server, ['ADMIN']);
    const support = await adminStaff(server, ['SUPPORT']);
    const stored = await upload(server, a.owner, a.venueId, png({ width: 270, height: 90 }));
    const hash = stored.body.asset!.hash;
    expect((await upload(server, admin, a.venueId, png())).status).toBe(403);
    expect(
      (
        await call(server, 'GET', `/v1/venues/${a.venueId}/assets`, {
          cookies: false,
          token: admin.token,
        })
      ).status,
    ).toBe(403);
    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
    const removeAs = async (token: string) =>
      (
        await fetch(`${server.httpUrl}/v1/admin/venues/${a.venueId}/assets/${hash}/remove`, {
          method: 'POST',
          headers: { ...bearer(token), 'content-type': 'application/json' },
          body: '{}',
        })
      ).status;
    expect(await removeAs(support.token)).toBe(403);
    expect((await fetchAsset(server, a.venueId, hash)).status).toBe(200);
    expect(await removeAs(a.owner.token)).toBe(403); // an ordinary session is not a console session
    expect(await removeAs(admin.token)).toBe(200);
    expect((await fetchAsset(server, a.venueId, hash)).status).toBe(404);
  });
});

describe('ATTACK 58 — the look settings are a closed set', () => {
  it('refuses a typed colour, an unknown theme, odd hashes and too many team marks', async () => {
    const save = (look: Record<string, unknown>) =>
      staffApi(server, a.owner, a.venueId).saveSettings({ look });
    for (const look of [
      { accent: '#ff0000' },
      { accent: 'red; background:url(//evil)' },
      { theme: 'neon' },
      { theme: '"><script>' },
      { logo: 'A'.repeat(64) },
      { logo: 'a'.repeat(63) },
      { logo: '../../etc/passwd' },
      { teamLogos: Array.from({ length: 9 }, () => null) },
      { teamLogos: ['a'.repeat(64)] },
      { font: 'Comic Sans' },
    ])
      expect((await save(look)).status, JSON.stringify(look)).toBe(400);
  });
});

describe('ATTACK 59 — racing past the limit of 12 images', () => {
  it('never stores a thirteenth image, however many uploads arrive at once', async () => {
    const fresh = await makeVenue(server);
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        upload(
          server,
          fresh.owner,
          fresh.venueId,
          png({ width: 64 + index, height: 64 + index }),
          'TEAM',
        ),
      ),
    );
    const stored = results.filter((result) => result.status === 201).length;
    expect(stored).toBe(12);
    expect(results.filter((result) => result.status === 409)).toHaveLength(12);
    const rows = await server.db.db
      .selectFrom('venue_assets')
      .select('id')
      .where('venue_id', '=', fresh.venueId)
      .execute();
    expect(rows).toHaveLength(12);
  });
});
