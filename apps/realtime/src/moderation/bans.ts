import { sql } from 'kysely';
import type { Database } from '@quizparty/db';

export interface BanSubjects {
  /** Keyed pseudonym of the client address (the same one rate limits use). */
  ip?: string;
  /** Keyed pseudonym of the device id (global, not scoped to a room). */
  device?: string;
  /** Account id. */
  account?: string;
}

/**
 * Bans placed in the admin console (GDD §23). Subjects are pseudonyms or ids, never addresses. A ban
 * is open until it is lifted or expires. Checked when a room is created and when a player joins, and
 * again when a session reconnects (the admin console also revokes the sessions it knows of).
 */
export class BanService {
  constructor(private readonly db: Database) {}

  async isBanned(subjects: BanSubjects): Promise<boolean> {
    const pairs: [string, string][] = [];
    if (subjects.ip) pairs.push(['IP', subjects.ip]);
    if (subjects.device) pairs.push(['DEVICE', subjects.device]);
    if (subjects.account) pairs.push(['ACCOUNT', subjects.account]);
    if (pairs.length === 0) return false;
    const row = await this.db
      .selectFrom('bans')
      .select('id')
      .where('lifted_at', 'is', null)
      .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql<Date>`now()`)]))
      .where((eb) =>
        eb.or(
          pairs.map(([kind, hash]) =>
            eb.and([eb('kind', '=', kind), eb('subject_hash', '=', hash)]),
          ),
        ),
      )
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }
}
