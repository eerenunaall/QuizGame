import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import type { DeckRequest } from '@quizparty/game-engine';
import { FeatureFlags } from '../../apps/realtime/src/flags/service';
import { DeckBuilder } from '../../apps/realtime/src/rooms/deck-builder';
import { seedTestBank } from '../helpers/bank';
import { seedVenueQuestions } from '../helpers/venue';

/** Which questions a room's deck may contain, and how a venue's history steers it (ADR-0025 §1, §8, §9). */
let t: TestDatabase;
const clock = { now: () => Date.UTC(2026, 9, 20, 12) };

async function venue(name: string, settings: unknown = {}): Promise<string> {
  const row = await t.db
    .insertInto('venues')
    .values({ name, settings: JSON.stringify(settings) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}
async function attach(venueId: string, state: 'RUNNING' | 'ENDED' = 'RUNNING'): Promise<string> {
  const roomId = crypto.randomUUID();
  await t.db
    .insertInto('venue_sessions')
    .values({
      venue_id: venueId,
      room_id: roomId,
      room_code: 'ABCDEF',
      purchased_seconds: 3600,
      started_at: new Date(),
      ...(state === 'ENDED' ? { state: 'ENDED', ended_at: new Date() } : {}),
    })
    .execute();
  return roomId;
}
const request = (roomId: string, over: Partial<DeckRequest> = {}): DeckRequest => ({
  roomId,
  mode: 'CLASSIC',
  contentRef: null,
  tier: 'FULL',
  language: 'tr',
  rounds: 10,
  categories: 'ALL',
  hostAccountId: null,
  playerCount: 3,
  ...over,
});
const builder = (
  extra: { freshWindow?: number; random?: () => number; flags?: FeatureFlags } = {},
) => new DeckBuilder(t.db, { allowDevSeed: true, clock, ...extra });
const idsOf = (deck: { questions: Record<string, unknown> }): string[] =>
  Object.keys(deck.questions);
const ownerOf = async (ids: string[]) =>
  new Map(
    (
      await t.db
        .selectFrom('questions')
        .select(['id', 'owner_venue_id'])
        .where('id', 'in', ids)
        .execute()
    ).map((r) => [r.id, r.owner_venue_id]),
  );

let a: string;
let b: string;
beforeAll(async () => {
  t = await createTestDatabase();
  await seedTestBank(t.db, 24);
  a = await venue('A');
  b = await venue('B');
  const server = { db: t } as never;
  await seedVenueQuestions(server, a, 40, { prefix: 'Alfa' });
  await seedVenueQuestions(server, b, 40, { prefix: 'Beta' });
});
afterAll(async () => {
  await t.drop();
});

describe('who sees venue questions', () => {
  it('a room that is no venue table never gets one, even when asking for the venue category', async () => {
    const category = (
      await t.db
        .selectFrom('categories')
        .select('id')
        .where('owner_venue_id', '=', a)
        .executeTakeFirstOrThrow()
    ).id;
    const everything = await builder().build(request(crypto.randomUUID()));
    expect([...(await ownerOf(idsOf(everything))).values()].every((owner) => owner === null)).toBe(
      true,
    );
    // only the venue's category, from a room that is not its table: no deck at all
    await expect(
      builder().build(request(crypto.randomUUID(), { categories: [category] })),
    ).rejects.toThrow();
  });

  it('with venue.sessions off a table left behind is a plain room: no venue question', async () => {
    const room = await attach(a);
    const flags = new FeatureFlags(t.db, clock, 1);
    for (const [enabled, expectVenue] of [
      [false, false],
      [true, true],
    ] as const) {
      await t.db
        .updateTable('feature_flags')
        .set({ enabled })
        .where('key', '=', 'venue.sessions')
        .execute();
      flags.invalidate();
      let seen = 0;
      for (let i = 0; i < 6; i++) {
        const deck = await builder({ flags }).build(request(room));
        for (const owner of (await ownerOf(idsOf(deck))).values()) if (owner === a) seen++;
      }
      expect(seen > 0).toBe(expectVenue);
    }
  });

  it("a venue's table gets its own questions and never another venue's", async () => {
    const room = await attach(a);
    const owners = new Set<string | null>();
    let venueSeen = 0;
    for (let i = 0; i < 6; i++) {
      const deck = await builder().build(request(room));
      for (const owner of (await ownerOf(idsOf(deck))).values()) {
        owners.add(owner);
        if (owner === a) venueSeen++;
      }
    }
    expect(owners.has(b)).toBe(false);
    expect(venueSeen).toBeGreaterThan(0);
  });

  it('MIXED draws about the configured share from the venue', async () => {
    const v = await venue('Mix', { questions: { source: 'MIXED', venueSharePercent: 30 } });
    await seedVenueQuestions({ db: t } as never, v, 200, { prefix: 'Mix' });
    const room = await attach(v);
    const deck = await builder().build(request(room, { rounds: 30 }));
    const owners = [...(await ownerOf(idsOf(deck))).values()];
    const share = owners.filter((o) => o === v).length / owners.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.5);
  });

  it('GLOBAL_ONLY serves nothing of the venue; ENDED tables count as no venue', async () => {
    const v = await venue('Glob', { questions: { source: 'GLOBAL_ONLY' } });
    await seedVenueQuestions({ db: t } as never, v, 40, { prefix: 'Glob' });
    const deck = await builder().build(request(await attach(v)));
    expect([...(await ownerOf(idsOf(deck))).values()].every((o) => o === null)).toBe(true);
    const ended = await builder().build(request(await attach(a, 'ENDED')));
    expect([...(await ownerOf(idsOf(ended))).values()].every((o) => o === null)).toBe(true);
  });

  it('VENUE_ONLY prefers the venue and falls back to the bank instead of blocking a game', async () => {
    const full = await venue('Only', { questions: { source: 'VENUE_ONLY' } });
    await seedVenueQuestions({ db: t } as never, full, 120, { prefix: 'Only' });
    const room = await attach(full);
    const owners = [...(await ownerOf(idsOf(await builder().build(request(room))))).values()];
    expect(owners.filter((o) => o === full).length / owners.length).toBeGreaterThan(0.9);

    const tiny = await venue('Tiny', { questions: { source: 'VENUE_ONLY' } });
    await seedVenueQuestions({ db: t } as never, tiny, 3, { prefix: 'Tiny' });
    const deck = await builder().build(request(await attach(tiny)));
    const mixed = [...(await ownerOf(idsOf(deck))).values()];
    expect(mixed.filter((o) => o === null).length).toBeGreaterThan(0);
    expect(mixed.length).toBeGreaterThanOrEqual(10);
  });

  it('a retired or reported-away venue question is not drawn', async () => {
    const v = await venue('Gone', { questions: { source: 'VENUE_ONLY' } });
    const ids = await seedVenueQuestions({ db: t } as never, v, 60, { prefix: 'Gone' });
    await t.db
      .updateTable('questions')
      .set({ status: 'RETIRED' })
      .where('id', 'in', ids.slice(0, 30))
      .execute();
    const deck = await builder().build(request(await attach(v)));
    const drawn = new Set(idsOf(deck));
    expect(ids.slice(0, 30).some((id) => drawn.has(id))).toBe(false);
  });
});

describe('freshness with a real history', () => {
  it('prefers questions this venue has not played, and never fails when it has played them all', async () => {
    const v = await venue('Fresh', { questions: { source: 'VENUE_ONLY' } });
    const ids = await seedVenueQuestions({ db: t } as never, v, 100, { prefix: 'Taze' });
    const room = await attach(v);
    const seen = new Set<string>();
    const perBucket = new Map<string, Set<string>>();
    const difficulty = new Map(
      (
        await t.db
          .selectFrom('questions')
          .select(['id', 'difficulty'])
          .where('id', 'in', ids)
          .execute()
      ).map((r) => [r.id, r.difficulty]),
    );
    for (let game = 0; game < 4; game++) {
      const deck = await builder({ random: Math.random }).build(request(room));
      const mine = idsOf(deck).filter((id) => ids.includes(id));
      const before = new Map([...perBucket].map(([bucket, set]) => [bucket, set.size]));
      const drawn = new Map<string, number>();
      const repeats = new Map<string, number>();
      for (const id of mine) {
        const bucket = difficulty.get(id)!;
        const set = perBucket.get(bucket) ?? new Set<string>();
        drawn.set(bucket, (drawn.get(bucket) ?? 0) + 1);
        if (set.has(id)) repeats.set(bucket, (repeats.get(bucket) ?? 0) + 1);
        set.add(id);
        perBucket.set(bucket, set);
        seen.add(id);
      }
      // a question repeats only once the bucket's 25 were all played
      for (const [bucket, count] of drawn)
        expect(repeats.get(bucket) ?? 0, `game ${game} ${bucket}`).toBeLessThanOrEqual(
          Math.max(0, count - (25 - (before.get(bucket) ?? 0))),
        );
      await t.db
        .insertInto('venue_question_history')
        .values(
          mine.map((id, i) => ({
            venue_id: v,
            question_id: id,
            played_at: new Date(Date.UTC(2026, 9, 20, 12, game, i)),
          })),
        )
        .onConflict((oc) =>
          oc
            .columns(['venue_id', 'question_id'])
            .doUpdateSet((eb) => ({ played_at: eb.ref('excluded.played_at') })),
        )
        .execute();
    }
    expect(seen.size).toBeGreaterThan(60);
    // everything played: the next deck still builds
    await t.db
      .insertInto('venue_question_history')
      .values(
        ids.map((id) => ({
          venue_id: v,
          question_id: id,
          played_at: new Date(Date.UTC(2026, 9, 21)),
        })),
      )
      .onConflict((oc) =>
        oc
          .columns(['venue_id', 'question_id'])
          .doUpdateSet((eb) => ({ played_at: eb.ref('excluded.played_at') })),
      )
      .execute();
    expect(idsOf(await builder().build(request(room))).length).toBeGreaterThanOrEqual(10);
  });

  it('applies to the global bank in a venue room too', async () => {
    const v = await venue('GlobalFresh', { questions: { source: 'GLOBAL_ONLY' } });
    const room = await attach(v);
    const played = await t.db
      .selectFrom('questions')
      .select('id')
      .where('owner_venue_id', 'is', null)
      .where('category_id', '=', 'history')
      .execute();
    // the venue has played 20 of the 24 history questions
    const recent = played.slice(0, 20).map((r) => r.id);
    await t.db
      .insertInto('venue_question_history')
      .values(
        recent.map((id, i) => ({
          venue_id: v,
          question_id: id,
          played_at: new Date(Date.UTC(2026, 9, 1, 0, i)),
        })),
      )
      .execute();
    const deck = await builder().build(request(room, { categories: ['history'], rounds: 4 }));
    const drawn = idsOf(deck);
    const unseen = new Set(played.slice(20).map((r) => r.id));
    // 4 unseen exist; the deck (12+ questions) contains all of them, ahead of anything recent
    for (const id of unseen) expect(drawn).toContain(id);
  });
});
