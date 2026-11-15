import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TvBrowser, displayApi, pairTv } from '../helpers/displays';
import { nightApi, nightConfig, tvFrameByToken } from '../helpers/quiznight';
import { startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, type VenueFixture } from '../helpers/venue';

/**
 * ATTACK 95 - putting a quiz night on a paired TV from the panel (docs/TODO.md A6). The owner's tablet asks
 * the server to hand the TV a signed display link on its next poll. Only the owner of the venue may do it,
 * only for a TV and a night of that same venue, the TV gets it once, and the hand-over leaks nothing else.
 */
let offset = 0;
let server: TestServer;
let a: VenueFixture;
let b: VenueFixture;
beforeAll(async () => {
  server = await startServer({
    seed: false,
    clock: { now: () => Date.now() + offset },
    env: { VENUE_LOCK: '1', RATE_LIMIT_SCALE: '100' },
  });
  await setVenueFlag(server, true);
  a = await makeVenue(server);
  b = await makeVenue(server);
});
afterAll(async () => {
  await server.dispose();
});

const newNight = async (venue: VenueFixture): Promise<string> => {
  const created = await nightApi(server, venue.owner, venue.venueId).create(nightConfig());
  expect(created.status).toBe(201);
  return (created.body as { night: { id: string } }).night.id;
};

describe('ATTACK 95 - a quiz night on a paired TV', () => {
  it('hands the TV a signed link once, and that link shows the night', async () => {
    const { tv, displayId } = await pairTv(server, a.owner, a.venueId, 'Salon TV');
    const nightId = await newNight(a);
    const sent = await displayApi(server, a.owner, a.venueId).openNight(displayId, { nightId });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const first = await tv.poll();
    const path = first.body.night?.path ?? '';
    expect(path).toMatch(/^\/tv\/gece\?l=[A-Za-z0-9._~%-]{20,400}$/u);
    // Taken once: the next poll has nothing.
    expect((await tv.poll()).body.night).toBeUndefined();
    // The link is the ordinary display link of the night: it shows the title and nothing secret.
    const token = decodeURIComponent(new URL(path, 'http://x').searchParams.get('l')!);
    const frame = await tvFrameByToken(server, token);
    expect(frame.status).toBe(200);
    expect(frame.body.view).toMatchObject({ title: 'Cuma Quiz Gecesi', step: 'WAITING' });
    expect(JSON.stringify(frame.body)).not.toContain('"cmd"');
    // Nothing of the night rides on the poll answer besides the address.
    expect(JSON.stringify(first.body)).not.toContain('Cuma Quiz Gecesi');
    // Revoking the night's links turns the TV's link off (the page then goes back to the menu).
    await nightApi(server, a.owner, a.venueId).revoke(nightId);
    expect((await tvFrameByToken(server, token)).status).toBe(404);
  });

  it('is for the owner of the venue only: staff, a stranger, another café and nobody are refused', async () => {
    const { displayId } = await pairTv(server, a.owner, a.venueId, 'Salon TV 2');
    const nightId = await newNight(a);
    expect(
      (await displayApi(server, a.staff, a.venueId).openNight(displayId, { nightId })).status,
    ).toBe(403);
    expect(
      (await displayApi(server, null, a.venueId).openNight(displayId, { nightId })).status,
    ).toBe(401);
    expect(
      (await displayApi(server, b.owner, a.venueId).openNight(displayId, { nightId })).status,
    ).toBe(404);
  });

  it("refuses another café's TV, another café's night, a revoked TV and unknown ids, with the same answer", async () => {
    const mine = await pairTv(server, a.owner, a.venueId, 'Salon TV 3');
    const theirs = await pairTv(server, b.owner, b.venueId, 'Teras TV');
    const myNight = await newNight(a);
    const theirNight = await newNight(b);
    const api = displayApi(server, a.owner, a.venueId);
    // Another café's night, on my TV.
    expect((await api.openNight(mine.displayId, { nightId: theirNight })).status).toBe(404);
    // My night, on another café's TV (by id, under my venue path): that TV is simply unknown here.
    expect((await api.openNight(theirs.displayId, { nightId: myNight })).status).toBe(404);
    expect(
      (
        await displayApi(server, b.owner, b.venueId).openNight(theirs.displayId, {
          nightId: myNight,
        })
      ).status,
    ).toBe(404);
    // Unknown ids.
    const nobody = '00000000-0000-4000-8000-000000000000';
    expect((await api.openNight(nobody, { nightId: myNight })).status).toBe(404);
    expect((await api.openNight(mine.displayId, { nightId: nobody })).status).toBe(404);
    expect((await mine.tv.poll()).body.night).toBeUndefined();
    expect((await theirs.tv.poll()).body.night).toBeUndefined();
    // A revoked TV gets nothing, and cannot even be asked.
    expect((await api.revoke(mine.displayId)).status).toBe(200);
    expect((await api.openNight(mine.displayId, { nightId: myNight })).status).toBe(404);
    expect((await mine.tv.poll()).body.night).toBeUndefined();
  });

  it('refuses malformed bodies and a TV that is offline, and an unpaired browser never receives anything', async () => {
    const { displayId } = await pairTv(server, a.owner, a.venueId, 'Salon TV 4');
    const nightId = await newNight(a);
    const api = displayApi(server, a.owner, a.venueId);
    for (const body of [{}, { nightId: 'x' }, { nightId, extra: 1 }, { nightId: 5 }, null])
      expect((await api.openNight(displayId, body)).status, JSON.stringify(body)).toBe(400);
    // A TV not seen for a while is offline: the owner is told, nothing is queued.
    offset += 120_000;
    const offline = await api.openNight(displayId, { nightId });
    expect(offline.status).toBe(409);
    expect(offline.body).toMatchObject({ error: { params: { reason: 'offline' } } });
    const stranger = new TvBrowser(server);
    expect((await stranger.poll()).body).toEqual({ lock: true, paired: false, pairing: null });
  });
});
