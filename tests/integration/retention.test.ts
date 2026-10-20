import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, loadConfig } from '@quizparty/realtime';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import {
  DEFAULT_RETENTION,
  RetentionJob,
  type RetentionPolicy,
} from '../../apps/realtime/src/moderation/retention';

/**
 * ADR-0018 retention, docs/PRIVACY.md §3: rows older than the limit go, newer rows stay, and money and
 * accountability records are never touched however old they are.
 */
const DAY = 86_400_000;
const NOW = Date.UTC(2027, 3, 1, 12);
const clock = { now: () => NOW };
const ago = (ms: number) => new Date(NOW - ms);

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await sql`TRUNCATE email_otps, account_sessions, security_events, telemetry_events, rooms,
    purchase_transactions, entitlements, store_notifications, accounts CASCADE`.execute(t.db);
});

const codes = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD', 'EEEEEE', 'FFFFFF'];
let codeIndex = 0;

async function seedRoom(closedAt: Date | null): Promise<string> {
  const id = randomUUID();
  const code = codes[codeIndex++ % codes.length]!;
  await sql`INSERT INTO rooms (id, code, status, created_at, closed_at)
    VALUES (${id}, ${code}, ${closedAt ? 'CLOSED' : 'ACTIVE'}, ${ago(400 * DAY)}, ${closedAt})`.execute(
    t.db,
  );
  await sql`INSERT INTO room_events (room_id, seq, at, input) VALUES (${id}, 1, 0, '{}')`.execute(
    t.db,
  );
  await sql`INSERT INTO room_sessions (id, room_id, role, token_hash)
    VALUES (${randomUUID()}, ${id}, 'DISPLAY', ${randomUUID()})`.execute(t.db);
  const gameId = randomUUID();
  await sql`INSERT INTO games (id, room_id, started_at, total_rounds, config_version, player_count)
    VALUES (${gameId}, ${id}, ${ago(400 * DAY)}, 1, 1, 1)`.execute(t.db);
  await sql`INSERT INTO game_players (game_id, player_id) VALUES (${gameId}, 'p1')`.execute(t.db);
  return id;
}

