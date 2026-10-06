import { randomUuid, generateRoomCode } from '@quizparty/shared';
import { createRoom, resolveGameConfig, reduce, type RoomState } from '@quizparty/game-engine';
import type { AppConfig } from '../config';
import { systemClock, type Clock } from '../util/clock';
import { LiveRoom, type RoomDeps } from './live-room';
import type { PgRoomStore } from './store';
import type { SessionService } from './sessions';

export type ManagerDeps = Omit<RoomDeps, 'onClosed'> & { clock?: Clock };

export interface CreatedRoom {
  room: LiveRoom;
  displaySessionId: string;
  displayToken: string;
}

/** Registry of the rooms this instance owns, plus creation, recovery and lease heartbeats. */
export class RoomManager {
  private readonly rooms = new Map<string, LiveRoom>();
  private readonly byCode = new Map<string, LiveRoom>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private beating = false;
  private beats = 0;
  private stopped = false;

  constructor(private readonly deps: ManagerDeps) {}

  private get config(): AppConfig {
    return this.deps.config;
  }

  private get store(): PgRoomStore {
    return this.deps.store;
  }

  private get sessions(): SessionService {
    return this.deps.sessions;
  }

  private roomDeps(): RoomDeps {
    return {
      ...this.deps,
      clock: this.deps.clock ?? systemClock,
      onClosed: (room) => this.remove(room),
    };
  }

  size(): number {
    return this.rooms.size;
  }

  get(id: string): LiveRoom | undefined {
    return this.rooms.get(id);
  }

  getByCode(code: string): LiveRoom | undefined {
    return this.byCode.get(code);
  }

  all(): LiveRoom[] {
    return [...this.rooms.values()];
  }

  private register(room: LiveRoom): void {
    this.rooms.set(room.id, room);
    this.byCode.set(room.code, room);
    this.deps.metrics.rooms.set(this.rooms.size);
  }

  private remove(room: LiveRoom): void {
    if (this.rooms.get(room.id) === room) this.rooms.delete(room.id);
    if (this.byCode.get(room.code) === room) this.byCode.delete(room.code);
    this.deps.metrics.rooms.set(this.rooms.size);
  }

  async createRoom(input: {
    tier: 'FREE' | 'FULL';
    language: 'tr' | 'en';
    clientKind: string;
    hostAccountId?: string | null;
  }): Promise<CreatedRoom> {
    const clock = this.deps.clock ?? systemClock;
    const gameConfig = resolveGameConfig(this.config.gameConfigOverride);
    const roomId = randomUuid();
    const displaySessionId = randomUuid();

    let state: RoomState | null = null;
    for (let attempt = 0; attempt < 20 && state === null; attempt++) {
      const code = generateRoomCode();
      const candidate = createRoom({
        roomId,
        code,
        displaySessionId,
        now: clock.now(),
        config: gameConfig,
        tier: input.tier,
        hostAccountId: input.hostAccountId ?? null,
        contentLanguage: input.language,
      });
      const created = await this.store.createRoom({
        id: roomId,
        code,
        tier: input.tier,
        language: input.language,
        hostAccountId: input.hostAccountId ?? null,
        state: candidate,
      });
      if (created) state = candidate;
    }
    if (state === null) throw new Error('could not allocate a unique room code');

    let display: { token: string };
    try {
      display = await this.sessions.createDisplay(roomId, input.clientKind, displaySessionId);
    } catch (error) {
      await this.store.closeRoom(roomId, 'ADMIN');
      throw error;
    }
    const room = new LiveRoom(this.roomDeps(), state, state.version, []);
    this.register(room);
    room.start();
    this.deps.telemetry.record('room_created', { tier: input.tier });
    return { room, displaySessionId, displayToken: display.token };
  }

  /** Rebuilds claimed rooms from snapshot + input log and applies the time-freeze recovery. */
  async recover(ids: string[]): Promise<number> {
    let recovered = 0;
    for (const id of ids) {
      try {
        const loaded = await this.store.loadForRecovery(id);
        if (!loaded?.snapshot) continue;
        let state = loaded.snapshot;
        for (const event of loaded.events) {
          const result = reduce(state, event.input);
          if (result.state.version !== event.seq) {
            throw new Error(`event log of room ${id} is inconsistent at seq ${event.seq}`);
          }
          state = result.state;
        }
        const active = await this.sessions.loadActiveForRoom(id);
        const room = new LiveRoom(this.roomDeps(), state, loaded.snapshotVersion, active);
        this.register(room);
        const outageMs = Math.max(0, loaded.dbNow - (loaded.lastAliveAt ?? loaded.dbNow));
        await room.applyRecovery(outageMs);
        room.start();
        recovered += 1;
        this.deps.log.info({ roomId: id, outageMs, phase: room.state.phase }, 'room recovered');
      } catch (error) {
        this.deps.metrics.errors.inc({ kind: 'recovery' });
        this.deps.log.error({ err: error, roomId: id }, 'room recovery failed');
      }
    }
    return recovered;
  }

  /** Claims every orphaned room (boot) and recovers it. */
  async recoverAll(): Promise<number> {
    let total = 0;
    for (;;) {
      const ids = await this.store.claimOrphans(50, [...this.rooms.keys()]);
      if (ids.length === 0) return total;
      total += await this.recover(ids);
    }
  }

  startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => void this.beat(), this.config.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  private async beat(): Promise<void> {
    if (this.beating || this.stopped) return;
    this.beating = true;
    try {
      const rooms = this.all();
      const owned = new Set(await this.store.heartbeat(rooms.map((room) => room.id)));
      for (const room of rooms) {
        if (!owned.has(room.id) && !room.isClosing() && !room.isLost()) room.markLost('lease');
      }
      for (const room of rooms) {
        const dirty = room.collectDirtySequences();
        if (dirty.length > 0) await this.sessions.persistSequences(dirty);
      }
      this.beats += 1;
      if (this.beats % 5 === 0) await this.recoverAll(); // adopt rooms whose owner died
    } catch (error) {
      this.deps.metrics.errors.inc({ kind: 'heartbeat' });
      this.deps.log.error({ err: error }, 'heartbeat failed');
    } finally {
      this.beating = false;
    }
  }

  /** Graceful shutdown: flush every room and release leases so a restart resumes immediately. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    const rooms = this.all();
    await Promise.all(rooms.map((room) => room.shutdown()));
    try {
      await this.store.releaseLeases(
        rooms.filter((r) => !r.isClosing() && !r.isLost()).map((r) => r.id),
      );
    } catch (error) {
      this.deps.log.error({ err: error }, 'releasing leases failed');
    }
    this.rooms.clear();
    this.byCode.clear();
  }

  /** Test hook: simulates a crash by abandoning rooms without flushing or releasing anything. */
  abandonForTest(): void {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const room of this.rooms.values()) room.markLost('test-crash');
    this.rooms.clear();
    this.byCode.clear();
  }
}
