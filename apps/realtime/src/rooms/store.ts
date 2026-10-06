import { sql } from 'kysely';
import type { Database } from '@quizparty/db';
import type { EngineInput, PersistRecord, RoomState } from '@quizparty/game-engine';
import type { Clock } from '../util/clock';

export interface RecoveredRoom {
  roomId: string;
  code: string;
  snapshot: RoomState | null;
  snapshotVersion: number;
  events: { seq: number; at: number; input: EngineInput }[];
  /** Latest sign of life of the previous owner, epoch ms (DB clock). */
  lastAliveAt: number | null;
  /** Current time on the DB clock, epoch ms (avoids skew between app and database). */
  dbNow: number;
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgreSQL persistence for live rooms (ADR-0003/0006): ownership lease, the append-only input
 * log (fenced by the (room_id, seq) key and the owner check) and periodic snapshots.
 */
export class PgRoomStore {
  constructor(
    private readonly db: Database,
    private readonly instanceId: string,
    private readonly leaseMs: number,
    private readonly clock: Clock,
  ) {}

  private leaseExpiry(): Date {
    return new Date(this.clock.now() + this.leaseMs);
  }

  /** Inserts the room row owned by this instance. Returns false when the code is already taken. */
  async createRoom(input: {
    id: string;
    code: string;
    tier: 'FREE' | 'FULL';
    language: 'tr' | 'en';
    hostAccountId: string | null;
    state: RoomState;
  }): Promise<boolean> {
    try {
      await this.db
        .insertInto('rooms')
        .values({
          id: input.id,
          code: input.code,
          tier: input.tier,
          content_language: input.language,
          host_account_id: input.hostAccountId,
          owner_instance_id: this.instanceId,
          lease_expires_at: this.leaseExpiry(),
          last_heartbeat_at: new Date(this.clock.now()),
          snapshot: JSON.stringify(input.state),
          snapshot_version: input.state.version,
          state_version: input.state.version,
        })
        .execute();
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /**
   * Appends one reducer input. Succeeds only while this instance still owns the room and nobody
   * else has written the same sequence number; otherwise the caller has been fenced.
   */
  async appendEvent(
    roomId: string,
    seq: number,
    at: number,
    input: EngineInput,
  ): Promise<'OK' | 'FENCED'> {
    try {
      const result = await sql`
        WITH ins AS (
          INSERT INTO room_events (room_id, seq, at, input)
          SELECT ${roomId}::uuid, ${seq}, ${at}, ${JSON.stringify(input)}::jsonb
          WHERE EXISTS (SELECT 1 FROM rooms WHERE id = ${roomId}::uuid AND owner_instance_id = ${this.instanceId} AND status = 'ACTIVE')
          RETURNING 1
        )
        UPDATE rooms SET state_version = ${seq}, last_event_at = now()
        WHERE id = ${roomId}::uuid AND EXISTS (SELECT 1 FROM ins)`.execute(this.db);
      return (result.numAffectedRows ?? 0n) > 0n ? 'OK' : 'FENCED';
    } catch (error) {
      if (isUniqueViolation(error)) return 'FENCED';
      throw error;
    }
  }

  async saveSnapshot(roomId: string, state: RoomState): Promise<void> {
    await this.db
      .updateTable('rooms')
      .set({ snapshot: JSON.stringify(state), snapshot_version: state.version })
      .where('id', '=', roomId)
      .where('owner_instance_id', '=', this.instanceId)
      .execute();
  }

  /** Extends the lease of the given rooms; returns the ids this instance still owns. */
  async heartbeat(roomIds: string[]): Promise<string[]> {
    if (roomIds.length === 0) return [];
    const rows = await this.db
      .updateTable('rooms')
      .set({ last_heartbeat_at: new Date(this.clock.now()), lease_expires_at: this.leaseExpiry() })
      .where('id', 'in', roomIds)
      .where('owner_instance_id', '=', this.instanceId)
      .where('status', '=', 'ACTIVE')
      .returning('id')
      .execute();
    return rows.map((row) => row.id);
  }

  /**
   * Takes ownership of rooms nobody serves: lease expired, or left behind by a previous process
   * with the same instance id (a restart). Returns the claimed ids.
   */
  async claimOrphans(limit: number, exceptIds: string[]): Promise<string[]> {
    const result = await sql<{ id: string }>`
      UPDATE rooms SET owner_instance_id = ${this.instanceId}, lease_expires_at = ${this.leaseExpiry()}
      WHERE id IN (
        SELECT id FROM rooms
        WHERE status = 'ACTIVE'
          AND (lease_expires_at IS NULL OR lease_expires_at < now() OR owner_instance_id = ${this.instanceId})
          AND NOT (id = ANY(${exceptIds}::uuid[]))
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING id`.execute(this.db);
    return result.rows.map((row) => row.id);
  }

  async loadForRecovery(roomId: string): Promise<RecoveredRoom | null> {
    const room = await sql<{
      id: string;
      code: string;
      snapshot: RoomState | null;
      snapshot_version: number;
      alive_ms: number | null;
      now_ms: number;
    }>`
      SELECT id, code, snapshot, snapshot_version,
             (extract(epoch FROM greatest(last_heartbeat_at, last_event_at)) * 1000)::bigint AS alive_ms,
             (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
      FROM rooms WHERE id = ${roomId}::uuid AND status = 'ACTIVE'`.execute(this.db);
    const row = room.rows[0];
    if (!row) return null;
    const events = await this.db
      .selectFrom('room_events')
      .select(['seq', 'at', 'input'])
      .where('room_id', '=', roomId)
      .where('seq', '>', row.snapshot_version)
      .orderBy('seq')
      .execute();
    return {
      roomId: row.id,
      code: row.code,
      snapshot: row.snapshot,
      snapshotVersion: row.snapshot_version,
      events: events.map((event) => ({
        seq: event.seq,
        at: event.at,
        input: event.input as unknown as EngineInput,
      })),
      lastAliveAt: row.alive_ms === null ? null : Number(row.alive_ms),
      dbNow: Number(row.now_ms),
    };
  }

  async closeRoom(roomId: string, reason: string): Promise<void> {
    await this.db
      .updateTable('rooms')
      .set({
        status: 'CLOSED',
        closed_at: new Date(),
        close_reason: reason,
        lease_expires_at: null,
        owner_instance_id: null,
      })
      .where('id', '=', roomId)
      .where('status', '=', 'ACTIVE')
      .execute();
  }

  /** Graceful shutdown: let another instance (or our restart) take the rooms over immediately. */
  async releaseLeases(roomIds: string[]): Promise<void> {
    if (roomIds.length === 0) return;
    await this.db
      .updateTable('rooms')
      .set({ lease_expires_at: new Date(0) })
      .where('id', 'in', roomIds)
      .where('owner_instance_id', '=', this.instanceId)
      .execute();
  }

  /** Idempotent audit writes for games, rounds, answers, score deltas and question statistics. */
  async persistGameRecord(roomId: string, record: PersistRecord): Promise<void> {
    switch (record.type) {
      case 'GAME_STARTED': {
        await this.db
          .insertInto('games')
          .values({
            id: record.gameId,
            room_id: roomId,
            started_at: new Date(record.startedAt),
            total_rounds: record.totalRounds,
            config_version: record.configVersion,
            player_count: Math.max(1, record.playerIds.length),
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
        if (record.playerIds.length > 0) {
          await this.db
            .insertInto('game_players')
            .values(
              record.playerIds.map((playerId) => ({ game_id: record.gameId, player_id: playerId })),
            )
            .onConflict((oc) => oc.doNothing())
            .execute();
        }
        return;
      }
      case 'ROUND_COMPLETED': {
        await this.db.transaction().execute(async (trx) => {
          await trx
            .insertInto('game_rounds')
            .values({
              game_id: record.gameId,
              round_index: record.roundIndex,
              kind: record.kind,
              question_id: record.questionId,
              answer_ms: record.answerMs,
              correct_option_key: record.correctOptionKey,
              distribution: JSON.stringify(record.distribution),
              config_version: record.configVersion,
            })
            .onConflict((oc) => oc.doNothing())
            .execute();
          if (record.players.length > 0) {
            await trx
              .insertInto('game_answers')
              .values(
                record.players.map((p) => ({
                  game_id: record.gameId,
                  round_index: record.roundIndex,
                  player_id: p.playerId,
                  option_key: p.optionKey,
                  correct: p.correct,
                  remaining_ms: p.remainingMs,
                  stake: p.stake,
                  double_down: p.doubleDown,
                  fifty_fifty: p.fiftyFifty,
                })),
              )
              .onConflict((oc) => oc.doNothing())
              .execute();
            await trx
              .insertInto('score_deltas')
              .values(
                record.players.map((p) => ({
                  game_id: record.gameId,
                  round_index: record.roundIndex,
                  player_id: p.playerId,
                  delta: p.delta,
                  total_after: p.totalAfter,
                  components: JSON.stringify(p.components),
                  config_version: record.configVersion,
                })),
              )
              .onConflict((oc) => oc.doNothing())
              .execute();
          }
          if (record.sabotages.length > 0) {
            await trx
              .insertInto('sabotage_events')
              .values(
                record.sabotages.map((event, seq) => ({
                  game_id: record.gameId,
                  round_index: record.roundIndex,
                  seq,
                  actor_player_id: event.actorId,
                  target_player_id: event.targetId,
                  effect: event.effect,
                  blocked: event.blocked,
                })),
              )
              .onConflict((oc) => oc.doNothing())
              .execute();
          }
          if (UUID_RE.test(record.questionId)) {
            const answered = record.players.filter((p) => p.optionKey !== null);
            await trx
              .updateTable('questions')
              .set((eb) => ({
                usage_count: eb('usage_count', '+', 1),
                last_used_at: new Date(),
                answer_count: eb('answer_count', '+', answered.length),
                correct_answer_count: eb(
                  'correct_answer_count',
                  '+',
                  answered.filter((p) => p.correct).length,
                ),
                total_answer_ms: eb(
                  'total_answer_ms',
                  '+',
                  answered.reduce((sum, p) => sum + (record.answerMs - p.remainingMs), 0),
                ),
              }))
              .where('id', '=', record.questionId)
              .execute();
          }
        });
        return;
      }
      case 'GAME_FINISHED': {
        await this.db.transaction().execute(async (trx) => {
          await trx
            .updateTable('games')
            .set({ status: 'FINISHED', finished_at: new Date(record.finishedAt) })
            .where('id', '=', record.gameId)
            .execute();
          for (const entry of record.ranking) {
            await trx
              .updateTable('game_players')
              .set({
                final_score: entry.score,
                final_rank: entry.rank,
                correct_count: entry.correctCount,
                best_streak: entry.bestStreak,
              })
              .where('game_id', '=', record.gameId)
              .where('player_id', '=', entry.playerId)
              .execute();
          }
        });
        return;
      }
    }
  }
}
