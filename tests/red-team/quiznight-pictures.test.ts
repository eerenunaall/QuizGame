/* eslint-disable @typescript-eslint/no-explicit-any -- responses are inspected loosely */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { png } from '../helpers/images';
import { call } from '../helpers/payments';
import { nightApi, nightConfig, tvFrame } from '../helpers/quiznight';
import { startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, type VenueFixture } from '../helpers/venue';

/**
 * ATTACK 94 - picture rounds of the quiz night (docs/TODO.md A2). A question's picture is an image of the
 * venue's own store, shown from the web app's own origin (the CSP stays `img-src 'self'`). An outside
 * address, another café's image, a script URL or a deleted image is refused on save; the picture shelf has
 * its own limit and never costs the logo slots; the TV frame carries only the hash path.
 */
let server: TestServer;
let a: VenueFixture;
let b: VenueFixture;
beforeAll(async () => {
  server = await startServer({ seed: false, env: { RATE_LIMIT_SCALE: '100' } });
  await setVenueFlag(server, true);
  a = await makeVenue(server);
  b = await makeVenue(server);
});
afterAll(async () => {
  await server.dispose();
});

type Json = Record<string, any>;
const upload = (venue: VenueFixture, kind: string, file: Buffer, who = venue.owner) =>
  call<Json>(server, 'POST', `/v1/venues/${venue.venueId}/assets`, {
    cookies: false,
    token: who.token,
    body: { kind, data: file.toString('base64') },
  });
const pictureUrl = (venue: VenueFixture, file: Buffer) =>
  `/v1/venue-assets/${venue.venueId}/${createHash('sha256').update(file).digest('hex')}`;
const withPicture = (url: string, where: 'question' | 'tie' | 'final' = 'question') => {
  const config = nightConfig({}, true);
  if (where === 'question') config.rounds[0]!.questions[0]!.imageUrl = url;
  if (where === 'tie') {
    config.tieBreak = {
      id: 'tie-break',
      text: 'Kaç gün?',
      answer: { type: 'NUMBER', value: 3 },
      points: 0,
      jokerAllowed: false,
      imageUrl: url,
    };
  }
  if (where === 'final') config.finalWager!.question.imageUrl = url;
  return config;
};
const PICTURE = png({ width: 800, height: 600 });

