import { randomToken } from '@quizparty/shared';
import type { Database } from '@quizparty/db';
import type { LiveRoom } from '../rooms/live-room';
import type { RoomManager } from '../rooms/manager';
import { hmacHex } from '../security/crypto';
import type { Clock } from '../util/clock';
import { newPairingCode, parsePairingCode } from './display-codes';
import { VenueError, type SessionView, type VenueService } from './service';

/** ADR-0028 §2–4. Every number here is part of the security argument in the ADR; change both together. */
export const PAIRING_TTL_MS = 5 * 60_000;
export const MAX_LIVE_PAIRINGS = 500;
/** A credential older than this is offered a successor on its next use. */
export const ROTATE_AFTER_MS = 60 * 60_000;
/** After a promotion the previous credential still works this long (requests already in flight). */
export const PREVIOUS_GRACE_MS = 30_000;
/** A credential unused this long is dead. */
export const IDLE_EXPIRY_MS = 180 * 86_400_000;
export const ONLINE_WINDOW_MS = 15_000;
const LAST_SEEN_WRITE_MS = 60_000;
/** A room handed to a TV that never collects it is forgotten after this. */
const DELIVERY_TTL_MS = 2 * 60_000;
const ATTACHABLE_PHASES = new Set(['WAITING', 'LOBBY', 'RESULTS']);

export interface DisplayIdentity {
  id: string;
  venueId: string;
  name: string;
}

export interface DisplayView {
  id: string;
  name: string;
  pairedAt: number;
  lastSeenAt: number | null;
  online: boolean;
  /** The code of the live room this TV shows, if any (what the panel needs to recognise it). */
  roomCode: string | null;
}

export interface AdminDisplayView extends DisplayView {
  revokedAt: number | null;
  revokeReason: string | null;
}

/** What the TV collects on its next poll after the panel opened a game on it: its own display session. */
export interface DisplayDelivery {
  roomId: string;
  code: string;
  joinUrl: string;
  display: { sessionId: string; reconnectToken: string };
}

export type AuthOutcome =
  { kind: 'OK'; display: DisplayIdentity; rotateTo: string | null } | { kind: 'NONE' };

export interface DisplayDeps {
  db: Database;
  clock: Clock;
  secret: string;
  manager: RoomManager;
  venues: VenueService;
  publicWebUrl: string;
  defaultTier: 'FREE' | 'FULL';
  onSecurity: (kind: string, detail: Record<string, string | number | boolean>) => void;
  onError: (error: unknown) => void;
}

/**
 * Venue displays (ADR-0028): pairing a café's TV from its panel, the TV's long-lived credential (hashed,
 * rotated, revocable, limited by the venue's seats) and the panel's "open a game on this TV". The
 * credential is checked here; the routes only move cookies.
 */
export class VenueDisplays {
  private readonly lastSeen = new Map<string, number>();
  private readonly lastWritten = new Map<string, number>();
  /** display id → the room it last created or was handed (single instance, ADR-0024 consequences). */
  private readonly rooms = new Map<string, string>();
  private readonly deliveries = new Map<string, { delivery: DisplayDelivery; at: number }>();

  constructor(private readonly deps: DisplayDeps) {}

  private now(): number {
    return this.deps.clock.now();
  }

  private hash(scope: string, value: string): string {
    return hmacHex(this.deps.secret, scope, value);
  }

  private tokenHash(token: string): string {
    return this.hash('venue-display', token);
  }

  // ───────────── pairing ─────────────

