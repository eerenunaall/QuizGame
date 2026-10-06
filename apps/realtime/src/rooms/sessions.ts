import { randomUuid, randomToken } from '@quizparty/shared';
import type { Database } from '@quizparty/db';
import { pseudonym, safeEqualHex, sha256Hex } from '../security/crypto';
import type { Clock } from '../util/clock';

export interface SessionRecord {
  id: string;
  roomId: string;
  role: 'DISPLAY' | 'PLAYER';
  playerId: string | null;
  lastClientSequence: number;
}

export type RotateResult =
  | { kind: 'OK'; session: SessionRecord; token: string }
  /** Unknown, expired, revoked or kicked: the client only learns "cannot reconnect". */
  | { kind: 'INVALID' }
  /** A rotated-out or foreign token was presented: the session has been revoked (ADR-0009). */
  | { kind: 'REUSE'; session: SessionRecord };

export class DeviceAlreadyJoinedError extends Error {
  constructor() {
    super('device already has a live player slot in this room');
  }
}

/** Seconds during which the previous token still works, covering a lost RECONNECTED response. */
const PREVIOUS_TOKEN_GRACE_MS = 10_000;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

/**
 * Room sessions and reconnect tokens (ADR-0009). Tokens are 256-bit random values, stored only as
 * SHA-256 hashes, rotated on every successful reconnect. A token that is neither current nor the
 * previous one (within its grace window) triggers revocation of the session.
 */
export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly secret: string,
    private readonly clock: Clock,
  ) {}

  private toRecord(row: {
    id: string;
    room_id: string;
    role: string;
    player_id: string | null;
    last_client_sequence: number;
  }): SessionRecord {
    return {
      id: row.id,
      roomId: row.room_id,
      role: row.role as SessionRecord['role'],
      playerId: row.player_id,
      lastClientSequence: row.last_client_sequence,
    };
  }

  async createDisplay(
    roomId: string,
    clientKind: string,
    id: string = randomUuid(),
  ): Promise<{ session: SessionRecord; token: string }> {
    const token = randomToken();
    await this.db
      .insertInto('room_sessions')
      .values({
        id,
        room_id: roomId,
        role: 'DISPLAY',
        token_hash: sha256Hex(token),
        client_kind: clientKind,
      })
      .execute();
    return {
      session: { id, roomId, role: 'DISPLAY', playerId: null, lastClientSequence: 0 },
      token,
    };
  }

  async createPlayer(input: {
    roomId: string;
    playerId: string;
    deviceId: string;
    clientKind: string;
  }): Promise<{ session: SessionRecord; token: string }> {
    const id = randomUuid();
    const token = randomToken();
    try {
      await this.db
        .insertInto('room_sessions')
        .values({
          id,
          room_id: input.roomId,
          role: 'PLAYER',
          player_id: input.playerId,
          device_id_hash: pseudonym(this.secret, `device:${input.roomId}`, input.deviceId),
          token_hash: sha256Hex(token),
          client_kind: input.clientKind,
        })
        .execute();
    } catch (error) {
      if (isUniqueViolation(error)) throw new DeviceAlreadyJoinedError();
      throw error;
    }
    return {
      session: {
        id,
        roomId: input.roomId,
        role: 'PLAYER',
        playerId: input.playerId,
        lastClientSequence: 0,
      },
      token,
    };
  }

  /** Validates a presented reconnect token and rotates it atomically. */
  async rotate(sessionId: string, presentedToken: string): Promise<RotateResult> {
    const presented = sha256Hex(presentedToken);
    const now = this.clock.now();
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('room_sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.status !== 'ACTIVE') return { kind: 'INVALID' } as const;

      const isCurrent = safeEqualHex(presented, row.token_hash);
      const isPrevious =
        !isCurrent &&
        row.prev_token_hash !== null &&
        row.prev_valid_until !== null &&
        safeEqualHex(presented, row.prev_token_hash) &&
        row.prev_valid_until.getTime() >= now;

      if (!isCurrent && !isPrevious) {
        await trx
          .updateTable('room_sessions')
          .set({ status: 'REVOKED' })
          .where('id', '=', sessionId)
          .execute();
        await trx
          .insertInto('security_events')
          .values({
            kind: 'RECONNECT_TOKEN_REUSE',
            room_id: row.room_id,
            session_id: row.id,
            detail: JSON.stringify({ role: row.role }),
          })
          .execute();
        return { kind: 'REUSE', session: this.toRecord(row) } as const;
      }

      const token = randomToken();
      await trx
        .updateTable('room_sessions')
        .set({
          token_hash: sha256Hex(token),
          prev_token_hash: row.token_hash,
          prev_valid_until: new Date(now + PREVIOUS_TOKEN_GRACE_MS),
          last_seen_at: new Date(now),
        })
        .where('id', '=', sessionId)
        .execute();
      return { kind: 'OK', session: this.toRecord(row), token } as const;
    });
  }

  async setStatus(
    sessionId: string,
    status: 'REVOKED' | 'KICKED' | 'LEFT' | 'EXPIRED',
  ): Promise<void> {
    await this.db
      .updateTable('room_sessions')
      .set({ status })
      .where('id', '=', sessionId)
      .where('status', '=', 'ACTIVE')
      .execute();
  }

  async remove(sessionId: string): Promise<void> {
    await this.db.deleteFrom('room_sessions').where('id', '=', sessionId).execute();
  }

  async expireRoom(roomId: string): Promise<void> {
    await this.db
      .updateTable('room_sessions')
      .set({ status: 'EXPIRED' })
      .where('room_id', '=', roomId)
      .where('status', '=', 'ACTIVE')
      .execute();
  }

  async load(sessionId: string): Promise<SessionRecord | null> {
    const row = await this.db
      .selectFrom('room_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirst();
    return row ? this.toRecord(row) : null;
  }

  async loadActiveForRoom(roomId: string): Promise<SessionRecord[]> {
    const rows = await this.db
      .selectFrom('room_sessions')
      .selectAll()
      .where('room_id', '=', roomId)
      .where('status', '=', 'ACTIVE')
      .execute();
    return rows.map((row) => this.toRecord(row));
  }

  async persistSequences(entries: { id: string; sequence: number }[]): Promise<void> {
    for (const entry of entries) {
      await this.db
        .updateTable('room_sessions')
        .set({ last_client_sequence: entry.sequence, last_seen_at: new Date(this.clock.now()) })
        .where('id', '=', entry.id)
        .where('last_client_sequence', '<', entry.sequence)
        .execute();
    }
  }
}
