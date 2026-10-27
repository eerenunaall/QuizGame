import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import { QUESTION_REPORT_REASONS } from '@quizparty/protocol';
import { FeatureFlags } from '../../apps/realtime/src/flags/service';

let t: TestDatabase;
let now = 1_000_000;
const clock = { now: () => now };
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe('feature flags', () => {
  it('reads the switches, keeps them for the cache time and then follows a change', async () => {
    const flags = new FeatureFlags(t.db, clock, 10_000);
    expect(await flags.isEnabled('report.questions')).toBe(true);
    expect(await flags.isEnabled('mode.blind_quiz')).toBe(false);
    await t.db
      .updateTable('feature_flags')
      .set({ enabled: true })
      .where('key', '=', 'mode.blind_quiz')
      .execute();
    expect(await flags.isEnabled('mode.blind_quiz')).toBe(false); // still cached
    now += 10_001;
    expect(await flags.isEnabled('mode.blind_quiz')).toBe(true);
    await t.db
      .updateTable('feature_flags')
      .set({ enabled: false })
      .where('key', '=', 'mode.blind_quiz')
      .execute();
    flags.invalidate();
    expect(await flags.isEnabled('mode.blind_quiz')).toBe(false);
  });

  it('treats a switch that does not exist as off', async () => {
    expect(await new FeatureFlags(t.db, clock).isEnabled('no.such.flag')).toBe(false);
  });

  it('exposes only the public ones, in a stable order', async () => {
    const flags = await new FeatureFlags(t.db, clock).publicFlags();
    const rows = await t.db.selectFrom('feature_flags').select(['key', 'public']).execute();
    expect(Object.keys(flags)).toEqual(
      rows
        .filter((row) => row.public)
        .map((row) => row.key)
        .sort(),
    );
    expect(flags).not.toHaveProperty('sabotage.noise');
  });

  it('asks the database once when many callers arrive together', async () => {
    let queries = 0;
    const counting = t.db.withPlugin({
      transformQuery: (args) => {
        queries++;
        return args.node;
      },
      transformResult: (args) => Promise.resolve(args.result),
    });
    const flags = new FeatureFlags(counting, clock, 10_000);
    now += 20_000;
    await Promise.all(Array.from({ length: 25 }, () => flags.isEnabled('report.questions')));
    expect(queries).toBe(1);
  });

  it('keeps the last known values when the database fails, and turns everything off if it never answered', async () => {
    const broken = await createTestDatabase();
    const flags = new FeatureFlags(broken.db, clock, 1_000);
    expect(await flags.isEnabled('report.questions')).toBe(true);
    await broken.drop();
    now += 5_000;
    expect(await flags.isEnabled('report.questions')).toBe(true); // last known
    expect(await new FeatureFlags(broken.db, clock).isEnabled('report.questions')).toBe(false);
  });
});

describe('report reasons', () => {
  it('are exactly the ones the database accepts', async () => {
    const question = await t.db
      .insertInto('categories')
      .values({ id: 'g', label_tr: 'G', label_en: 'G' })
      .execute()
      .then(async () => {
        const id = crypto.randomUUID();
        await t.db
          .insertInto('questions')
          .values({
            id,
            language: 'tr',
            category_id: 'g',
            difficulty: 'EASY',
            text: 'Bu bir deneme sorusudur, yeterince uzun mu?',
            status: 'DRAFT',
            author_type: 'HUMAN',
            lexical_fingerprint: id,
          })
          .execute();
        return id;
      });
    for (const reason of QUESTION_REPORT_REASONS)
      await t.db
        .insertInto('question_reports')
        .values({
          question_id: question,
          question_revision: 1,
          reporter_hash: `r-${reason}`,
          reason,
        })
        .execute();
    await expect(
      t.db
        .insertInto('question_reports')
        .values({
          question_id: question,
          question_revision: 1,
          reporter_hash: 'r-x',
          reason: 'NOPE',
        })
        .execute(),
    ).rejects.toThrow();
  });
});