  /** A TV asks for a code. The secret goes to that browser alone (cookie) and is what collects the result. */
  async startPairing(): Promise<{ code: string; secret: string; expiresAt: number }> {
    const now = this.now();
    await this.deps.db
      .deleteFrom('venue_display_pairings')
      .where('expires_at', '<', new Date(now - 86_400_000))
      .execute();
    const live = await this.deps.db
      .selectFrom('venue_display_pairings')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('claimed_at', 'is', null)
      .where('expires_at', '>', new Date(now))
      .executeTakeFirstOrThrow();
    // The guessing bound in the ADR assumes at most this many live codes.
    if (Number(live.n) >= MAX_LIVE_PAIRINGS) throw new VenueError(429, 'RATE_LIMITED');
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newPairingCode();
      const secret = randomToken();
      const expiresAt = now + PAIRING_TTL_MS;
      const inserted = await this.deps.db
        .insertInto('venue_display_pairings')
        .values({
          code_hash: this.hash('venue-pairing-code', code),
          secret_hash: this.hash('venue-pairing-secret', secret),
          created_at: new Date(now),
          expires_at: new Date(expiresAt),
        })
        .onConflict((conflict) => conflict.doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted) return { code, secret, expiresAt };
    }
    throw new Error('could not allocate a pairing code');
  }

  /**
   * The TV that holds the pairing secret asks how its pairing stands. Once an owner claimed the code the
   * TV receives its credential, exactly once. Unknown, expired and collected pairings are all `null`.
   */
  async collectPairing(
    secret: string,
  ): Promise<{ state: 'WAITING'; expiresAt: number } | { state: 'PAIRED'; token: string } | null> {
    if (secret.length < 20 || secret.length > 128) return null;
    const now = this.now();
    return this.deps.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('venue_display_pairings')
        .select(['id', 'expires_at', 'claimed_at', 'display_id', 'collected_at'])
        .where('secret_hash', '=', this.hash('venue-pairing-secret', secret))
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.collected_at) return null;
      if (!row.claimed_at || !row.display_id) {
        if (row.expires_at.getTime() <= now) return null;
        return { state: 'WAITING' as const, expiresAt: row.expires_at.getTime() };
      }
      const token = randomToken();
      const updated = await trx
        .updateTable('venue_displays')
        .set({ token_hash: this.tokenHash(token), rotated_at: new Date(now) })
        .where('id', '=', row.display_id)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      await trx
        .updateTable('venue_display_pairings')
        .set({ collected_at: new Date(now) })
        .where('id', '=', row.id)
        .execute();
      if (Number(updated.numUpdatedRows) === 0) return null; // revoked before it was collected
      this.seen(row.display_id, now);
      return { state: 'PAIRED' as const, token };
    });
  }

  /**
   * The owner claims a code shown on a TV. Seats are counted under a lock on the venue row, so two
   * claims at once cannot pair more TVs than the licence allows.
   */
  async claim(
    venueId: string,
    accountId: string,
    input: string,
    name: string,
  ): Promise<DisplayView> {
    const code = parsePairingCode(input);
    if (!code) throw new VenueError(404, 'NOT_FOUND');
    const now = this.now();
    const display = await this.deps.db.transaction().execute(async (trx) => {
      const pairing = await trx
        .selectFrom('venue_display_pairings')
        .select(['id'])
        .where('code_hash', '=', this.hash('venue-pairing-code', code))
        .where('claimed_at', 'is', null)
        .where('expires_at', '>', new Date(now))
        .forUpdate()
        .executeTakeFirst();
      if (!pairing) throw new VenueError(404, 'NOT_FOUND');
      const venue = await trx
        .selectFrom('venues')
        .select(['display_seats'])
        .where('id', '=', venueId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const active = await trx
        .selectFrom('venue_displays')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('venue_id', '=', venueId)
        .where('revoked_at', 'is', null)
        .executeTakeFirstOrThrow();
      if (Number(active.n) >= venue.display_seats)
        throw new VenueError(409, 'LIMIT_REACHED', { seats: venue.display_seats });
      const inserted = await trx
        .insertInto('venue_displays')
        .values({
          venue_id: venueId,
          name,
          paired_by: accountId,
          paired_at: new Date(now),
          // Replaced by the real credential's hash when the TV collects it; this one is never known.
          token_hash: this.tokenHash(randomToken()),
          rotated_at: new Date(now),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('venue_display_pairings')
        .set({
          claimed_at: new Date(now),
          claimed_venue_id: venueId,
          claimed_by: accountId,
          display_id: inserted.id,
        })
        .where('id', '=', pairing.id)
        .execute();
      return inserted;
    });
    return this.view(display, now);
  }

  // ───────────── the credential ─────────────

  /**
   * Resolves a presented credential. Rotation (ADR-0028 §3): an old enough credential gets a pending
   * successor (returned as `rotateTo`, for the cookie); presenting the successor promotes it; presenting
   * the predecessor after the grace means a copy exists, and the display is revoked.
   */
  async authenticate(token: string | null): Promise<AuthOutcome> {
    if (!token || token.length < 20 || token.length > 128) return { kind: 'NONE' };
    const presented = this.tokenHash(token);
    const now = this.now();
    const row = await this.deps.db
      .selectFrom('venue_displays')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb('token_hash', '=', presented),
          eb('pending_token_hash', '=', presented),
          eb('previous_token_hash', '=', presented),
        ]),
      )
      .executeTakeFirst();
    if (!row || row.revoked_at) return { kind: 'NONE' };
    const lastUse = Math.max(row.last_seen_at?.getTime() ?? 0, row.rotated_at.getTime());
    if (now - lastUse > IDLE_EXPIRY_MS) return { kind: 'NONE' };
    const identity = { id: row.id, venueId: row.venue_id, name: row.name };

    if (row.pending_token_hash === presented) {
      await this.deps.db
        .updateTable('venue_displays')
        .set({
          previous_token_hash: row.token_hash,
          token_hash: presented,
          pending_token_hash: null,
          rotated_at: new Date(now),
        })
        .where('id', '=', row.id)
        .where('pending_token_hash', '=', presented)
        .execute();
      this.seen(row.id, now);
      return { kind: 'OK', display: identity, rotateTo: null };
    }
    if (row.token_hash !== presented) {
      // The predecessor of the current credential.
      if (now - row.rotated_at.getTime() <= PREVIOUS_GRACE_MS)
        return { kind: 'OK', display: identity, rotateTo: null };
      await this.revokeRow(row.id, null, 'REUSE');
      this.deps.onSecurity('DISPLAY_TOKEN_REUSE', { venue: row.venue_id });
      return { kind: 'NONE' };
    }
    this.seen(row.id, now);
    if (now - row.rotated_at.getTime() < ROTATE_AFTER_MS)
      return { kind: 'OK', display: identity, rotateTo: null };
    // Old enough: offer a successor (again, if an earlier offer's response was lost).
    const next = randomToken();
    await this.deps.db
      .updateTable('venue_displays')
      .set({ pending_token_hash: this.tokenHash(next) })
      .where('id', '=', row.id)
      .where('token_hash', '=', presented)
      .execute();
    return { kind: 'OK', display: identity, rotateTo: next };
  }

  private seen(displayId: string, now: number): void {
    this.lastSeen.set(displayId, now);
    if (now - (this.lastWritten.get(displayId) ?? 0) < LAST_SEEN_WRITE_MS) return;
    this.lastWritten.set(displayId, now);
    void this.deps.db
      .updateTable('venue_displays')
      .set({ last_seen_at: new Date(now) })
      .where('id', '=', displayId)
      .execute()
      .catch(this.deps.onError);
  }

  private lastSeenOf(row: { id: string; last_seen_at: Date | null }): number | null {
    return this.lastSeen.get(row.id) ?? row.last_seen_at?.getTime() ?? null;
  }

  private liveRoomOf(displayId: string): LiveRoom | undefined {
    const roomId = this.rooms.get(displayId);
    const room = roomId ? this.deps.manager.get(roomId) : undefined;
    return room && !room.isClosing() && !room.isLost() ? room : undefined;
  }

  private view(
    row: { id: string; name: string; paired_at: Date; last_seen_at: Date | null },
    now: number,
  ): DisplayView {
    const lastSeenAt = this.lastSeenOf(row);
    return {
      id: row.id,
      name: row.name,
      pairedAt: row.paired_at.getTime(),
      lastSeenAt,
      online: lastSeenAt !== null && now - lastSeenAt <= ONLINE_WINDOW_MS,
      roomCode: this.liveRoomOf(row.id)?.code ?? null,
    };
  }

  // ───────────── rooms ─────────────

  /** A room the display created itself (POST /v1/rooms with its credential). */
  roomCreated(displayId: string, roomId: string): void {
    this.rooms.set(displayId, roomId);
  }

  /** Taken once by the TV's poll. */
  takeDelivery(displayId: string): DisplayDelivery | null {
    const entry = this.deliveries.get(displayId);
    if (!entry) return null;
    this.deliveries.delete(displayId);
    return this.now() - entry.at <= DELIVERY_TTL_MS ? entry.delivery : null;
  }

  private async activeRow(venueId: string, displayId: string) {
    const row = await this.deps.db
      .selectFrom('venue_displays')
      .selectAll()
      .where('id', '=', displayId)
      // A display of another venue is simply unknown here (no cross-venue oracle).
      .where('venue_id', '=', venueId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw new VenueError(404, 'NOT_FOUND');
    return row;
  }

  /**
   * "Bu TV'de oyun aç" (ADR-0028 §4): use the TV's own live room when it can take a table, otherwise make
   * a new room for that TV and hand it over on its next poll. With minutes, a metered table opens on it.
   */
  async openGame(
    venueId: string,
    displayId: string,
    staffId: string,
    minutes: number | null,
  ): Promise<{ roomCode: string; table: SessionView | null; created: boolean }> {
    const row = await this.activeRow(venueId, displayId);
    const now = this.now();
    const seen = this.lastSeenOf(row);
    if (seen === null || now - seen > ONLINE_WINDOW_MS)
      throw new VenueError(409, 'INVALID_STATE', { reason: 'offline' });
    let room = this.liveRoomOf(displayId);
    let created = false;
    if (room && !ATTACHABLE_PHASES.has(room.state.phase))
      throw new VenueError(409, 'GAME_IN_PROGRESS');
    if (!room) {
      const made = await this.deps.manager.createRoom({
        tier: this.deps.defaultTier,
        language: 'tr',
        clientKind: 'DISPLAY',
      });
      room = made.room;
      created = true;
      this.rooms.set(displayId, room.id);
      this.deliveries.set(displayId, {
        at: now,
        delivery: {
          roomId: room.id,
          code: room.code,
          joinUrl: `${this.deps.publicWebUrl}/join/${room.code}`,
          display: { sessionId: made.displaySessionId, reconnectToken: made.displayToken },
        },
      });
    }
    const table =
      minutes === null
        ? null
        : await this.deps.venues.open(venueId, staffId, minutes, { roomCode: room.code });
    return { roomCode: room.code, table, created };
  }

  // ───────────── listing, revoking, seats ─────────────

  async list(venueId: string): Promise<{ items: DisplayView[]; seats: number }> {
    const now = this.now();
    const [rows, venue] = await Promise.all([
      this.deps.db
        .selectFrom('venue_displays')
        .selectAll()
        .where('venue_id', '=', venueId)
        .where('revoked_at', 'is', null)
        .orderBy('paired_at')
        .execute(),
      this.deps.db
        .selectFrom('venues')
        .select('display_seats')
        .where('id', '=', venueId)
        .executeTakeFirstOrThrow(),
    ]);
    return { items: rows.map((row) => this.view(row, now)), seats: venue.display_seats };
  }

  /** Everything an administrator sees, revoked ones included (newest first). */
  async adminList(venueId: string): Promise<{ items: AdminDisplayView[]; seats: number } | null> {
    const venue = await this.deps.db
      .selectFrom('venues')
      .select('display_seats')
      .where('id', '=', venueId)
      .executeTakeFirst();
    if (!venue) return null;
    const now = this.now();
    const rows = await this.deps.db
      .selectFrom('venue_displays')
      .selectAll()
      .where('venue_id', '=', venueId)
      .orderBy('paired_at', 'desc')
      .limit(100)
      .execute();
    return {
      seats: venue.display_seats,
      items: rows.map((row) => ({
        ...this.view(row, now),
        revokedAt: row.revoked_at?.getTime() ?? null,
        revokeReason: row.revoke_reason,
      })),
    };
  }

  async revoke(venueId: string, displayId: string, actorId: string, reason: 'OWNER' | 'ADMIN') {
    await this.activeRow(venueId, displayId);
    await this.revokeRow(displayId, actorId, reason);
  }

  /** Revokes and lets go of the rooms the display had: the TV is back at the pairing screen at once. */
  private async revokeRow(
    displayId: string,
    actorId: string | null,
    reason: 'OWNER' | 'ADMIN' | 'REUSE',
  ): Promise<void> {
    await this.deps.db
      .updateTable('venue_displays')
      .set({
        revoked_at: new Date(this.now()),
        revoked_by: actorId,
        revoke_reason: reason,
        pending_token_hash: null,
      })
      .where('id', '=', displayId)
      .where('revoked_at', 'is', null)
      .execute();
    this.deliveries.delete(displayId);
    const room = this.liveRoomOf(displayId);
    this.rooms.delete(displayId);
    if (room) await room.closeByAdmin().catch(this.deps.onError);
  }

  async setSeats(venueId: string, seats: number): Promise<boolean> {
    const result = await this.deps.db
      .updateTable('venues')
      .set({ display_seats: seats })
      .where('id', '=', venueId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }
}
