import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, type VenueFixture } from '../helpers/venue';

/** The Soru Stüdyosu's manual form (ADR-0028 §6): same pipeline as a file, owner only, venue-scoped. */
let server: TestServer;
let a: VenueFixture;
let b: VenueFixture;
beforeAll(async () => {
  server = await startServer({ seed: true });
  await setVenueFlag(server, true);
  a = await makeVenue(server);
  b = await makeVenue(server);
});
afterAll(async () => {
  await server.dispose();
});

const form = (over: Record<string, unknown> = {}) => ({
  mode: 'save',
  category: 'Kutu Oyunları',
  question: 'Catan oyununda kaç kaynak türü vardır?',
  options: ['Üç', 'Dört', 'Beş', 'Altı'],
  correctIndex: 2,
  difficulty: 'MEDIUM',
  explanation: 'Kerpiç, odun, koyun, buğday ve cevher olmak üzere beş kaynak vardır.',
  ...over,
});
const send = (who: { token: string } | null, venue: VenueFixture, body: unknown) =>
  call<{ status: string; saved: boolean; issues: { code: string }[]; error?: { code: string } }>(
    server,
    'POST',
    `/v1/venues/${venue.venueId}/questions/manual`,
    { cookies: false, ...(who ? { token: who.token } : {}), body },
  );
const rows = (venueId: string) =>
  server.db.db.selectFrom('questions').selectAll().where('owner_venue_id', '=', venueId).execute();

describe('manual question', () => {
  it('checks without writing, then saves an ACTIVE venue question by the owner', async () => {
    const checked = await send(a.owner, a, form({ mode: 'check' }));
    expect(checked.body).toMatchObject({ status: 'OK', saved: false });
    expect(await rows(a.venueId)).toHaveLength(0);

    const saved = await send(a.owner, a, form());
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ status: 'OK', saved: true });
    const stored = await rows(a.venueId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ status: 'ACTIVE', pool: 'VENUE', author_type: 'HUMAN' });
    const upload = await server.db.db
      .selectFrom('venue_question_uploads')
      .select(['origin', 'rows_imported'])
      .where('venue_id', '=', a.venueId)
      .executeTakeFirstOrThrow();
    expect(upload).toEqual({ origin: 'MANUAL', rows_imported: 1 });
  });

  it('refuses the same question twice, and says why in codes the page translates', async () => {
    const again = await send(a.owner, a, form({ explanation: 'Başka bir açıklama metni burada.' }));
    expect(again.body.saved).toBe(false);
    expect(again.body.status).toBe('DUPLICATE');
    expect(await rows(a.venueId)).toHaveLength(1);
  });

  it('reports a bad question with issues and stores nothing', async () => {
    const bad = await send(
      a.owner,
      a,
      form({ question: 'kısa', options: ['a', 'a', 'b', 'c'], category: 'Kutu Oyunları' }),
    );
    expect(bad.body.saved).toBe(false);
    expect(bad.body.status).not.toBe('OK');
    expect(bad.body.issues.length).toBeGreaterThan(0);
    const link = await send(
      a.owner,
      a,
      form({ question: 'Bu soru bir bağlantı içeriyor mu http://kotu.example?' }),
    );
    expect(link.body.saved).toBe(false);
  });

  it('is for the owner of this venue only', async () => {
    expect((await send(a.staff, a, form())).status).toBe(403);
    expect((await send(b.owner, a, form())).status).toBe(404);
    expect((await send(null, a, form())).status).toBe(401);
    expect((await send(a.owner, a, { ...form(), extra: 1 })).status).toBe(400);
    expect((await send(a.owner, a, form({ options: ['a', 'b'] }))).status).toBe(400);
    expect(await rows(b.venueId)).toHaveLength(0);
  });

  it('keeps a venue question out of the other venue and the public bank', async () => {
    const mine = await rows(a.venueId);
    expect(mine.every((row) => row.owner_venue_id === a.venueId)).toBe(true);
    expect(await rows(b.venueId)).toHaveLength(0);
    // Venue B can write the same text without learning of A's.
    expect((await send(b.owner, b, form())).body).toMatchObject({ status: 'OK', saved: true });
  });
});