async function seedAccount(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO accounts (id, email, created_at) VALUES (${id}, ${`${id}@example.com`}, ${ago(900 * DAY)})`.execute(
    t.db,
  );
  return id;
}

async function seedOperational(policy: RetentionPolicy) {
  const account = await seedAccount();
  const old = (days: number) => ago(days * DAY + 60_000);
  const fresh = (days: number) => ago(days * DAY - 60_000);
  for (const [at, tag] of [
    [ago(policy.otpHours * 3_600_000 + 60_000), 'old'],
    [ago(policy.otpHours * 3_600_000 - 60_000), 'new'],
  ] as const)
    await sql`INSERT INTO email_otps (email_hash, code_hash, purpose, created_at, expires_at)
      VALUES (${tag}, ${tag}, 'LOGIN', ${at}, ${at})`.execute(t.db);
  const session = (tag: string, expires: Date, revoked: Date | null) =>
    sql`INSERT INTO account_sessions (account_id, token_hash, kind, expires_at, revoked_at)
      VALUES (${account}, ${tag}, 'WEB', ${expires}, ${revoked})`.execute(t.db);
  await session('expired-long-ago', old(policy.accountSessionDays), null);
  await session('revoked-long-ago', new Date(NOW + 20 * DAY), old(policy.accountSessionDays));
  await session('expired-recently', fresh(policy.accountSessionDays), null);
  await session('live', new Date(NOW + 20 * DAY), null);
  for (const [at, kind] of [
    [old(policy.securityEventDays), 'old'],
    [fresh(policy.securityEventDays), 'new'],
  ] as const)
    await sql`INSERT INTO security_events (at, kind) VALUES (${at}, ${kind})`.execute(t.db);
  for (const [at, name] of [
    [old(policy.telemetryDays), 'old'],
    [fresh(policy.telemetryDays), 'new'],
  ] as const)
    await sql`INSERT INTO telemetry_events (at, name) VALUES (${at}, ${name})`.execute(t.db);
  return {
    account,
    oldRoom: await seedRoom(old(policy.closedRoomDays)),
    recentRoom: await seedRoom(fresh(policy.closedRoomDays)),
    // open for a year (a crashed instance's room): never deleted by retention, recovery owns it
    openRoom: await seedRoom(null),
  };
}

/** Purchases, entitlements, store notifications and staff audit rows from years ago. */
async function seedMoneyAndAudit(account: string) {
  const longAgo = ago(3 * 365 * DAY);
  const purchase = randomUUID();
  await sql`INSERT INTO purchase_transactions (id, platform, product_id, external_transaction_id, account_id,
      status, environment, created_at, updated_at)
    VALUES (${purchase}, 'IOS', 'full', 'tx-1', ${account}, 'VERIFIED', 'PRODUCTION', ${longAgo}, ${longAgo})`.execute(
    t.db,
  );
  await sql`INSERT INTO purchase_transactions (platform, product_id, external_transaction_id, former_account_ref,
      status, environment, created_at, updated_at)
    VALUES ('ANDROID', 'full', 'tx-2', 'tombstone', 'REFUNDED', 'PRODUCTION', ${longAgo}, ${longAgo})`.execute(
    t.db,
  );
  await sql`INSERT INTO entitlements (account_id, product, platform, source_transaction_id, granted_at)
    VALUES (${account}, 'full', 'IOS', ${purchase}, ${longAgo})`.execute(t.db);
  await sql`INSERT INTO store_notifications (platform, notification_id, received_at)
    VALUES ('IOS', 'n-1', ${longAgo})`.execute(t.db);
  await sql`INSERT INTO admin_audit (at, action, target_type) VALUES (${longAgo}, 'test.retention', 'test')`.execute(
    t.db,
  );
  // The venue time ledger (ADR-0024, migration 0009) is accountability data too; it has no foreign key
  // to rooms, so purging a closed room cannot cascade into it.
  if (await hasTable('venue_session_events')) {
    const venue = randomUUID();
    const session = randomUUID();
    await sql`INSERT INTO venues (id, name, created_at) VALUES (${venue}, 'Kafe', ${longAgo})`.execute(
      t.db,
    );
    await sql`INSERT INTO venue_sessions (id, venue_id, room_id, room_code, purchased_seconds, started_at,
        ended_at, state)
      VALUES (${session}, ${venue}, ${randomUUID()}, 'AAAAAA', 3600, ${longAgo}, ${longAgo}, 'ENDED')`.execute(
      t.db,
    );
    await sql`INSERT INTO venue_session_events (session_id, venue_id, kind, seconds, at)
      VALUES (${session}, ${venue}, 'OPEN', 3600, ${longAgo})`.execute(t.db);
  }
}

const hasTable = async (name: string) =>
  (await sql<{ r: string | null }>`SELECT to_regclass(${name})::text AS r`.execute(t.db)).rows[0]!
    .r !== null;

const count = async (table: string, where = sql`true`) =>
  Number(
    (
      await sql<{
        n: string;
      }>`SELECT count(*) AS n FROM ${sql.table(table)} WHERE ${where}`.execute(t.db)
    ).rows[0]!.n,
  );

describe('retention job (ADR-0018)', () => {
  it('deletes rows older than each limit and keeps newer ones', async () => {
    const seeded = await seedOperational(DEFAULT_RETENTION);
    const report = await new RetentionJob(t.db, clock, DEFAULT_RETENTION).run();
    expect(report).toEqual({
      emailOtps: 1,
      accountSessions: 2,
      securityEvents: 1,
      telemetryEvents: 1,
      closedRooms: 1,
    });
    expect(await count('email_otps', sql`email_hash = 'old'`)).toBe(0);
    expect(await count('email_otps', sql`email_hash = 'new'`)).toBe(1);
    const sessions = await sql<{
      token_hash: string;
    }>`SELECT token_hash FROM account_sessions ORDER BY token_hash`.execute(t.db);
    expect(sessions.rows.map((r) => r.token_hash)).toEqual(['expired-recently', 'live']);
    expect(await count('security_events', sql`kind = 'old'`)).toBe(0);
    expect(await count('security_events', sql`kind = 'new'`)).toBe(1);
    expect(await count('telemetry_events', sql`name = 'old'`)).toBe(0);
    expect(await count('telemetry_events', sql`name = 'new'`)).toBe(1);
    // the old closed room goes with everything that hangs off it
    expect(await count('rooms', sql`id = ${seeded.oldRoom}`)).toBe(0);
    for (const table of ['room_events', 'room_sessions', 'games'])
      expect(await count(table, sql`room_id = ${seeded.oldRoom}`)).toBe(0);
    for (const room of [seeded.recentRoom, seeded.openRoom]) {
      expect(await count('rooms', sql`id = ${room}`)).toBe(1);
      expect(await count('room_events', sql`room_id = ${room}`)).toBe(1);
      expect(await count('games', sql`room_id = ${room}`)).toBe(1);
    }
    expect(await count('game_players')).toBe(2);
    // a second pass has nothing left to do
    expect(Object.values(await new RetentionJob(t.db, clock).run())).toEqual([0, 0, 0, 0, 0]);
  });

  it('never deletes purchases, entitlements, store notifications or the admin audit', async () => {
    const account = await seedAccount();
    await seedMoneyAndAudit(account);
    const auditBefore = await count('admin_audit');
    // the most aggressive policy the configuration accepts
    const tightest: RetentionPolicy = {
      otpHours: 1,
      accountSessionDays: 1,
      securityEventDays: 1,
      telemetryDays: 1,
      closedRoomDays: 1,
    };
    await new RetentionJob(t.db, { now: () => NOW + 10 * 365 * DAY }, tightest).run();
    expect(await count('purchase_transactions')).toBe(2);
    expect(await count('entitlements')).toBe(1);
    expect(await count('store_notifications')).toBe(1);
    expect(await count('admin_audit')).toBe(auditBefore);
    expect(await count('accounts', sql`id = ${account}`)).toBe(1);
    if (await hasTable('venue_session_events')) {
      expect(await count('venue_sessions')).toBeGreaterThanOrEqual(1);
      expect(await count('venue_session_events')).toBeGreaterThanOrEqual(1);
    }
  });

  it('deletes large backlogs in slices', async () => {
    await sql`INSERT INTO telemetry_events (at, name)
      SELECT ${ago(400 * DAY)}, 'bulk' FROM generate_series(1, 12001)`.execute(t.db);
    const report = await new RetentionJob(t.db, clock).run();
    expect(report.telemetryEvents).toBe(12001);
    expect(await count('telemetry_events')).toBe(0);
  });
});

describe('retention is scheduled on the maintenance runner', () => {
  it('runs with the configured periods when the maintenance pass runs', async () => {
    const env = {
      NODE_ENV: 'test',
      DATABASE_URL: t.url,
      INSTANCE_ID: 'retention-test',
      RETENTION_OTP_HOURS: '48',
      RETENTION_ACCOUNT_SESSION_DAYS: '14',
      RETENTION_SECURITY_EVENT_DAYS: '90',
      RETENTION_TELEMETRY_DAYS: '60',
      RETENTION_CLOSED_ROOM_DAYS: '10',
    };
    const config = loadConfig(env);
    expect(config.retention).toEqual({
      otpHours: 48,
      accountSessionDays: 14,
      securityEventDays: 90,
      telemetryDays: 60,
      closedRoomDays: 10,
    });
    expect(loadConfig({ NODE_ENV: 'test' }).retention).toEqual(DEFAULT_RETENTION);
    expect(() => loadConfig({ NODE_ENV: 'test', RETENTION_CLOSED_ROOM_DAYS: '0' })).toThrow(
      /RETENTION_CLOSED_ROOM_DAYS/,
    );

    const seeded = await seedOperational(config.retention);
    await seedMoneyAndAudit(seeded.account);
    // the hand-made open room has no replayable log; boot-time recovery is not what is tested here
    await sql`DELETE FROM rooms WHERE id = ${seeded.openRoom}`.execute(t.db);
    const built = await buildApp({ config, clock });
    try {
      await built.maintenance.runOnce();
    } finally {
      await built.close();
    }
    expect(await count('email_otps')).toBe(1);
    expect(await count('account_sessions')).toBe(2);
    expect(await count('security_events', sql`kind = 'old'`)).toBe(0);
    expect(await count('telemetry_events', sql`name = 'old'`)).toBe(0);
    expect(await count('rooms', sql`id = ${seeded.oldRoom}`)).toBe(0);
    expect(await count('rooms', sql`id = ${seeded.recentRoom}`)).toBe(1);
    expect(await count('purchase_transactions')).toBe(2);
    expect(await count('entitlements')).toBe(1);
  });
});
