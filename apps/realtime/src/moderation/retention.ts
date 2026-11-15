import { sql, type RawBuilder } from 'kysely';
import type { Database } from '@quizparty/db';
import type { Clock } from '../util/clock';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * How long each kind of operational record is kept (ADR-0018 "Retention", docs/PRIVACY.md §3). Every
 * value is an env override in config.ts; the defaults are the ADR's numbers.
 */
export interface RetentionPolicy {
  /** Sign-in code rows (hashes only); a code is dead after 10 minutes anyway. */
  otpHours: number;
  /** Account sessions past their expiry or revocation. */
  accountSessionDays: number;
  securityEventDays: number;
  telemetryDays: number;
  /** Closed rooms with their input log, sessions and game records (cascade, migration 0001). */
  closedRoomDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  otpHours: 24,
  accountSessionDays: 7,
  securityEventDays: 180,
  telemetryDays: 180,
  closedRoomDays: 30,
};

export interface RetentionReport {
  emailOtps: number;
  accountSessions: number;
  securityEvents: number;
  telemetryEvents: number;
  closedRooms: number;
}

/** Big tables are deleted in slices so one pass never holds a long lock or a huge transaction. */
const BATCH = 5_000;

/**
 * Deletes operational records past their retention period. It touches only the five tables below:
 * money and accountability records (`purchase_transactions`, `entitlements`, `store_notifications`,
 * `admin_audit`) are deliberately out of its reach, and the integration test `retention` proves it.
 * Personal quizzes have their own job (`QuizService.purgeExpired`, ADR-0015).
 */
export class RetentionJob {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly policy: RetentionPolicy = DEFAULT_RETENTION,
  ) {}

  async run(): Promise<RetentionReport> {
    const now = this.clock.now();
    const before = (ms: number) => new Date(now - ms);
    const p = this.policy;

    const emailOtps = await this.db
      .deleteFrom('email_otps')
      .where('created_at', '<', before(p.otpHours * HOUR))
      .executeTakeFirst();
    const sessionCutoff = before(p.accountSessionDays * DAY);
    const accountSessions = await this.db
      .deleteFrom('account_sessions')
      .where((eb) =>
        eb.or([eb('expires_at', '<', sessionCutoff), eb('revoked_at', '<', sessionCutoff)]),
      )
      .executeTakeFirst();

    return {
      emailOtps: Number(emailOtps.numDeletedRows),
      accountSessions: Number(accountSessions.numDeletedRows),
      securityEvents: await this.sliced(
        (limit) => sql<{ n: number }>`
          WITH gone AS (
            DELETE FROM security_events WHERE id IN (
              SELECT id FROM security_events WHERE at < ${before(p.securityEventDays * DAY)} LIMIT ${limit})
            RETURNING 1)
          SELECT count(*)::int AS n FROM gone`,
      ),
      telemetryEvents: await this.sliced(
        (limit) => sql<{ n: number }>`
          WITH gone AS (
            DELETE FROM telemetry_events WHERE id IN (
              SELECT id FROM telemetry_events WHERE at < ${before(p.telemetryDays * DAY)} LIMIT ${limit})
            RETURNING 1)
          SELECT count(*)::int AS n FROM gone`,
      ),
      // Only CLOSED rooms: an open room may still be recovered by another instance (ADR-0003).
      closedRooms: await this.sliced(
        (limit) => sql<{ n: number }>`
          WITH gone AS (
            DELETE FROM rooms WHERE id IN (
              SELECT id FROM rooms WHERE status = 'CLOSED' AND closed_at < ${before(p.closedRoomDays * DAY)}
              LIMIT ${limit})
            RETURNING 1)
          SELECT count(*)::int AS n FROM gone`,
        200, // a room cascades into its whole input log and game records
      ),
    };
  }

  private async sliced(
    statement: (limit: number) => RawBuilder<{ n: number }>,
    limit = BATCH,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const result = await statement(limit).execute(this.db);
      const n = result.rows[0]?.n ?? 0;
      total += n;
      if (n < limit) return total;
    }
  }
}
