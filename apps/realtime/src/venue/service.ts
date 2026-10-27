import { sql, type Transaction } from 'kysely';
import type { Database } from '@quizparty/db';
import type { DB } from '@quizparty/db';
import {
  endRecord,
  extendRecord,
  meterBlock,
  meterOf,
  pauseRecord,
  remainingMs,
  resumeRecord,
  type MeterRecord,
  type VenueMeter,
} from '@quizparty/game-engine';
import type { ErrorCode, TeamId } from '@quizparty/protocol';
import { parseRoomCode } from '@quizparty/shared';
import type { FeatureFlags } from '../flags/service';
import type { LinkService } from '../payments/links';
import type { LiveRoom } from '../rooms/live-room';
import type { RoomManager } from '../rooms/manager';
import { hmacHex } from '../security/crypto';
import type { Clock } from '../util/clock';
import {
  localDate,
  localDay,
  mergeSettings,
  newRewardCode,
  readSettings,
  type VenueSettings,
  type VenuePatch,
} from './settings';

export const VENUE_FLAG = 'venue.sessions';
export type VenueRole = 'OWNER' | 'STAFF';
type SessionState = 'RUNNING' | 'PAUSED' | 'ENDED';

/** A refusal the routes turn into an HTTP answer (machine code only; the page translates). */
export class VenueError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NOT_FOUND',
    readonly params?: Record<string, string | number>,
  ) {
    super(code);
  }
}

/** The phases in which a TV can be turned into (or handed back as) a metered table. */
const ATTACHABLE_PHASES = new Set(['WAITING', 'LOBBY', 'RESULTS']);
/** Minutes per open or extension, and the most one table may hold in total (staff minutes). */
export const MAX_MINUTES_PER_STEP = 720;
const MAX_PURCHASED_SECONDS = 86_400;
/** setTimeout's ceiling; a timer further out re-arms itself. */
const MAX_TIMER_MS = 2_147_000_000;

interface SessionRow {
  id: string;
  venue_id: string;
  room_id: string;
  room_code: string;
  purchased_seconds: number;
  started_at: Date;
  paused_at: Date | null;
  paused_total_seconds: number;
  ended_at: Date | null;
  state: string;
}

export interface SessionView {
  id: string;
  roomCode: string;
  state: SessionState;
  /** Metered milliseconds left at `serverTime` (staff minutes are scaled only in tests). */
  remainingMs: number;
  endsAt: number | null;
  purchasedMinutes: number;
  startedAt: number;
  timeUp: boolean;
  /** Whether this server still runs the TV room the table is attached to. */
  roomLive: boolean;
}

export interface VenueDeps {
  db: Database;
  clock: Clock;
  manager: RoomManager;
  links: LinkService;
  flags: FeatureFlags;
  secret: string;
  /** Milliseconds in one metered minute (60 000 outside tests, ADR-0024 §10). */
  minuteMs: number;
  onError: (error: unknown) => void;
  onSecurity: (kind: string, detail: Record<string, string | number | boolean>) => void;
}

/**
 * Venue mode (ADR-0024): metered café tables, the staff who run them and the rewards their winners
 * get. The meter's arithmetic is the engine's (`venue.ts`); this service stores the facts, tells the
 * room, keeps one timer per running table and decides rewards. It meters time; it never handles money.
 */
