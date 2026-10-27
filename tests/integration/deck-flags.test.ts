import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import { FeatureFlags } from '../../apps/realtime/src/flags/service';
import { DeckBuilder, NotEnoughQuestionsError } from '../../apps/realtime/src/rooms/deck-builder';
import type { DeckRequest } from '@quizparty/game-engine';
import { CategoryCatalogService } from '../../apps/realtime/src/rooms/catalog';
import { seedTestBank } from '../helpers/bank';

/** The CURRENT pool (news-bound questions) can be switched off without a deploy (GDD §22). */
let t: TestDatabase;
const clock = { now: () => Date.UTC(2026, 9, 6, 12) };
beforeAll(async () => {
  t = await createTestDatabase();
  await seedTestBank(t.db, 12);
  // Every question of one category is news-bound.
  await t.db
    .updateTable('questions')
    .set({ pool: 'CURRENT', expires_at: new Date(Date.UTC(2027, 0, 1)) })
    .where('category_id', '=', 'sports')
    .execute();
});
afterAll(async () => {
  await t.drop();
});

const setFlag = (enabled: boolean) =>
  t.db
    .updateTable('feature_flags')
    .set({ enabled })
    .where('key', '=', 'content.current_events')
    .execute();

const request = {
  roomId: '00000000-0000-4000-8000-000000000001',
  mode: 'CLASSIC',
  contentRef: null,
  tier: 'FULL',
  language: 'tr',
  rounds: 5,
  categories: ['sports'],
  hostAccountId: null,
  playerCount: 3,
} as const satisfies DeckRequest;
const builderWith = (flags: FeatureFlags) =>
  new DeckBuilder(t.db, { allowDevSeed: true, clock, flags });

describe('content.current_events', () => {
  it('serves the CURRENT pool while on and withholds it, and its category, when off', async () => {
    await setFlag(true);
    const on = new FeatureFlags(t.db, clock, 1);
    const deck = await builderWith(on).build({ ...request, categories: [...request.categories] });
    expect(Object.keys(deck.questions).length).toBeGreaterThanOrEqual(5);
    const catalogOn = await new CategoryCatalogService(
      t.db,
      new DeckBuilder(t.db, { allowDevSeed: true, clock, flags: on }),
      { allowDevSeed: true, clock, flags: on, ttlMs: 0 },
    ).list('tr');
    expect(catalogOn.categories.map((c) => c.id)).toContain('sports');

    await setFlag(false);
    const off = new FeatureFlags(t.db, clock, 1);
    await expect(
      builderWith(off).build({ ...request, categories: [...request.categories] }),
    ).rejects.toBeInstanceOf(NotEnoughQuestionsError);
    const catalogOff = await new CategoryCatalogService(
      t.db,
      new DeckBuilder(t.db, { allowDevSeed: true, clock, flags: off }),
      { allowDevSeed: true, clock, flags: off, ttlMs: 0 },
    ).list('tr');
    expect(catalogOff.categories.map((c) => c.id)).not.toContain('sports');
    expect(catalogOff.categories.map((c) => c.id)).toContain('history');
  });
});

describe('catalog minimum', () => {
  it('lists a category only when it holds enough ACTIVE questions', async () => {
    const flags = new FeatureFlags(t.db, clock, 1);
    const catalog = (minQuestions: number) =>
      new CategoryCatalogService(
        t.db,
        new DeckBuilder(t.db, { allowDevSeed: true, clock, flags }),
        { allowDevSeed: true, clock, flags, ttlMs: 0, minQuestions },
      ).list('tr');
    const all = await catalog(1);
    const thin = [...all.categories].sort((x, y) => x.questions - y.questions)[0]!;
    expect((await catalog(thin.questions)).categories.map((c) => c.id)).toContain(thin.id);
    const strict = await catalog(thin.questions + 1);
    expect(strict.categories.map((c) => c.id)).not.toContain(thin.id);
    expect(strict.categories.every((c) => c.questions >= thin.questions + 1)).toBe(true);
    const most = Math.max(...all.categories.map((c) => c.questions));
    expect((await catalog(most + 1)).categories).toEqual([]);
  });
});
