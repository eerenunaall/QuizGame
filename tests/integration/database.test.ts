import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, migrationsCurrent } from '@quizparty/db';
import { MIGRATIONS_DIR, createTestDatabase, type TestDatabase } from '@quizparty/db/testing';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

const roomRow = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  code: 'ABC234',
  ...overrides,
});

describe('migration runner', () => {
  it('is idempotent and reports the current schema as up to date', async () => {
    const report = await runMigrations(t.pool, MIGRATIONS_DIR);
    expect(report.applied).toEqual([]);
    expect(report.alreadyApplied.length).toBeGreaterThanOrEqual(2);
    expect(await migrationsCurrent(t.pool, MIGRATIONS_DIR)).toBe(true);
  });

  it('refuses a migration that was edited after being applied, and a missing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qp-mig-'));
    try {
      cpSync(MIGRATIONS_DIR, dir, { recursive: true });
      const first = readdirSync(dir).sort()[0]!;
      writeFileSync(join(dir, first), `${readFileSync(join(dir, first), 'utf8')}\n-- tampered\n`);
      await expect(runMigrations(t.pool, dir)).rejects.toThrow(/modified after being applied/);
      expect(await migrationsCurrent(t.pool, dir)).toBe(false);
      rmSync(join(dir, first));
      await expect(runMigrations(t.pool, dir)).rejects.toThrow(/file is missing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serializes concurrent runners with an advisory lock', async () => {
    const results = await Promise.all([1, 2, 3].map(() => runMigrations(t.pool, MIGRATIONS_DIR)));
    expect(results.every((r) => r.applied.length === 0)).toBe(true);
  });
});

describe('rooms', () => {
  it('validates room codes with the shared alphabet', async () => {
    for (const code of ['ABC12', 'ABCDEFG', 'abc234', 'ABC10O', 'ABCIL1']) {
      await expect(
        t.db.insertInto('rooms').values(roomRow({ code })).execute(),
        code,
      ).rejects.toThrow();
    }
    await expect(
      t.db
        .insertInto('rooms')
        .values(roomRow({ code: 'X7P4KQ' }))
        .execute(),
    ).resolves.toBeDefined();
  });

  it('allows one open room per code and releases the code when the room closes', async () => {
    await t.db
      .insertInto('rooms')
      .values(roomRow({ code: 'KKKKKK' }))
      .execute();
    await expect(
      t.db
        .insertInto('rooms')
        .values(roomRow({ code: 'KKKKKK' }))
        .execute(),
    ).rejects.toThrow(/duplicate key/);
    await t.db
      .updateTable('rooms')
      .set({ status: 'CLOSED', closed_at: new Date(), close_reason: 'FINISHED' })
      .where('code', '=', 'KKKKKK')
      .execute();
    await expect(
      t.db
        .insertInto('rooms')
        .values(roomRow({ code: 'KKKKKK' }))
        .execute(),
    ).resolves.toBeDefined();
  });

  it('keeps status and closed_at consistent', async () => {
    await expect(
      t.db
        .insertInto('rooms')
        .values(roomRow({ code: 'MMMMMM', status: 'CLOSED' }))
        .execute(),
    ).rejects.toThrow();
  });
});

