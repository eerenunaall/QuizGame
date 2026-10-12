import { randomBytes } from 'node:crypto';
import type { Database } from '@quizparty/db';
import { hmacHex } from '../security/crypto';
import type { Clock } from '../util/clock';

export const LINK_TTL_MS = 10 * 60_000;
export const MAX_OPEN_LINKS_PER_ROOM = 5;

/**
 * One-time links that tie a phone owner's entitlement to a TV room (ADR-0013, flow A). The QR code
 * carries a random 128-bit token and nothing else. The token has no authority of its own: using it
 * needs a signed-in account, and all it can do is attach *that account's* entitlement to the room.
 * Only a keyed hash of it is stored.
 */
export class LinkService {
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly secret: string;
  private readonly publicWebUrl: string;

  constructor(deps: { db: Database; clock: Clock; secret: string; publicWebUrl: string }) {
    this.db = deps.db;
    this.clock = deps.clock;
    this.secret = deps.secret;
    this.publicWebUrl = deps.publicWebUrl;
  }

  private hash(token: string): string {
    return hmacHex(this.secret, 'link-intent', token);
  }

  /** A new link for a room, or null when it already has the maximum of open ones. */
  async create(roomId: string): Promise<{ url: string; expiresAt: number } | null> {
    const now = new Date(this.clock.now());
    return this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('link_intents')
        .where('room_id', '=', roomId)
        .where((eb) => eb.or([eb('expires_at', '<', now), eb('status', '!=', 'OPEN')]))
        .execute();
      const open = await trx
        .selectFrom('link_intents')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('room_id', '=', roomId)
        .executeTakeFirstOrThrow();
      if (Number(open.n) >= MAX_OPEN_LINKS_PER_ROOM) return null;
      const token = randomBytes(16).toString('base64url');
      const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
      await trx
        .insertInto('link_intents')
        .values({ room_id: roomId, token_hash: this.hash(token), expires_at: expiresAt })
        .execute();
      return { url: `${this.publicWebUrl}/unlock/${token}`, expiresAt: expiresAt.getTime() };
    });
  }

  /** What an unlock page may learn from a link: which room it belongs to, and nothing if it is not usable. */
  async peek(token: string): Promise<{ roomId: string } | null> {
    const row = await this.db
      .selectFrom('link_intents')
      .select(['room_id', 'status', 'expires_at'])
      .where('token_hash', '=', this.hash(token))
      .executeTakeFirst();
    if (!row || row.status !== 'OPEN' || row.expires_at.getTime() <= this.clock.now()) return null;
    return { roomId: row.room_id };
  }

  /** Spends the link for `accountId`. Null when it is unknown, used, cancelled or expired (all alike). */
  async claim(token: string, accountId: string): Promise<{ roomId: string } | null> {
    const now = new Date(this.clock.now());
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('link_intents')
        .select(['id', 'room_id', 'status', 'expires_at'])
        .where('token_hash', '=', this.hash(token))
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.status !== 'OPEN' || row.expires_at.getTime() <= now.getTime()) return null;
      await trx
        .updateTable('link_intents')
        .set({ status: 'CLAIMED', claimed_by: accountId, claimed_at: now })
        .where('id', '=', row.id)
        .execute();
      return { roomId: row.room_id };
    });
  }
}