export class VenueService {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pushes = new Map<string, Promise<void>>();
  private sweeper: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly deps: VenueDeps) {}

  enabled(): Promise<boolean> {
    return this.deps.flags.isEnabled(VENUE_FLAG);
  }

  private now(): number {
    return this.deps.clock.now();
  }

  /** Staff seconds ↔ metered milliseconds (identical outside tests). */
  private msOfSeconds(seconds: number): number {
    return (seconds * this.deps.minuteMs) / 60;
  }

  private record(row: SessionRow): MeterRecord {
    return {
      purchasedMs: this.msOfSeconds(row.purchased_seconds),
      startedAt: row.started_at.getTime(),
      pausedAt: row.paused_at ? row.paused_at.getTime() : null,
      pausedTotalMs: row.paused_total_seconds * 1000,
      endedAt: row.ended_at ? row.ended_at.getTime() : null,
    };
  }

  rewardHash(code: string): string {
    return hmacHex(this.deps.secret, 'venue-reward', code);
  }

  // ───────────── membership and settings ─────────────

  async role(accountId: string, venueId: string): Promise<VenueRole | null> {
    const row = await this.deps.db
      .selectFrom('venue_staff')
      .select('role')
      .where('venue_id', '=', venueId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return row ? (row.role as VenueRole) : null;
  }

  async myVenues(accountId: string): Promise<{ id: string; name: string; role: VenueRole }[]> {
    const rows = await this.deps.db
      .selectFrom('venue_staff')
      .innerJoin('venues', 'venues.id', 'venue_staff.venue_id')
      .select(['venues.id as id', 'venues.name as name', 'venue_staff.role as role'])
      .where('venue_staff.account_id', '=', accountId)
      .orderBy('venues.name')
      .execute();
    return rows.map((row) => ({ id: row.id, name: row.name, role: row.role as VenueRole }));
  }

  async settings(venueId: string): Promise<VenueSettings> {
    const row = await this.deps.db
      .selectFrom('venues')
      .select('settings')
      .where('id', '=', venueId)
      .executeTakeFirst();
    if (!row) throw new VenueError(404, 'NOT_FOUND');
    return readSettings(row.settings);
  }

  async updateSettings(venueId: string, patch: VenuePatch): Promise<VenueSettings> {
    const merged = mergeSettings(await this.settings(venueId), patch);
    if (!merged) throw new VenueError(400, 'INVALID_MESSAGE');
    await this.deps.db
      .updateTable('venues')
      .set({ settings: JSON.stringify(merged) })
      .where('id', '=', venueId)
      .execute();
    return merged;
  }

  async staff(
    venueId: string,
  ): Promise<{ accountId: string; email: string | null; role: VenueRole }[]> {
    const rows = await this.deps.db
      .selectFrom('venue_staff')
      .innerJoin('accounts', 'accounts.id', 'venue_staff.account_id')
      .select(['accounts.id as id', 'accounts.email as email', 'venue_staff.role as role'])
      .where('venue_staff.venue_id', '=', venueId)
      .orderBy('venue_staff.role')
      .orderBy('accounts.email')
      .execute();
    return rows.map((row) => ({
      accountId: row.id,
      email: row.email,
      role: row.role as VenueRole,
    }));
  }

  /**
   * Adds a person by email address. The account is created (unverified) when it does not exist; it is
   * usable once that person signs in with a code sent to that very address. No mail is sent here.
   */
  async addStaff(
    venueId: string,
    email: string,
    role: VenueRole,
    addedBy: string | null,
  ): Promise<{ accountId: string }> {
    return this.deps.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('accounts')
        .values({ email, locale: 'tr' })
        .onConflict((conflict) => conflict.column('email').doNothing())
        .execute();
      const account = await trx
        .selectFrom('accounts')
        .select(['id', 'status'])
        .where('email', '=', email)
        .executeTakeFirstOrThrow();
      if (account.status !== 'ACTIVE') throw new VenueError(409, 'INVALID_STATE');
      await trx
        .insertInto('venue_staff')
        .values({ venue_id: venueId, account_id: account.id, role, added_by: addedBy })
        // Adding staff never demotes an owner; making an owner promotes whoever it is.
        .onConflict((conflict) =>
          role === 'OWNER'
            ? conflict.columns(['venue_id', 'account_id']).doUpdateSet({ role })
            : conflict.columns(['venue_id', 'account_id']).doNothing(),
        )
        .execute();
      return { accountId: account.id };
    });
  }

  /** Removes a member of staff; the owner is changed only by an administrator. */
  async removeStaff(venueId: string, accountId: string): Promise<void> {
    const row = await this.deps.db
      .selectFrom('venue_staff')
      .select('role')
      .where('venue_id', '=', venueId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    if (!row) throw new VenueError(404, 'NOT_FOUND');
    if (row.role === 'OWNER') throw new VenueError(409, 'INVALID_STATE');
    await this.deps.db
      .deleteFrom('venue_staff')
      .where('venue_id', '=', venueId)
      .where('account_id', '=', accountId)
      .execute();
  }

  // ───────────── tables ─────────────

  private view(row: SessionRow, now: number): SessionView {
    const record = this.record(row);
    const meter = meterOf(record, now);
    const left = remainingMs(record, now);
    return {
      id: row.id,
      roomCode: row.room_code,
      state: row.state as SessionState,
      remainingMs: Math.floor(left),
      endsAt: meter.endsAt,
      purchasedMinutes: Math.round(row.purchased_seconds / 60),
      startedAt: row.started_at.getTime(),
      timeUp: row.state !== 'ENDED' && left <= 0,
      roomLive: this.liveRoom(row.room_id) !== undefined,
    };
  }

  private liveRoom(roomId: string): LiveRoom | undefined {
    const room = this.deps.manager.get(roomId);
    return room && !room.isClosing() && !room.isLost() ? room : undefined;
  }

  /** The tables that are still open (not ended), plus those ended in the last hour for reference. */
  async sessions(venueId: string): Promise<{ serverTime: number; items: SessionView[] }> {
    const now = this.now();
    const rows = await this.deps.db
      .selectFrom('venue_sessions')
      .selectAll()
      .where('venue_id', '=', venueId)
      .where((eb) =>
        eb.or([eb('state', '<>', 'ENDED'), eb('ended_at', '>', new Date(now - 3_600_000))]),
      )
      .orderBy('started_at', 'desc')
      .limit(50)
      .execute();
    return { serverTime: now, items: rows.map((row) => this.view(row, now)) };
  }

  private async lockSession(
    trx: Transaction<DB>,
    venueId: string,
    sessionId: string,
  ): Promise<SessionRow> {
    const row = await trx
      .selectFrom('venue_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      // A session id of another venue is simply unknown here (no cross-venue oracle).
      .where('venue_id', '=', venueId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new VenueError(404, 'NOT_FOUND');
    return row;
  }

  private async event(
    trx: Transaction<DB>,
    row: { id: string; venue_id: string },
    kind: 'OPEN' | 'EXTEND' | 'PAUSE' | 'RESUME' | 'END' | 'REDEEM',
    staffId: string,
    seconds: number,
  ): Promise<void> {
    await trx
      .insertInto('venue_session_events')
      .values({
        session_id: row.id,
        venue_id: row.venue_id,
        kind,
        staff_account_id: staffId,
        seconds: Math.round(seconds),
        at: new Date(this.now()),
      })
      .execute();
  }

  /** Opens a table on a TV, found by its room code or by the TV's unlock QR (a link intent, ADR-0013). */
  async open(
    venueId: string,
    staffId: string,
    minutes: number,
    target: { roomCode: string } | { link: string },
  ): Promise<SessionView> {
    let room: LiveRoom | undefined;
    if ('roomCode' in target) {
      const code = parseRoomCode(target.roomCode);
      room = code ? this.deps.manager.getByCode(code) : undefined;
    } else {
      const claimed = await this.deps.links.claim(target.link, staffId);
      room = claimed ? this.deps.manager.get(claimed.roomId) : undefined;
    }
    if (!room || room.isClosing() || room.isLost()) throw new VenueError(404, 'ROOM_NOT_FOUND');
    if (!ATTACHABLE_PHASES.has(room.state.phase)) throw new VenueError(409, 'GAME_IN_PROGRESS');
    const now = this.now();
    let row: SessionRow;
    try {
      row = await this.deps.db.transaction().execute(async (trx) => {
        const inserted = await trx
          .insertInto('venue_sessions')
          .values({
            venue_id: venueId,
            room_id: room.id,
            room_code: room.code,
            opened_by: staffId,
            purchased_seconds: minutes * 60,
            started_at: new Date(now),
            state: 'RUNNING',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.event(trx, inserted, 'OPEN', staffId, minutes * 60);
        return inserted;
      });
    } catch (error) {
      // The partial unique index: this TV already has an open table.
      if ((error as { code?: string }).code === '23505') throw new VenueError(409, 'INVALID_STATE');
      throw error;
    }
    await this.push(row, 'LINKED');
    await this.applyTableDefaults(venueId, room);
    return this.view(row, this.now());
  }

  /**
   * The venue's way of starting a table (ADR-0026 §7): team or individual play, the simple ruleset, the
   * venue's team names and café answer window. Only the room's lobby settings move; the leader can still
   * change play mode and ruleset on the TV, and nothing here touches an account, a price or a reward.
   */
  private async applyTableDefaults(venueId: string, room: LiveRoom): Promise<void> {
    const { play } = await this.settings(venueId);
    await room
      .applyTablePreset({
        play: play.defaultMode,
        ruleset: play.simpleRuleset ? 'SIMPLE' : 'FULL',
        teamNames: play.teamNames,
        simpleAnswerSeconds: play.simpleAnswerSeconds,
      })
      .catch(this.deps.onError);
  }

  async extend(
    venueId: string,
    sessionId: string,
    staffId: string,
    minutes: number,
  ): Promise<SessionView> {
    const row = await this.deps.db.transaction().execute(async (trx) => {
      const current = await this.lockSession(trx, venueId, sessionId);
      if (current.state === 'ENDED') throw new VenueError(409, 'INVALID_STATE');
      const purchased = current.purchased_seconds + minutes * 60;
      if (purchased > MAX_PURCHASED_SECONDS) throw new VenueError(409, 'LIMIT_REACHED');
      const now = this.now();
      const next = extendRecord(this.record(current), this.msOfSeconds(minutes * 60), now);
      const updated = await trx
        .updateTable('venue_sessions')
        .set({ purchased_seconds: purchased, paused_total_seconds: next.pausedTotalMs / 1000 })
        .where('id', '=', current.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.event(trx, updated, 'EXTEND', staffId, minutes * 60);
      return updated;
    });
    await this.push(row, 'GRANTED');
    return this.view(row, this.now());
  }

  async pause(venueId: string, sessionId: string, staffId: string): Promise<SessionView> {
    const row = await this.deps.db.transaction().execute(async (trx) => {
      const current = await this.lockSession(trx, venueId, sessionId);
      const now = this.now();
      if (current.state !== 'RUNNING' || remainingMs(this.record(current), now) <= 0)
        throw new VenueError(409, 'INVALID_STATE');
      const next = pauseRecord(this.record(current), now);
      const updated = await trx
        .updateTable('venue_sessions')
        .set({ state: 'PAUSED', paused_at: new Date(next.pausedAt!) })
        .where('id', '=', current.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.event(trx, updated, 'PAUSE', staffId, remainingMs(next, now) / 1000);
      return updated;
    });
    await this.push(row, 'GRANTED');
    return this.view(row, this.now());
  }

  async resume(venueId: string, sessionId: string, staffId: string): Promise<SessionView> {
    const row = await this.deps.db.transaction().execute(async (trx) => {
      const current = await this.lockSession(trx, venueId, sessionId);
      if (current.state !== 'PAUSED') throw new VenueError(409, 'INVALID_STATE');
      const now = this.now();
      const before = this.record(current);
      const next = resumeRecord(before, now);
      const updated = await trx
        .updateTable('venue_sessions')
        .set({ state: 'RUNNING', paused_at: null, paused_total_seconds: next.pausedTotalMs / 1000 })
        .where('id', '=', current.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.event(
        trx,
        updated,
        'RESUME',
        staffId,
        (next.pausedTotalMs - before.pausedTotalMs) / 1000,
      );
      return updated;
    });
    await this.push(row, 'GRANTED');
    return this.view(row, this.now());
  }

  async end(venueId: string, sessionId: string, staffId: string): Promise<SessionView> {
    const row = await this.deps.db.transaction().execute(async (trx) => {
      const current = await this.lockSession(trx, venueId, sessionId);
      if (current.state === 'ENDED') throw new VenueError(409, 'INVALID_STATE');
      const now = this.now();
      const next = endRecord(this.record(current), now);
      const updated = await trx
        .updateTable('venue_sessions')
        .set({
          state: 'ENDED',
          paused_at: null,
          paused_total_seconds: next.pausedTotalMs / 1000,
          ended_at: new Date(now),
        })
        .where('id', '=', current.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.event(trx, updated, 'END', staffId, remainingMs(next, now) / 1000);
      return updated;
    });
    await this.push(row, 'GRANTED');
    return this.view(row, this.now());
  }

  /**
   * Tells the room what its table looks like now and keeps its tier in step through the existing
   * entitlement input (ADR-0024 §5): FULL while time runs, back to FREE when it is up or ended, unless a
   * guest's own account (who owns the game) is linked to the room.
   *
   * Pushes of one table run one after another and each reads the row afresh: two waiters extending at
   * once commit in one order but their continuations may run in the other, and the older row must never
   * overwrite the newer meter on the TV. With the feature switched off the room is let go instead.
   */
  private push(row: SessionRow, reopenReason: 'LINKED' | 'GRANTED'): Promise<void> {
    const previous = this.pushes.get(row.id) ?? Promise.resolve();
    const next = previous.then(() => this.pushNow(row, reopenReason));
    const settled = next.catch(() => undefined);
    this.pushes.set(row.id, settled);
    void settled.then(() => {
      if (this.pushes.get(row.id) === settled) this.pushes.delete(row.id);
    });
    return next;
  }

  private async pushNow(known: SessionRow, reopenReason: 'LINKED' | 'GRANTED'): Promise<void> {
    this.disarm(known.id);
    const row =
      (await this.deps.db
        .selectFrom('venue_sessions')
        .selectAll()
        .where('id', '=', known.id)
        .executeTakeFirst()) ?? known;
    const room = this.liveRoom(row.room_id);
    if (!room) return;
    if (!(await this.enabled())) return this.letGo(room);
    const now = this.now();
    const meter = meterOf(this.record(row), now);
    await room.applyVenueMeter(meter);
    const blocked = meterBlock(meter, now);
    if (blocked === null) {
      if (room.tier() !== 'FULL')
        await room.applyEntitlement('FULL', room.hostAccountId(), reopenReason);
      this.arm(row.id, meter);
    } else if (
      blocked === 'VENUE_TIME_UP' &&
      room.hostAccountId() === null &&
      room.tier() === 'FULL'
    ) {
      await room.applyEntitlement('FREE', null, 'EXPIRED');
    }
  }

  /**
   * `venue.sessions` is off (ADR-0024 §1: no room carries a meter then). Every staff route answers 404, so
   * a table left behind could neither be extended nor ended: the room goes back to the base product. The
   * table stays in the database; switching the feature on again lets staff extend it, which re-attaches it.
   */
  private async letGo(room: LiveRoom): Promise<void> {
    if (room.venueMeter() !== null) await room.applyVenueMeter(null);
    if (room.hostAccountId() === null && room.tier() === 'FULL')
      await room.applyEntitlement('FREE', null, 'EXPIRED');
  }

  /** While the feature is off, rooms that still carry a table are let go (the flag has no change event). */
  async sweep(): Promise<void> {
    if (this.stopped || (await this.enabled())) return;
    const rows = await this.deps.db
      .selectFrom('venue_sessions')
      .selectAll()
      .where('state', '<>', 'ENDED')
      .execute();
    for (const row of rows) {
      const room = this.liveRoom(row.room_id);
      if (room && room.venueMeter() !== null) await this.push(row, 'GRANTED');
    }
  }

  private arm(sessionId: string, meter: VenueMeter): void {
    if (this.stopped || meter.state !== 'RUNNING' || meter.endsAt === null) return;
    const delay = Math.min(Math.max(0, meter.endsAt - this.now()) + 5, MAX_TIMER_MS);
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.expire(sessionId).catch(this.deps.onError);
    }, delay);
    timer.unref();
    this.timers.set(sessionId, timer);
  }

  private disarm(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.timers.delete(sessionId);
  }

  /** A running table's timer fired: re-read it (it may have been extended) and tell the room. */
  private async expire(sessionId: string): Promise<void> {
    const row = await this.deps.db
      .selectFrom('venue_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirst();
    if (row && row.state !== 'ENDED') await this.push(row, 'GRANTED');
  }

  /** At boot, after the rooms were recovered: every open table is told its meter again and timed. */
  async restore(): Promise<number> {
    const rows = await this.deps.db
      .selectFrom('venue_sessions')
      .selectAll()
      .where('state', '<>', 'ENDED')
      .execute();
    for (const row of rows) await this.push(row, 'GRANTED').catch(this.deps.onError);
    this.sweeper = setInterval(() => void this.sweep().catch(this.deps.onError), 20_000);
    this.sweeper.unref();
    return rows.length;
  }

  stop(): void {
    this.stopped = true;
    if (this.sweeper) clearInterval(this.sweeper);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  // ───────────── rewards ─────────────

  /**
   * A game reached its results (ADR-0024 §8). One reward for the single winner when every rule holds;
   * any refusal is silent (nobody is owed a reward).
   */
  async gameFinished(room: LiveRoom, gameId: string): Promise<'ISSUED' | 'NONE'> {
    if (!(await this.enabled())) return 'NONE';
    const state = room.state;
    const game = state.game;
    const results = game?.results;
    if (!game || !results || game.gameId !== gameId || results.cutShort) return 'NONE';
    const session = await this.deps.db
      .selectFrom('venue_sessions')
      .selectAll()
      .where('room_id', '=', room.id)
      .where('state', '<>', 'ENDED')
      .executeTakeFirst();
    if (!session) return 'NONE';
    const settings = await this.settings(session.venue_id);
    const reward = settings.reward;
    if (!reward.enabled || reward.text.length === 0 || reward.maxPerDay === 0) return 'NONE';

    const connected = results.ranking.filter(
      (entry) => state.players[entry.playerId]?.connection === 'CONNECTED',
    );
    if (connected.length < reward.minPlayers) return 'NONE';
    const picked = this.rewardWinner(state, game, results, connected);
    if (!picked) return 'NONE';
    const { winner, teamId } = picked;

    const now = this.now();
    const day = localDay(now, settings.timezone);
    const code = newRewardCode();
    const issued = await this.deps.db.transaction().execute(async (trx) => {
      // One venue at a time: two tables finishing together cannot both take the last reward of the day.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`venue-reward:${session.venue_id}`}))`.execute(
        trx,
      );
      const today = await trx
        .selectFrom('venue_rewards')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('venue_id', '=', session.venue_id)
        .where('issued_at', '>=', new Date(day.start))
        .executeTakeFirstOrThrow();
      if (Number(today.n) >= reward.maxPerDay) return null;
      const last = await trx
        .selectFrom('venue_rewards')
        .select('issued_at')
        .where('session_id', '=', session.id)
        .orderBy('issued_at', 'desc')
        .executeTakeFirst();
      if (
        last &&
        game.startedAt - last.issued_at.getTime() < reward.rematchCooldownMinutes * 60_000
      )
        return null;
      const row = await trx
        .insertInto('venue_rewards')
        .values({
          venue_id: session.venue_id,
          session_id: session.id,
          room_id: room.id,
          game_id: gameId,
          winner_display_name: winner.nickname,
          reward_text: reward.text,
          code_hash: this.rewardHash(code),
          issued_at: new Date(now),
          expires_at: new Date(day.end),
        })
        .onConflict((conflict) => conflict.column('game_id').doNothing())
        .returning(['id', 'expires_at'])
        .executeTakeFirst();
      return row ?? null;
    });
    if (!issued) return 'NONE';
    await room.deliverVenueReward(
      gameId,
      winner.playerId,
      { code, text: reward.text, expiresAt: issued.expires_at.getTime() },
      teamId,
    );
    return 'ISSUED';
  }

  /**
   * Who a finished game's reward goes to, or null when nobody is owed one (ADR-0024 §8, ADR-0026 §8).
   * One code per game, whatever the mode.
   * - Individual play: the single first place (a shared first place gets nothing: no fair tie-break).
   * - Team play: the single first-placed team (a tie gets nothing); there must have been two teams, each
   *   with a phone still connected, so a team cannot win because the other walked away. The code goes to
   *   one representative: the best-ranked connected member of the winning team.
   */
  private rewardWinner(
    state: LiveRoom['state'],
    game: NonNullable<LiveRoom['state']['game']>,
    results: NonNullable<NonNullable<LiveRoom['state']['game']>['results']>,
    connected: { playerId: string }[],
  ): { winner: NonNullable<LiveRoom['state']['players'][string]>; teamId?: TeamId } | null {
    const online = (playerId: string) => state.players[playerId]?.connection === 'CONNECTED';
    if (game.teams) {
      const board = results.teamRanking ?? [];
      const top = board.filter((entry) => entry.rank === 1);
      if (board.length < 2 || top.length !== 1) return null;
      const present = (teamId: TeamId) =>
        connected.some((entry) => game.players[entry.playerId]?.teamId === teamId);
      if (!board.every((entry) => present(entry.teamId))) return null;
      const teamId = top[0]!.teamId;
      const rep = results.ranking.find(
        (entry) => game.players[entry.playerId]?.teamId === teamId && online(entry.playerId),
      );
      const winner = rep ? state.players[rep.playerId] : undefined;
      return winner ? { winner, teamId } : null;
    }
    const top = results.ranking.filter((entry) => entry.rank === 1);
    if (top.length !== 1) return null;
    const winner = state.players[top[0]!.playerId];
    return winner && winner.connection === 'CONNECTED' ? { winner } : null;
  }

  /**
   * Staff check a winner's code: one conditional UPDATE marks it used, so of two simultaneous attempts
   * exactly one wins (the row lock makes the second re-read `redeemed_at`).
   */
  async redeem(
    venueId: string,
    staffId: string,
    code: string,
  ): Promise<{ text: string; winner: string; issuedAt: number; redeemedAt: number }> {
    const hash = this.rewardHash(code);
    const now = new Date(this.now());
    return this.deps.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('venue_rewards')
        .set({ redeemed_at: now, redeemed_by: staffId })
        .where('venue_id', '=', venueId)
        .where('code_hash', '=', hash)
        .where('redeemed_at', 'is', null)
        .where('expires_at', '>', now)
        .returning([
          'id',
          'session_id',
          'venue_id',
          'reward_text',
          'winner_display_name',
          'issued_at',
        ])
        .executeTakeFirst();
      if (row) {
        await this.event(trx, { id: row.session_id, venue_id: row.venue_id }, 'REDEEM', staffId, 0);
        return {
          text: row.reward_text,
          winner: row.winner_display_name,
          issuedAt: row.issued_at.getTime(),
          redeemedAt: now.getTime(),
        };
      }
      const known = await trx
        .selectFrom('venue_rewards')
        .select(['redeemed_at', 'expires_at'])
        .where('venue_id', '=', venueId)
        .where('code_hash', '=', hash)
        .executeTakeFirst();
      if (known?.redeemed_at)
        throw new VenueError(409, 'REWARD_ALREADY_REDEEMED', {
          redeemedAt: known.redeemed_at.getTime(),
        });
      if (known) throw new VenueError(410, 'REWARD_EXPIRED');
      throw new VenueError(404, 'NOT_FOUND');
    });
  }

  // ───────────── administration ─────────────

  async createVenue(
    name: string,
    ownerEmail: string,
    createdBy: string | null,
  ): Promise<{ id: string }> {
    const venue = await this.deps.db
      .insertInto('venues')
      .values({ name, settings: JSON.stringify(readSettings({})), created_by: createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.setOwner(venue.id, ownerEmail, createdBy);
    return venue;
  }

  /** Makes `email` the venue's one owner (a previous owner stays on as staff). */
  async setOwner(
    venueId: string,
    email: string,
    by: string | null,
  ): Promise<{ accountId: string }> {
    const exists = await this.deps.db
      .selectFrom('venues')
      .select('id')
      .where('id', '=', venueId)
      .executeTakeFirst();
    if (!exists) throw new VenueError(404, 'NOT_FOUND');
    await this.deps.db
      .updateTable('venue_staff')
      .set({ role: 'STAFF' })
      .where('venue_id', '=', venueId)
      .where('role', '=', 'OWNER')
      .execute();
    return this.addStaff(venueId, email, 'OWNER', by);
  }

  async venues(): Promise<
    {
      id: string;
      name: string;
      createdAt: string;
      owners: string[];
      staff: number;
      openTables: number;
    }[]
  > {
    const rows = await this.deps.db
      .selectFrom('venues')
      .select(['id', 'name', 'created_at'])
      .orderBy('name')
      .execute();
    const out = [];
    for (const row of rows) {
      const members = await this.staff(row.id);
      const open = await this.deps.db
        .selectFrom('venue_sessions')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('venue_id', '=', row.id)
        .where('state', '<>', 'ENDED')
        .executeTakeFirstOrThrow();
      out.push({
        id: row.id,
        name: row.name,
        createdAt: row.created_at.toISOString(),
        owners: members.filter((m) => m.role === 'OWNER').map((m) => m.email ?? ''),
        staff: members.length,
        openTables: Number(open.n),
      });
    }
    return out;
  }

  /**
   * Per local day: tables opened, minutes sold (opening minutes plus extensions), extensions, rewards
   * issued and redeemed. Counts only; nothing about players. Without dates: the last 30 days of the
   * venue's own calendar (a UTC "today" would leave out everything after local midnight).
   */
  async report(
    venueId: string,
    range: { from?: string | undefined; to?: string | undefined } = {},
  ): Promise<{
    venue: { id: string; name: string; timezone: string };
    from: string;
    to: string;
    days: {
      date: string;
      sessions: number;
      minutesSold: number;
      extensions: number;
      rewardsIssued: number;
      rewardsRedeemed: number;
    }[];
  }> {
    const venue = await this.deps.db
      .selectFrom('venues')
      .select(['id', 'name', 'settings'])
      .where('id', '=', venueId)
      .executeTakeFirst();
    if (!venue) throw new VenueError(404, 'NOT_FOUND');
    const tz = readSettings(venue.settings).timezone;
    const now = this.now();
    const to = range.to ?? localDate(now, tz);
    const from = range.from ?? localDate(now - 30 * 86_400_000, tz);
    const day = (column: string) =>
      sql<string>`to_char((${sql.ref(column)} AT TIME ZONE ${tz})::date, 'YYYY-MM-DD')`;
    const inRange = (column: string) =>
      sql<boolean>`(${sql.ref(column)} AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date`;
    const events = await this.deps.db
      .selectFrom('venue_session_events')
      .select([
        day('at').as('date'),
        sql<number>`count(*) FILTER (WHERE kind = 'OPEN')::int`.as('sessions'),
        sql<number>`coalesce(sum(seconds) FILTER (WHERE kind IN ('OPEN', 'EXTEND')), 0)::int`.as(
          'seconds',
        ),
        sql<number>`count(*) FILTER (WHERE kind = 'EXTEND')::int`.as('extensions'),
      ])
      .where('venue_id', '=', venueId)
      .where(inRange('at'))
      .groupBy(sql`1`)
      .execute();
    const issued = await this.deps.db
      .selectFrom('venue_rewards')
      .select([day('issued_at').as('date'), sql<number>`count(*)::int`.as('n')])
      .where('venue_id', '=', venueId)
      .where(inRange('issued_at'))
      .groupBy(sql`1`)
      .execute();
    const redeemed = await this.deps.db
      .selectFrom('venue_rewards')
      .select([day('redeemed_at').as('date'), sql<number>`count(*)::int`.as('n')])
      .where('venue_id', '=', venueId)
      .where('redeemed_at', 'is not', null)
      .where(inRange('redeemed_at'))
      .groupBy(sql`1`)
      .execute();
    const days = new Map<
      string,
      {
        date: string;
        sessions: number;
        minutesSold: number;
        extensions: number;
        rewardsIssued: number;
        rewardsRedeemed: number;
      }
    >();
    const at = (date: string) => {
      let entry = days.get(date);
      if (!entry) {
        entry = {
          date,
          sessions: 0,
          minutesSold: 0,
          extensions: 0,
          rewardsIssued: 0,
          rewardsRedeemed: 0,
        };
        days.set(date, entry);
      }
      return entry;
    };
    for (const row of events) {
      const entry = at(row.date);
      entry.sessions = row.sessions;
      entry.minutesSold = Math.round(row.seconds / 60);
      entry.extensions = row.extensions;
    }
    for (const row of issued) at(row.date).rewardsIssued = row.n;
    for (const row of redeemed) at(row.date).rewardsRedeemed = row.n;
    return {
      venue: { id: venue.id, name: venue.name, timezone: tz },
      from,
      to,
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}
