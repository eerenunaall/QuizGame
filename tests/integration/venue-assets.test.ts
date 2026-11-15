import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminApi, staff as adminStaff } from '../helpers/admin';
import { GIF, HTML_AS_PNG, SVG, exifSegment, jpeg, png, webp } from '../helpers/images';
import { call } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';
import { makeVenue, person, setVenueFlag, staffApi, type VenueFixture } from '../helpers/venue';

/**
 * Venue images over HTTP (ADR-0030 §4): the owner uploads, the server parses the whole file, the TV and
 * phones fetch by hash. Hostile files, other venues' images and every role are covered here; the
 * attack-style cases (CSRF, rate limits, headers) are in the red-team layer.
 */
let offset = 0;
const clock = { now: () => Date.now() + offset };
let server: TestServer;
let venue: VenueFixture;
let other: VenueFixture;
beforeAll(async () => {
  server = await startServer({ seed: false, clock });
  await setVenueFlag(server, true);
  venue = await makeVenue(server);
  other = await makeVenue(server);
});
afterAll(async () => {
  await server.dispose();
});

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

interface AssetBody {
  asset?: { hash: string; contentType: string; width: number; height: number; bytes: number };
  error?: { code: string; params?: { reason?: string } };
}
const assets = (who: { token: string } | null, venueId = venue.venueId) => {
  const base = `/v1/venues/${venueId}/assets`;
  const send = <T>(method: string, path: string, body?: unknown) =>
    call<T>(server, method, path, {
      cookies: false,
      ...(who ? { token: who.token } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  return {
    upload: (kind: 'LOGO' | 'TEAM', bytes: Uint8Array) =>
      send<AssetBody>('POST', base, { kind, data: b64(bytes) }),
    list: () => send<{ assets: { hash: string }[]; error?: { code: string } }>('GET', base),
    remove: (hash: string) => send<{ ok?: true }>('POST', `${base}/${hash}/remove`, {}),
  };
};
const owner = () => assets(venue.owner);
const get = (venueId: string, hash: string) =>
  fetch(`${server.httpUrl}/v1/venue-assets/${venueId}/${hash}`);

describe('upload and serve', () => {
  it('stores a PNG, answers with its real size and serves exactly those bytes by hash', async () => {
    const file = png({ width: 400, height: 150 });
    const result = await owner().upload('LOGO', file);
    expect(result.status).toBe(201);
    expect(result.body.asset).toEqual({
      hash: sha(file),
      contentType: 'image/png',
      width: 400,
      height: 150,
      bytes: file.length,
    });
    const served = await get(venue.venueId, sha(file));
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer()).equals(file)).toBe(true);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(served.headers.get('content-disposition')).toBe('inline; filename="logo"');
    expect(served.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('is idempotent by hash: the same bytes again cost no slot', async () => {
    const file = png({ width: 300, height: 100 });
    const before = (await owner().list()).body.assets.length;
    expect((await owner().upload('LOGO', file)).status).toBe(201);
    expect((await owner().upload('LOGO', file)).status).toBe(201);
    expect((await owner().list()).body.assets.length).toBe(before + 1);
  });

  it('accepts a JPEG and a WebP too, with the content type taken from the bytes', async () => {
    const j = await owner().upload('LOGO', jpeg({ width: 320, height: 120 }));
    expect(j.body.asset?.contentType).toBe('image/jpeg');
    const w = await owner().upload('TEAM', webp({ width: 256, height: 256 }));
    expect(w.body.asset?.contentType).toBe('image/webp');
    const served = await get(venue.venueId, w.body.asset!.hash);
    expect(served.headers.get('content-type')).toBe('image/webp');
  });
});

describe('hostile files', () => {
  const cases: [string, Uint8Array, string][] = [
    ['SVG with a script', SVG, 'FORMAT'],
    ['GIF', GIF, 'FORMAT'],
    ['HTML renamed .png', HTML_AS_PNG, 'FORMAT'],
    ['wrong magic bytes', Buffer.concat([Buffer.from('JFIF'), png().subarray(4)]), 'FORMAT'],
    ['truncated PNG', png({ truncateTo: 90 }), 'FORMAT'],
    [
      'PNG with trailing bytes',
      png({ trailing: Buffer.from('<script>alert(1)</script>') }),
      'FORMAT',
    ],
    ['JPEG with EXIF', jpeg({ segments: [exifSegment()] }), 'FORMAT'],
    ['animated WebP', webp({ flags: 0x02 }), 'FORMAT'],
    ['huge dimensions', jpeg({ width: 9000, height: 9000 }), 'DIMENSIONS'],
    ['not square for a team mark', png({ width: 400, height: 100 }), 'DIMENSIONS'],
    ['over 300 KB', Buffer.concat([png({ width: 64, height: 64 }), Buffer.alloc(307_200)]), 'SIZE'],
  ];

  it.each(cases)('refuses %s and stores nothing', async (_name, file, reason) => {
    const before = (await owner().list()).body.assets.length;
    const result = await owner().upload(reason === 'DIMENSIONS' ? 'TEAM' : 'LOGO', file);
    expect(result.status).toBe(400);
    expect(result.body.error).toEqual({ code: 'IMAGE_REJECTED', params: { reason } });
    expect((await owner().list()).body.assets.length).toBe(before);
    expect((await get(venue.venueId, sha(file))).status).toBe(404);
  });

  it('refuses a body that is not exactly kind + data (a file name, a content type, bad base64)', async () => {
    const send = (body: unknown) =>
      call(server, 'POST', `/v1/venues/${venue.venueId}/assets`, {
        cookies: false,
        token: venue.owner.token,
        body,
      });
    const data = b64(png());
    expect((await send({ kind: 'LOGO', data, fileName: 'logo.png' })).status).toBe(400);
    expect((await send({ kind: 'LOGO', data, contentType: 'image/png' })).status).toBe(400);
    expect((await send({ kind: 'LOGO', data: 'not base64 !!' })).status).toBe(400);
    expect((await send({ kind: 'BANNER', data })).status).toBe(400);
    expect((await send({ kind: 'LOGO' })).status).toBe(400);
  });
});

describe('oversized requests', () => {
  it('cuts a body far over the limit off before it is read into a file', async () => {
    const huge = Buffer.alloc(2_000_000, 1);
    const result = await owner().upload('LOGO', huge);
    expect(result.status).toBe(413);
    expect((await get(venue.venueId, sha(huge))).status).toBe(404);
  });
});

describe('who may do what', () => {
  it('lets only the owner of this venue manage images', async () => {
    const file = png({ width: 200, height: 80 });
    expect((await assets(venue.staff).upload('LOGO', file)).status).toBe(403);
    expect((await assets(venue.staff).list()).status).toBe(403);
    expect((await assets(other.owner).upload('LOGO', file)).status).toBe(404); // not a member here
    expect((await assets(other.owner).list()).status).toBe(404);
    expect((await assets(null).upload('LOGO', file)).status).toBe(401);
    const stranger = await person(server, 'stranger');
    expect((await assets(stranger).upload('LOGO', file)).status).toBe(404);
    const admin = await adminStaff(server, ['ADMIN']);
    expect((await assets(admin).upload('LOGO', file)).status).toBe(403);
  });

  it('keeps the limit of 12 images per venue and still answers a repeat of one it has', async () => {
    const fresh = await makeVenue(server);
    const api = assets(fresh.owner, fresh.venueId);
    for (let size = 64; size < 76; size++)
      expect((await api.upload('TEAM', png({ width: size, height: size }))).status).toBe(201);
    const thirteenth = await api.upload('TEAM', png({ width: 80, height: 80 }));
    expect(thirteenth.status).toBe(409);
    expect(thirteenth.body.error?.code).toBe('LIMIT_REACHED');
    expect((await api.upload('TEAM', png({ width: 64, height: 64 }))).status).toBe(201);
  });
});

describe('cross-venue isolation', () => {
  it('serves nothing for a wrong pair: another venue, a bad hash and an unknown hash look the same', async () => {
    const file = png({ width: 222, height: 111 });
    const uploaded = await owner().upload('LOGO', file);
    const hash = uploaded.body.asset!.hash;
    const bodies = new Set<string>();
    for (const url of [
      `${other.venueId}/${hash}`, // right hash, wrong venue
      `${venue.venueId}/${'0'.repeat(64)}`, // right venue, unknown hash
      `${venue.venueId}/${hash.toUpperCase()}`, // not the canonical spelling
      `${venue.venueId}/${hash.slice(0, 63)}`, // short
      `not-a-uuid/${hash}`,
      `${venue.venueId}/..%2F${hash}`,
    ]) {
      const response = await fetch(`${server.httpUrl}/v1/venue-assets/${url}`);
      expect(response.status, url).toBe(404);
      bodies.add(await response.text());
    }
    expect(bodies.size).toBe(1);
  });

  it('refuses a look that points at another venue’s image, an unknown hash or the wrong slot', async () => {
    const mine = await owner().upload('LOGO', png({ width: 500, height: 160 }));
    const theirs = await assets(other.owner, other.venueId).upload(
      'LOGO',
      png({ width: 480, height: 150 }),
    );
    const save = (look: Record<string, unknown>) =>
      staffApi(server, venue.owner, venue.venueId).saveSettings({ look });
    expect((await save({ logo: theirs.body.asset!.hash })).status).toBe(400);
    expect((await save({ logo: 'f'.repeat(64) })).status).toBe(400);
    expect((await save({ teamLogos: [mine.body.asset!.hash] })).status).toBe(400); // wide: not a team mark
    expect(
      (await save({ logo: mine.body.asset!.hash, accent: 'mint', theme: 'party' })).status,
    ).toBe(200);
    expect((await save({ accent: '#ff0000' })).status).toBe(400); // the palette is closed
    expect((await save({ theme: 'neon' })).status).toBe(400);
  });
});

describe('removing and cleaning up', () => {
  it('removes an image for good and drops it from the venue’s look', async () => {
    const file = png({ width: 600, height: 200 });
    const hash = (await owner().upload('LOGO', file)).body.asset!.hash;
    const api = staffApi(server, venue.owner, venue.venueId);
    expect((await api.saveSettings({ look: { logo: hash } })).status).toBe(200);
    expect((await owner().remove(hash)).status).toBe(200);
    expect((await get(venue.venueId, hash)).status).toBe(404);
    const settings = (await api.settings()).body as { settings: { look: { logo: string | null } } };
    expect(settings.settings.look.logo).toBeNull();
    expect((await owner().remove(hash)).status).toBe(404);
  });

  it('collects images nothing refers to once the undo grace is over, never before', async () => {
    const fresh = await makeVenue(server);
    const api = assets(fresh.owner, fresh.venueId);
    const settings = staffApi(server, fresh.owner, fresh.venueId);
    const old = (await api.upload('LOGO', png({ width: 300, height: 90 }))).body.asset!.hash;
    expect((await settings.saveSettings({ look: { logo: old } })).status).toBe(200);
    const next = (await api.upload('LOGO', png({ width: 310, height: 90 }))).body.asset!.hash;
    expect((await settings.saveSettings({ look: { logo: next } })).status).toBe(200);
    // the replaced logo is still there for "Geri al" ...
    expect((await get(fresh.venueId, old)).status).toBe(200);
    // ... and gone after the grace, at the next look save
    offset += 10 * 60_000;
    try {
      expect((await settings.saveSettings({ look: { accent: 'sky' } })).status).toBe(200);
      expect((await get(fresh.venueId, old)).status).toBe(404);
      expect((await get(fresh.venueId, next)).status).toBe(200);
    } finally {
      offset -= 10 * 60_000;
    }
  });

  it('deletes a venue’s images with the venue', async () => {
    const doomed = await makeVenue(server);
    const hash = (
      await assets(doomed.owner, doomed.venueId).upload('LOGO', png({ width: 350, height: 100 }))
    ).body.asset!.hash;
    await server.db.db.deleteFrom('venues').where('id', '=', doomed.venueId).execute();
    const rows = await server.db.db
      .selectFrom('venue_assets')
      .select('id')
      .where('sha256', '=', hash)
      .where('venue_id', '=', doomed.venueId)
      .execute();
    expect(rows).toHaveLength(0);
  });
});

describe('admin console', () => {
  it('lists a venue’s images without bytes and removes one, audited', async () => {
    const hash = (await owner().upload('LOGO', png({ width: 420, height: 130 }))).body.asset!.hash;
    const admin = adminApi(server, await adminStaff(server, ['ADMIN']));
    const listed = await admin.get<{ assets: { hash: string; bytes: number }[] }>(
      `/v1/admin/venues/${venue.venueId}/assets`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.assets.some((asset) => asset.hash === hash)).toBe(true);
    expect(JSON.stringify(listed.body)).not.toContain('"data"');
    const removed = await admin.post(`/v1/admin/venues/${venue.venueId}/assets/${hash}/remove`, {});
    expect(removed.status).toBe(200);
    expect((await get(venue.venueId, hash)).status).toBe(404);
    const audit = await server.db.db
      .selectFrom('admin_audit')
      .selectAll()
      .where('action', '=', 'venue.asset.remove')
      .execute();
    expect(audit.length).toBeGreaterThan(0);
  });

  it('lets support read the list but not remove', async () => {
    const support = adminApi(server, await adminStaff(server, ['SUPPORT']));
    expect((await support.get(`/v1/admin/venues/${venue.venueId}/assets`)).status).toBe(200);
    expect(
      (await support.post(`/v1/admin/venues/${venue.venueId}/assets/${'a'.repeat(64)}/remove`, {}))
        .status,
    ).toBe(403);
  });
});
