import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { staff as adminStaff } from '../helpers/admin';
import { call } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';
import {
  makeVenue,
  person,
  seedVenueQuestions,
  setVenueFlag,
  type VenueFixture,
} from '../helpers/venue';

/**
 * The owner's answers view over HTTP (ADR-0030 §5): the global bank and the venue's own questions with the
 * correct option marked. OWNER only; another venue's private questions never appear.
 */
let server: TestServer;
let a: VenueFixture;
let b: VenueFixture;
beforeAll(async () => {
  server = await startServer({ seed: true });
  await setVenueFlag(server, true);
  a = await makeVenue(server);
  b = await makeVenue(server);
  await seedVenueQuestions(server, a.venueId, 5, { prefix: 'Çınar' });
  await seedVenueQuestions(server, b.venueId, 5, { prefix: 'Rakipkafe' });
  // the venue's questions are in review until activated; one is ACTIVE
  await server.db.db
    .updateTable('questions')
    .set({ status: 'ACTIVE' })
    .where('owner_venue_id', '=', a.venueId)
    .execute();
  await server.db.db
    .updateTable('questions')
    .set({ status: 'ACTIVE' })
    .where('owner_venue_id', '=', b.venueId)
    .execute();
});
afterAll(async () => {
  await server.dispose();
});

interface Item {
  id: string;
  text: string;
  explanation: string | null;
  status: string;
  difficulty: string;
  category: string;
  options: { text: string; correct: boolean }[];
}
interface Page {
  total: number;
  hasMore: boolean;
  items: Item[];
  error?: { code: string };
}
const bank = (who: { token: string } | null, venueId = a.venueId) => {
  const send = <T>(path: string) =>
    call<T>(server, 'GET', `/v1/venues/${venueId}/bank/${path}`, {
      cookies: false,
      ...(who ? { token: who.token } : {}),
    });
  return {
    questions: (query = '') => send<Page>(`questions${query}`),
    categories: (query = '') =>
      send<{ categories: { id: string; label: string; count: number }[] }>(`categories${query}`),
  };
};

describe('the global bank', () => {
  it('shows playable questions with every option and exactly one marked correct', async () => {
    const result = await bank(a.owner).questions();
    expect(result.status).toBe(200);
    expect(result.body.total).toBeGreaterThan(10);
    expect(result.body.items.length).toBeLessThanOrEqual(12);
    for (const item of result.body.items) {
      expect(item.status).toBe('ACTIVE');
      expect(item.options).toHaveLength(4);
      expect(item.options.filter((option) => option.correct)).toHaveLength(1);
      expect(item.text.length).toBeGreaterThan(5);
      expect(Object.keys(item).sort()).toEqual(
        ['category', 'difficulty', 'explanation', 'id', 'options', 'status', 'text'].sort(),
      );
    }
  });

  it('never carries the venue’s private questions, nor another venue’s', async () => {
    const all = await bank(a.owner).questions('?scope=GLOBAL&language=tr');
    const text = JSON.stringify(all.body);
    expect(text).not.toContain('Çınar sorusu');
    expect(text).not.toContain('Rakipkafe');
    const search = await bank(a.owner).questions('?q=Rakipkafe');
    expect(search.body.items).toHaveLength(0);
  });

  it('searches, filters by category and pages', async () => {
    const first = await bank(a.owner).questions();
    const word = first.body.items[0]!.text.split(' ').find((part) => part.length > 5)!;
    const found = await bank(a.owner).questions(`?q=${encodeURIComponent(word)}`);
    expect(found.body.items.some((item) => item.id === first.body.items[0]!.id)).toBe(true);
    expect(found.body.total).toBeLessThanOrEqual(first.body.total);

    const categories = await bank(a.owner).categories();
    expect(categories.body.categories.length).toBeGreaterThan(0);
    const category = categories.body.categories[0]!;
    const filtered = await bank(a.owner).questions(`?category=${category.id}`);
    expect(filtered.body.total).toBe(category.count);

    if (first.body.hasMore) {
      const second = await bank(a.owner).questions('?offset=12');
      expect(second.body.items[0]!.id).not.toBe(first.body.items[0]!.id);
    }
    // wildcard characters in a search are plain text
    const wild = await bank(a.owner).questions(`?q=${encodeURIComponent('%%')}`);
    expect(wild.body.total).toBe(0);
  });

  it('refuses malformed queries', async () => {
    for (const query of [
      '?scope=ALL',
      '?language=de',
      '?offset=-1',
      '?offset=99999',
      '?category=A%20B',
      '?x=1',
    ])
      expect((await bank(a.owner).questions(query)).status, query).toBe(400);
  });
});

describe('the venue’s own questions', () => {
  it('lists this venue’s questions only, with their answers', async () => {
    const mine = await bank(a.owner).questions('?scope=VENUE');
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBe(5);
    expect(mine.body.items.every((item) => item.text.startsWith('Çınar'))).toBe(true);
    expect(mine.body.items[0]!.options.some((option) => option.correct)).toBe(true);
    const theirs = await bank(b.owner, b.venueId).questions('?scope=VENUE');
    expect(theirs.body.items.every((item) => item.text.startsWith('Rakipkafe'))).toBe(true);
    // another venue's id in the path is not a way in
    expect((await bank(a.owner, b.venueId).questions('?scope=VENUE')).status).toBe(404);
    const cats = await bank(a.owner).categories('?scope=VENUE');
    expect(JSON.stringify(cats.body)).not.toContain('Rakip');
  });
});

describe('who may read it', () => {
  it('is for the owner of this venue only', async () => {
    expect((await bank(a.staff).questions()).status).toBe(403);
    expect((await bank(a.staff).categories()).status).toBe(403);
    expect((await bank(b.owner, a.venueId).questions()).status).toBe(404);
    expect((await bank(null).questions()).status).toBe(401);
    const stranger = await person(server, 'stranger');
    expect((await bank(stranger).questions()).status).toBe(404);
    const app = await person(server, 'app', 'MOBILE');
    expect((await bank(app).questions()).status).toBe(404);
    const admin = await adminStaff(server, ['ADMIN']);
    expect((await bank(admin).questions()).status).toBe(403);
  });

  it('leaves a record of every read', async () => {
    const before = await server.db.db
      .selectFrom('security_events')
      .select('id')
      .where('kind', '=', 'VENUE_BANK_READ')
      .execute();
    await bank(a.owner).questions('?q=tarih');
    await bank(a.owner).questions('?q=tarih');
    await bank(a.owner).categories();
    const after = await server.db.db
      .selectFrom('security_events')
      .selectAll()
      .where('kind', '=', 'VENUE_BANK_READ')
      .orderBy('id')
      .execute();
    expect(after.length - before.length).toBe(3);
    const last = after[after.length - 2]!;
    expect(last.detail).toMatchObject({
      venue: a.venueId,
      account: a.owner.accountId,
      what: 'questions',
      search: true,
    });
    // the search words themselves are not stored
    expect(JSON.stringify(after.map((row) => row.detail))).not.toContain('tarih');
  });
});