describe('ATTACK 94 - question pictures', () => {
  it('stores a picture in its own shelf, serves it from the app origin and keeps it out of the brand list', async () => {
    const r = await upload(a, 'PICTURE', PICTURE);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.asset).toMatchObject({ contentType: 'image/png', width: 800, height: 600 });
    const brand = await call<Json>(server, 'GET', `/v1/venues/${a.venueId}/assets`, {
      cookies: false,
      token: a.owner.token,
    });
    expect(brand.body.assets).toEqual([]);
    const served = await fetch(`${server.httpUrl}${pictureUrl(a, PICTURE)}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await served.arrayBuffer()).equals(PICTURE)).toBe(true);
    // The same bytes again cost nothing.
    expect((await upload(a, 'PICTURE', PICTURE)).status).toBe(201);
  });

  it('refuses pictures that are too small, too large or not images', async () => {
    for (const file of [png({ width: 150, height: 150 }), png({ width: 1700, height: 300 })]) {
      const r = await upload(a, 'PICTURE', file);
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ error: { params: { reason: 'DIMENSIONS' } } });
    }
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect((await upload(a, 'PICTURE', html)).status).toBe(400);
    // Staff and other cafés cannot upload for this venue.
    expect((await upload(a, 'PICTURE', PICTURE, a.staff)).status).toBe(403);
    expect(
      (
        await call(server, 'POST', `/v1/venues/${a.venueId}/assets`, {
          cookies: false,
          token: b.owner.token,
          body: { kind: 'PICTURE', data: PICTURE.toString('base64') },
        })
      ).status,
    ).toBe(404);
  });

  it('a night uses the picture and the TV frame carries only the hash path', async () => {
    const api = nightApi(server, a.owner, a.venueId);
    const url = pictureUrl(a, PICTURE);
    const created = await api.create(withPicture(url));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = (created.body as any).night.id as string;
    const link = (await api.link(id)).body;
    await api.command(id, { type: 'START' });
    for (let i = 0; i < 3; i++) await api.command(id, { type: 'NEXT' });
    const frame = (await tvFrame(server, link.url)).body.view;
    expect(frame.step).toBe('QUESTION');
    expect(frame.question.imageUrl).toBe(url);
    expect(JSON.stringify(frame)).not.toMatch(/https?:\/\//u);
  });

  it('refuses outside addresses, script URLs, other cafés and missing images, in every place a picture can be', async () => {
    const api = nightApi(server, a.owner, a.venueId);
    const otherFile = png({ width: 640, height: 480 });
    expect((await upload(b, 'PICTURE', otherFile)).status).toBe(201);
    const missing = `/v1/venue-assets/${a.venueId}/${'0'.repeat(64)}`;
    const bad = [
      'https://evil.example/pixel.png',
      '//evil.example/x.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      `${pictureUrl(a, PICTURE)}?x=1`,
      `${pictureUrl(a, PICTURE)}/../x`,
      pictureUrl(b, otherFile),
      `/v1/venue-assets/${a.venueId}/${createHash('sha256').update(otherFile).digest('hex')}`,
      missing,
    ];
    for (const url of bad)
      for (const where of ['question', 'tie', 'final'] as const) {
        const r = await api.create(withPicture(url, where));
        expect(r.status, `${where} ${url}`).toBe(409);
        expect(r.body).toMatchObject({
          error: { code: 'QUIZNIGHT_REFUSED', params: { reason: 'BAD_IMAGE' } },
        });
      }
    // Saving over an existing night is checked the same way.
    const created = await api.create(nightConfig());
    const id = (created.body as any).night.id as string;
    expect((await api.saveConfig(id, withPicture('https://evil.example/x.png'))).status).toBe(409);
    expect((await api.saveConfig(id, withPicture(pictureUrl(a, PICTURE)))).status).toBe(200);
  });

  it('the brand cleanup never deletes a question picture, and pictures never use up the logo slots', async () => {
    const file = png({ width: 700, height: 500 });
    await upload(a, 'PICTURE', file);
    const old = new Date(Date.now() - 3 * 86_400_000);
    await server.db.db.updateTable('venue_assets').set({ created_at: old }).execute();
    const removed = await server.built.venues.assets.collect(a.venueId, new Set());
    expect(removed).toBe(0);
    expect(
      await server.db.db
        .selectFrom('venue_assets')
        .select('sha256')
        .where('venue_id', '=', a.venueId)
        .where('kind', '=', 'QUESTION')
        .execute(),
    ).not.toHaveLength(0);
    // Fill the picture shelf with unused old pictures: a logo still uploads.
    const fake = (n: number) => ({
      venue_id: a.venueId,
      sha256: createHash('sha256').update(`fake-${n}`).digest('hex'),
      content_type: 'image/png',
      kind: 'QUESTION',
      width: 800,
      height: 600,
      bytes: Buffer.from([1]),
      created_at: old,
    });
    await server.db.db
      .insertInto('venue_assets')
      .values(Array.from({ length: 60 }, (_, n) => fake(n)))
      .execute();
    expect((await upload(a, 'LOGO', png({ width: 400, height: 150 }))).status).toBe(201);
  });

  it('a full picture shelf frees the pictures no night uses, and refuses when every one is in use', async () => {
    const venue = await makeVenue(server);
    const api = nightApi(server, venue.owner, venue.venueId);
    const old = new Date(Date.now() - 3 * 86_400_000);
    const rows = Array.from({ length: 60 }, (_, n) => ({
      venue_id: venue.venueId,
      sha256: createHash('sha256').update(`shelf-${n}`).digest('hex'),
      content_type: 'image/png',
      kind: 'QUESTION',
      width: 800,
      height: 600,
      bytes: Buffer.from([1]),
      created_at: old,
    }));
    await server.db.db.insertInto('venue_assets').values(rows).execute();
    // One of them is used by a night: it must survive the cleanup.
    const used = `/v1/venue-assets/${venue.venueId}/${rows[0]!.sha256}`;
    expect((await api.create(withPicture(used))).status).toBe(201);
    const fresh = png({ width: 900, height: 700 });
    expect((await upload(venue, 'PICTURE', fresh)).status).toBe(201);
    const left = await server.db.db
      .selectFrom('venue_assets')
      .select('sha256')
      .where('venue_id', '=', venue.venueId)
      .where('kind', '=', 'QUESTION')
      .execute();
    expect(left.map((r) => r.sha256)).toContain(rows[0]!.sha256);
    expect(left).toHaveLength(2);
    // A shelf of fresh pictures (inside the grace) is not freed: the owner is told it is full.
    await server.db.db
      .updateTable('venue_assets')
      .set({ created_at: new Date() })
      .where('venue_id', '=', venue.venueId)
      .execute();
    await server.db.db
      .insertInto('venue_assets')
      .values(
        rows
          .slice(1, 59)
          .map((row, n) => ({ ...row, sha256: `${n}`.padStart(64, 'f'), created_at: new Date() })),
      )
      .execute();
    const full = await upload(venue, 'PICTURE', png({ width: 950, height: 700 }));
    expect(full.status).toBe(409);
  });
});