describe('room_events (fencing and immutability)', () => {
  it('rejects a second writer for the same sequence number', async () => {
    const id = randomUUID();
    await t.db.insertInto('rooms').values({ id, code: 'NNNNNN' }).execute();
    await t.db
      .insertInto('room_events')
      .values({ room_id: id, seq: 1, at: 1, input: JSON.stringify({ kind: 'TICK' }) })
      .execute();
    await expect(
      t.db
        .insertInto('room_events')
        .values({ room_id: id, seq: 1, at: 2, input: JSON.stringify({ kind: 'TICK' }) })
        .execute(),
    ).rejects.toThrow(/duplicate key/);
  });

  it('refuses updates (append-only) but cascades deletes with the room', async () => {
    const id = randomUUID();
    await t.db.insertInto('rooms').values({ id, code: 'PPPPPP' }).execute();
    await t.db
      .insertInto('room_events')
      .values({ room_id: id, seq: 1, at: 1, input: JSON.stringify({}) })
      .execute();
    await expect(
      t.db.updateTable('room_events').set({ at: 5 }).where('room_id', '=', id).execute(),
    ).rejects.toThrow(/append-only/);
    await t.db.deleteFrom('rooms').where('id', '=', id).execute();
    const left = await t.db
      .selectFrom('room_events')
      .select('seq')
      .where('room_id', '=', id)
      .execute();
    expect(left).toEqual([]);
  });

  it('stores epoch milliseconds as safe numbers', async () => {
    const id = randomUUID();
    await t.db.insertInto('rooms').values({ id, code: 'QQQQQQ' }).execute();
    await t.db
      .insertInto('room_events')
      .values({ room_id: id, seq: 1, at: 1_700_000_000_123, input: JSON.stringify({}) })
      .execute();
    const row = await t.db
      .selectFrom('room_events')
      .select('at')
      .where('room_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.at).toBe(1_700_000_000_123);
  });
});

describe('sessions', () => {
  it('enforces one live slot per device per room and one player per slot', async () => {
    const roomId = randomUUID();
    await t.db.insertInto('rooms').values({ id: roomId, code: 'RRRRRR' }).execute();
    const base = { room_id: roomId, role: 'PLAYER' as const, token_hash: 'h' };
    await t.db
      .insertInto('room_sessions')
      .values({ ...base, id: randomUUID(), player_id: 'p1', device_id_hash: 'dev' })
      .execute();
    await expect(
      t.db
        .insertInto('room_sessions')
        .values({ ...base, id: randomUUID(), player_id: 'p2', device_id_hash: 'dev' })
        .execute(),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      t.db
        .insertInto('room_sessions')
        .values({ ...base, id: randomUUID(), player_id: 'p1', device_id_hash: 'other' })
        .execute(),
    ).rejects.toThrow(/duplicate key/);
    // a revoked slot frees the device
    await t.db
      .updateTable('room_sessions')
      .set({ status: 'REVOKED' })
      .where('device_id_hash', '=', 'dev')
      .execute();
    await expect(
      t.db
        .insertInto('room_sessions')
        .values({ ...base, id: randomUUID(), player_id: 'p3', device_id_hash: 'dev' })
        .execute(),
    ).resolves.toBeDefined();
  });

  it('ties role to player_id and allows a single active display', async () => {
    const roomId = randomUUID();
    await t.db.insertInto('rooms').values({ id: roomId, code: 'SSSSSS' }).execute();
    await expect(
      t.db
        .insertInto('room_sessions')
        .values({ id: randomUUID(), room_id: roomId, role: 'PLAYER', token_hash: 'x' })
        .execute(),
    ).rejects.toThrow();
    await t.db
      .insertInto('room_sessions')
      .values({ id: randomUUID(), room_id: roomId, role: 'DISPLAY', token_hash: 'x' })
      .execute();
    await expect(
      t.db
        .insertInto('room_sessions')
        .values({ id: randomUUID(), room_id: roomId, role: 'DISPLAY', token_hash: 'y' })
        .execute(),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe('game audit tables', () => {
  async function seedGame() {
    const roomId = randomUUID();
    const gameId = randomUUID();
    await t.db
      .insertInto('rooms')
      .values({ id: roomId, code: ['T', 'T', 'T', 'T', 'T', 'T'].join('') })
      .onConflict((oc) => oc.doNothing())
      .execute();
    const room = await t.db
      .selectFrom('rooms')
      .select('id')
      .where('code', '=', 'TTTTTT')
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto('games')
      .values({
        id: gameId,
        room_id: room.id,
        started_at: new Date(),
        total_rounds: 10,
        config_version: 1,
        player_count: 2,
      })
      .execute();
    await t.db
      .insertInto('game_rounds')
      .values({
        game_id: gameId,
        round_index: 0,
        kind: 'STANDARD',
        question_id: 'q1',
        answer_ms: 15000,
        config_version: 1,
      })
      .execute();
    return gameId;
  }

  it('allows at most one answer per player per round', async () => {
    const gameId = await seedGame();
    const answer = {
      game_id: gameId,
      round_index: 0,
      player_id: 'p1',
      option_key: 'k',
      correct: true,
      remaining_ms: 1000,
    };
    await t.db.insertInto('game_answers').values(answer).execute();
    await expect(t.db.insertInto('game_answers').values(answer).execute()).rejects.toThrow(
      /duplicate key/,
    );
    await expect(
      t.db
        .insertInto('game_answers')
        .values({ ...answer, player_id: 'p2', remaining_ms: -1 })
        .execute(),
    ).rejects.toThrow();
  });

  it('keeps score deltas append-only and never lets a total go negative', async () => {
    const gameId = await seedGame();
    const row = {
      game_id: gameId,
      round_index: 0,
      player_id: 'p1',
      delta: 150,
      total_after: 150,
      components: JSON.stringify([]),
      config_version: 1,
    };
    await t.db.insertInto('score_deltas').values(row).execute();
    await expect(
      t.db.updateTable('score_deltas').set({ delta: 999 }).where('game_id', '=', gameId).execute(),
    ).rejects.toThrow(/append-only/);
    await expect(
      t.db
        .insertInto('score_deltas')
        .values({ ...row, player_id: 'p2', total_after: -1 })
        .execute(),
    ).rejects.toThrow();
  });
});

describe('question bank constraints', () => {
  const category = { id: 'history', label_tr: 'Tarih', label_en: 'History' };
  const question = (over: Record<string, unknown> = {}) => ({
    language: 'tr' as const,
    category_id: 'history',
    difficulty: 'EASY' as const,
    text: 'Türkiye Cumhuriyeti hangi yıl ilan edildi?',
    author_type: 'HUMAN' as const,
    lexical_fingerprint: randomUUID(),
    ...over,
  });

  beforeAll(async () => {
    await t.db
      .insertInto('categories')
      .values(category)
      .onConflict((oc) => oc.doNothing())
      .execute();
  });

  it('keeps the dev-seed flag consistent with the author type', async () => {
    await expect(
      t.db
        .insertInto('questions')
        .values(question({ is_dev_seed: true }))
        .execute(),
    ).rejects.toThrow();
    await expect(
      t.db
        .insertInto('questions')
        .values(question({ author_type: 'DEV_SEED', is_dev_seed: true }))
        .execute(),
    ).resolves.toBeDefined();
  });

  it('forbids duplicate lexical fingerprints per language', async () => {
    const fingerprint = randomUUID();
    await t.db
      .insertInto('questions')
      .values(question({ lexical_fingerprint: fingerprint }))
      .execute();
    await expect(
      t.db
        .insertInto('questions')
        .values(question({ lexical_fingerprint: fingerprint }))
        .execute(),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      t.db
        .insertInto('questions')
        .values(question({ lexical_fingerprint: fingerprint, language: 'en' }))
        .execute(),
    ).resolves.toBeDefined();
  });

  it('allows at most one correct option and unique positions', async () => {
    const q = await t.db
      .insertInto('questions')
      .values(question())
      .returning('id')
      .executeTakeFirstOrThrow();
    const option = (position: number, correct: boolean) => ({
      question_id: q.id,
      position,
      text: `o${position}`,
      is_correct: correct,
    });
    await t.db
      .insertInto('question_options')
      .values([option(0, true), option(1, false)])
      .execute();
    await expect(
      t.db.insertInto('question_options').values(option(2, true)).execute(),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      t.db.insertInto('question_options').values(option(1, false)).execute(),
    ).rejects.toThrow(/duplicate key/);
  });

  it('requires an expiry date for current-events questions', async () => {
    await expect(
      t.db
        .insertInto('questions')
        .values(question({ pool: 'CURRENT' }))
        .execute(),
    ).rejects.toThrow();
    await expect(
      t.db
        .insertInto('questions')
        .values(question({ pool: 'CURRENT', expires_at: new Date(Date.now() + 86_400_000) }))
        .execute(),
    ).resolves.toBeDefined();
  });

  it('supports trigram similarity search for near-duplicate candidates', async () => {
    const q = await t.db
      .insertInto('questions')
      .values(question({ text: 'Mimar Sinan Selimiye Camii’ni hangi şehirde inşa etmiştir?' }))
      .returning('id')
      .executeTakeFirstOrThrow();
    const { rows } = await sql<{ id: string; sim: number }>`
      SELECT id, similarity(text, 'Mimar Sinan Selimiye Camisini hangi şehirde inşa etti?') AS sim
      FROM questions WHERE text % 'Mimar Sinan Selimiye Camisini hangi şehirde inşa etti?' ORDER BY sim DESC LIMIT 3`.execute(
      t.db,
    );
    expect(rows[0]?.id).toBe(q.id);
    expect(rows[0]!.sim).toBeGreaterThan(0.5);
  });
});
