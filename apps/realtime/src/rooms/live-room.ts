import type { FastifyBaseLogger } from 'fastify';
import { randomToken, randomUuid } from '@quizparty/shared';
import {
  HOST_COMMANDS,
  type AvatarId,
  type ClientMessage,
  type ErrorCode,
  type RoomView,
  type ServerEvent,
} from '@quizparty/protocol';
import {
  nextWakeAt,
  reduce,
  roomView,
  type Actor,
  type Audience,
  type CommandResult,
  type Effect,
  type EngineCommand,
  type EngineInput,
  type RoomState,
  type Viewer,
} from '@quizparty/game-engine';
import { validateNickname } from '@quizparty/validation';
import type { AppConfig } from '../config';
import type { SecurityLog } from '../security/events';
import type { TelemetrySink } from '../telemetry/sink';
import type { Clock } from '../util/clock';
import type { Metrics } from '../util/metrics';
import type { Connection } from '../ws/connection';
import { OutboundValidationError } from '../ws/connection';
import { NotEnoughQuestionsError, type DeckBuilder } from './deck-builder';
import { DeviceAlreadyJoinedError, type SessionRecord, type SessionService } from './sessions';
import type { PgRoomStore } from './store';

export interface RoomDeps {
  config: AppConfig;
  clock: Clock;
  store: PgRoomStore;
  sessions: SessionService;
  deckBuilder: DeckBuilder;
  telemetry: TelemetrySink;
  security: SecurityLog;
  metrics: Metrics;
  log: FastifyBaseLogger;
  onClosed(room: LiveRoom): void;
}

interface SessionMeta {
  role: 'DISPLAY' | 'PLAYER';
  playerId: string | null;
  lastSeq: number;
  dirty: boolean;
}

export type JoinOutcome =
  { ok: true } | { ok: false; code: ErrorCode; params?: Record<string, string | number> };

/** Snapshots are taken when a game segment starts or ends; events in between are replayed. */
const SNAPSHOT_PHASES = new Set(['LOBBY', 'COUNTDOWN', 'ROUND_INTRO', 'FINAL', 'RESULTS']);
const SNAPSHOT_EVERY_EVENTS = 40;
const MIN_REARM_DELAY_AFTER_NOOP_MS = 250;

/**
 * One running room: authoritative in-memory state, a serial command queue, durable-before-ack
 * persistence, the phase timer and the connections attached to it (ADR-0003, ADR-0006).
 */
export class LiveRoom {
  readonly id: string;
  readonly code: string;
  state: RoomState;
  private readonly connections = new Map<string, Connection>();
  private readonly sessionMeta = new Map<string, SessionMeta>();
  private queue: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private snapshotVersion: number;
  private persistChain: Promise<void> = Promise.resolve();
  private startInFlight = false;
  private lastTickWasNoop = false;
  private lost = false;
  private closing = false;

  constructor(
    private readonly deps: RoomDeps,
    state: RoomState,
    snapshotVersion: number,
    sessions: SessionRecord[],
  ) {
    this.id = state.roomId;
    this.code = state.code;
    this.state = state;
    this.snapshotVersion = snapshotVersion;
    for (const session of sessions) {
      this.sessionMeta.set(session.id, {
        role: session.role,
        playerId: session.playerId,
        lastSeq: session.lastClientSequence,
        dirty: false,
      });
    }
  }

  // ───────────── queue & timers ─────────────

  /** Runs `task` after everything queued before it; failures do not poison the queue. */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  isLost(): boolean {
    return this.lost;
  }

  isClosing(): boolean {
    return this.closing;
  }

  connectionCount(): number {
    return this.connections.size;
  }

  start(): void {
    this.armTimer();
  }

  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.closing || this.lost) return;
    const now = this.deps.clock.now();
    const wake = nextWakeAt(this.state, now);
    if (wake === null) return;
    let delay = Math.min(Math.max(0, wake - now), 2 * 60 * 60_000);
    // Defence in depth for the wake-time contract: a TICK that changed nothing must not re-arm at once.
    if (this.lastTickWasNoop && delay < MIN_REARM_DELAY_AFTER_NOOP_MS)
      delay = MIN_REARM_DELAY_AFTER_NOOP_MS;
    this.timer = setTimeout(() => {
      void this.enqueue(() => this.tick()).catch((error: unknown) => this.fail('tick', error));
    }, delay);
  }

  private async tick(): Promise<void> {
    const before = this.state;
    await this.apply({ kind: 'TICK', at: this.deps.clock.now(), entropy: randomToken(12) });
    this.lastTickWasNoop = this.state === before;
    if (this.lastTickWasNoop) this.armTimer();
  }

  private fail(kind: string, error: unknown): void {
    this.deps.metrics.errors.inc({ kind });
    this.deps.log.error({ err: error, roomId: this.id, kind }, 'room task failed');
  }

  // ───────────── applying inputs ─────────────

  /** Must run inside the queue. Reduce → append durably → commit → dispatch. */
  private async apply(input: EngineInput): Promise<CommandResult> {
    if (this.lost) return { ok: false, code: 'INTERNAL' };
    const started = process.hrtime.bigint();
    const result = reduce(this.state, input);
    if (result.changed) {
      let outcome: 'OK' | 'FENCED';
      try {
        outcome = await this.deps.store.appendEvent(this.id, result.state.version, input.at, input);
      } catch (error) {
        this.fail('append', error);
        return { ok: false, code: 'INTERNAL' };
      }
      if (outcome === 'FENCED') {
        this.markLost('fenced');
        return { ok: false, code: 'INTERNAL' };
      }
    }
    const previous = this.state;
    this.state = result.state;
    this.dispatch(result.effects);
    if (result.changed) this.maybeSnapshot(previous);
    this.armTimer();
    this.deps.metrics.inputDuration.observe(Number(process.hrtime.bigint() - started) / 1e9);
    return result.result;
  }

  private entropy(): string {
    return randomToken(12);
  }

  private maybeSnapshot(previous: RoomState): void {
    const phaseChanged = previous.phase !== this.state.phase;
    const due =
      (phaseChanged && SNAPSHOT_PHASES.has(this.state.phase)) ||
      this.state.version - this.snapshotVersion >= SNAPSHOT_EVERY_EVENTS;
    if (!due) return;
    const snapshot = this.state;
    this.snapshotVersion = snapshot.version;
    this.persistChain = this.persistChain
      .then(() => this.deps.store.saveSnapshot(this.id, snapshot))
      .catch((error: unknown) => this.fail('snapshot', error));
  }

  /** Ownership was lost (another instance took over): stop serving without touching the data. */
  markLost(reason: string): void {
    if (this.lost) return;
    this.lost = true;
    this.deps.log.warn({ roomId: this.id, reason }, 'room ownership lost; dropping connections');
    this.deps.metrics.errors.inc({ kind: 'ownership_lost' });
    if (this.timer) clearTimeout(this.timer);
    for (const connection of this.connections.values()) connection.close(1012, 'service restart');
    this.connections.clear();
    this.deps.onClosed(this);
  }

  // ───────────── effect dispatch ─────────────

  private dispatch(effects: Effect[]): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'emit':
          this.deliver(effect.audience, effect.event);
          break;
        case 'needDeck':
          this.startDeckBuild(effect);
          break;
        case 'persist':
          this.persistChain = this.persistChain
            .then(() => this.deps.store.persistGameRecord(this.id, effect.record))
            .catch((error: unknown) => this.fail('persist', error));
          break;
        case 'telemetry':
          this.deps.telemetry.record(effect.name, effect.props);
          break;
        case 'kick':
          this.kickPlayer(effect.playerId, effect.reason);
          break;
        case 'closeRoom':
          this.finalizeClose(effect.reason);
          break;
      }
    }
  }

  private targetsFor(audience: Audience): Connection[] {
    const ready = (connection: Connection | undefined): connection is Connection =>
      connection !== undefined && connection.ready;
    switch (audience.to) {
      case 'ALL':
        return [...this.connections.values()].filter(ready);
      case 'DISPLAY':
        return [...this.connections.values()].filter((c) => ready(c) && c.role === 'DISPLAY');
      case 'PLAYERS':
        return [...this.connections.values()].filter((c) => ready(c) && c.role === 'PLAYER');
      case 'PLAYER': {
        const sessionId = this.state.players[audience.playerId]?.sessionId;
        const connection = sessionId ? this.connections.get(sessionId) : undefined;
        return ready(connection) ? [connection] : [];
      }
    }
  }

  private deliver(audience: Audience, event: ServerEvent): void {
    for (const connection of this.targetsFor(audience)) this.send(connection, event);
  }

  private send(connection: Connection, event: ServerEvent): void {
    try {
      connection.send(event, { stateVersion: this.state.version });
    } catch (error) {
      if (error instanceof OutboundValidationError) {
        // A schema violation on the way out is a server bug and, before reveal, a potential leak.
        this.fail('outbound_validation', error);
        throw error;
      }
      this.fail('send', error);
    }
  }

  private notifyActor(actor: Actor, code: ErrorCode): void {
    const sessionId = actor.sessionId;
    const connection = this.connections.get(sessionId);
    if (connection?.ready) connection.error(code, null);
  }

  // ───────────── starting games (deck handshake) ─────────────

  private startDeckBuild(effect: Extract<Effect, { kind: 'needDeck' }>): void {
    if (this.startInFlight) return;
    this.startInFlight = true;
    void (async () => {
      try {
        const deck = await this.deps.deckBuilder.build(effect.request);
        await this.enqueue(async () => {
          const result = await this.apply({
            kind: 'BEGIN_GAME',
            at: this.deps.clock.now(),
            entropy: this.entropy(),
            requestedBy: effect.requestedBy,
            purpose: effect.purpose,
            gameId: randomUuid(),
            deck,
          });
          if (!result.ok) this.notifyActor(effect.requestedBy, result.code);
        });
      } catch (error) {
        const code: ErrorCode =
          error instanceof NotEnoughQuestionsError ? 'NOT_ENOUGH_QUESTIONS' : 'INTERNAL';
        if (code === 'INTERNAL') this.fail('deck_build', error);
        this.notifyActor(effect.requestedBy, code);
      } finally {
        this.startInFlight = false;
      }
    })();
  }

  // ───────────── sessions & connections ─────────────

  private viewerFor(connection: Connection): Viewer {
    return connection.role === 'PLAYER' && connection.playerId
      ? { role: 'PLAYER', playerId: connection.playerId }
      : { role: 'DISPLAY' };
  }

  view(connection: Connection): RoomView {
    return roomView(this.state, this.viewerFor(connection), this.deps.clock.now());
  }

  private register(connection: Connection, session: SessionRecord): void {
    const previous = this.connections.get(session.id);
    if (previous && previous !== connection) {
      try {
        previous.send({ type: 'SESSION_SUPERSEDED', payload: {} });
      } catch {
        // the old socket may already be gone
      }
      previous.close(4001, 'superseded');
    }
    connection.sessionId = session.id;
    connection.roomId = this.id;
    connection.role = session.role;
    connection.playerId = session.playerId;
    this.connections.set(session.id, connection);
    const meta = this.sessionMeta.get(session.id);
    this.sessionMeta.set(session.id, {
      role: session.role,
      playerId: session.playerId,
      lastSeq: Math.max(meta?.lastSeq ?? 0, session.lastClientSequence),
      dirty: meta?.dirty ?? false,
    });
  }

  /** New player: create the session, apply the join, send the snapshot. */
  joinPlayer(
    connection: Connection,
    input: {
      nickname: string;
      key: string;
      avatarId: AvatarId;
      deviceId: string;
      clientKind: string;
    },
  ): Promise<JoinOutcome> {
    return this.enqueue(async (): Promise<JoinOutcome> => {
      const state = this.state;
      if (state.phase === 'ROOM_CLOSED') return { ok: false, code: 'ROOM_CLOSED' };
      if (state.phase !== 'WAITING' && state.phase !== 'LOBBY')
        return { ok: false, code: 'GAME_IN_PROGRESS' };
      const active = Object.values(state.players).filter((p) => p.status === 'ACTIVE');
      if (active.length >= state.config.maxPlayers) return { ok: false, code: 'ROOM_FULL' };
      if (active.some((p) => p.nicknameKey === input.key))
        return { ok: false, code: 'NICKNAME_TAKEN' };

      const playerId = randomUuid();
      let created: { session: SessionRecord; token: string };
      try {
        created = await this.deps.sessions.createPlayer({
          roomId: this.id,
          playerId,
          deviceId: input.deviceId,
          clientKind: input.clientKind,
        });
      } catch (error) {
        if (error instanceof DeviceAlreadyJoinedError) return { ok: false, code: 'ALREADY_JOINED' };
        throw error;
      }
      const result = await this.apply({
        kind: 'PLAYER_JOIN',
        at: this.deps.clock.now(),
        entropy: this.entropy(),
        player: {
          playerId,
          sessionId: created.session.id,
          nickname: input.nickname,
          nicknameKey: input.key,
          avatarId: input.avatarId,
        },
      });
      if (!result.ok) {
        await this.deps.sessions.remove(created.session.id);
        return { ok: false, code: result.code };
      }
      this.register(connection, created.session);
      this.send(connection, {
        type: 'ROOM_JOINED',
        payload: {
          session: { sessionId: created.session.id, playerId, reconnectToken: created.token },
          room: this.view(connection),
        },
      });
      connection.ready = true;
      return { ok: true };
    });
  }

  /** Existing session (token already validated and rotated): attach, mark online, send snapshot. */
  reconnect(connection: Connection, session: SessionRecord, token: string): Promise<JoinOutcome> {
    return this.enqueue(async (): Promise<JoinOutcome> => {
      if (this.state.phase === 'ROOM_CLOSED') return { ok: false, code: 'ROOM_CLOSED' };
      if (session.role === 'PLAYER') {
        const player = session.playerId ? this.state.players[session.playerId] : undefined;
        if (!player || player.status !== 'ACTIVE') return { ok: false, code: 'SESSION_REVOKED' };
      } else if (this.state.display.sessionId !== session.id) {
        return { ok: false, code: 'SESSION_REVOKED' };
      }
      this.register(connection, session);
      const at = this.deps.clock.now();
      if (session.role === 'DISPLAY')
        await this.apply({
          kind: 'DISPLAY_CONNECTION',
          at,
          entropy: this.entropy(),
          connected: true,
        });
      else
        await this.apply({
          kind: 'PLAYER_CONNECTION',
          at,
          entropy: this.entropy(),
          playerId: session.playerId!,
          connected: true,
        });
      this.deps.telemetry.record('reconnect', { role: session.role });
      this.send(connection, {
        type: 'RECONNECTED',
        payload: {
          session: { sessionId: session.id, playerId: session.playerId, reconnectToken: token },
          role: session.role,
          room: this.view(connection),
        },
      });
      connection.ready = true;
      return { ok: true };
    });
  }

  /** Socket closed: if it was the live connection of its session, mark the participant offline. */
  detach(connection: Connection): void {
    const sessionId = connection.sessionId;
    if (!sessionId || this.connections.get(sessionId) !== connection) return;
    this.connections.delete(sessionId);
    connection.ready = false;
    void this.enqueue(async () => {
      if (this.connections.has(sessionId)) return; // already re-attached by a newer connection
      const at = this.deps.clock.now();
      this.deps.telemetry.record('disconnect', { role: connection.role ?? 'PLAYER' });
      if (connection.role === 'DISPLAY')
        await this.apply({
          kind: 'DISPLAY_CONNECTION',
          at,
          entropy: this.entropy(),
          connected: false,
        });
      else if (connection.playerId) {
        await this.apply({
          kind: 'PLAYER_CONNECTION',
          at,
          entropy: this.entropy(),
          playerId: connection.playerId,
          connected: false,
        });
      }
    }).catch((error: unknown) => this.fail('detach', error));
  }

  private kickPlayer(playerId: string, reason: 'KICKED' | 'LEFT'): void {
    const sessionId = this.state.players[playerId]?.sessionId;
    if (!sessionId) return;
    void this.deps.sessions
      .setStatus(sessionId, reason)
      .catch((error: unknown) => this.fail('kick', error));
    const connection = this.connections.get(sessionId);
    if (connection) {
      try {
        connection.send({ type: 'SESSION_REVOKED', payload: { reason } });
      } catch {
        // already closing
      }
      connection.close(reason === 'KICKED' ? 4003 : 4004, reason.toLowerCase());
      this.connections.delete(sessionId);
    }
  }

  /** Immediately revokes a live connection (token reuse detected by the gateway). */
  revokeSession(sessionId: string, reason: 'TOKEN_REUSE'): void {
    const connection = this.connections.get(sessionId);
    if (!connection) return;
    try {
      connection.send({ type: 'SESSION_REVOKED', payload: { reason } });
    } catch {
      // already closing
    }
    connection.close(4002, 'revoked');
    void this.enqueue(async () => {
      this.connections.delete(sessionId);
      const meta = this.sessionMeta.get(sessionId);
      if (meta?.role === 'PLAYER' && meta.playerId) {
        await this.apply({
          kind: 'PLAYER_CONNECTION',
          at: this.deps.clock.now(),
          entropy: this.entropy(),
          playerId: meta.playerId,
          connected: false,
        });
      }
    }).catch((error: unknown) => this.fail('revoke', error));
  }

  private finalizeClose(reason: string): void {
    if (this.closing) return;
    this.closing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void (async () => {
      try {
        await this.persistChain;
        await this.deps.store.saveSnapshot(this.id, this.state);
        await this.deps.store.closeRoom(this.id, reason);
        await this.deps.sessions.expireRoom(this.id);
      } catch (error) {
        this.fail('close', error);
      }
      // Give clients a moment to receive the final ROOM_CLOSED phase event.
      const timer = setTimeout(() => {
        for (const connection of this.connections.values()) connection.close(1000, 'room closed');
        this.connections.clear();
        this.deps.onClosed(this);
      }, 500);
      timer.unref();
    })();
  }

  /** Graceful shutdown: persist the final state and drop connections with "service restart". */
  async shutdown(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.queue.catch(() => undefined);
    await this.persistChain.catch(() => undefined);
    if (!this.lost && !this.closing) {
      try {
        await this.deps.store.saveSnapshot(this.id, this.state);
      } catch (error) {
        this.fail('shutdown_snapshot', error);
      }
    }
    for (const connection of this.connections.values()) connection.close(1012, 'service restart');
    this.connections.clear();
  }

  /** Applies the recovery input after a restart (called once by the manager, inside the queue). */
  applyRecovery(outageMs: number): Promise<void> {
    return this.enqueue(async () => {
      await this.apply({
        kind: 'RECOVER',
        at: this.deps.clock.now(),
        entropy: this.entropy(),
        outageMs,
      });
    });
  }

  collectDirtySequences(): { id: string; sequence: number }[] {
    const out: { id: string; sequence: number }[] = [];
    for (const [id, meta] of this.sessionMeta) {
      if (meta.dirty) {
        out.push({ id, sequence: meta.lastSeq });
        meta.dirty = false;
      }
    }
    return out;
  }

  // ───────────── client messages ─────────────

  /** Handles one authenticated client message. Always runs inside the room queue. */
  handleClientMessage(
    connection: Connection,
    message: ClientMessage,
    receivedAt: number,
  ): Promise<void> {
    return this.enqueue(async () => {
      const sessionId = connection.sessionId;
      const meta = sessionId ? this.sessionMeta.get(sessionId) : undefined;
      if (!sessionId || !meta || this.connections.get(sessionId) !== connection) {
        connection.error('SESSION_EXPIRED', message.messageId);
        return;
      }
      if (message.sessionId !== sessionId || message.roomId !== this.id) {
        connection.error('FORBIDDEN', message.messageId);
        connection.strikes += 1;
        return;
      }
      if (message.sequence <= meta.lastSeq) {
        // Replayed or out-of-order frame: never executed (ADR-0008).
        connection.error('STALE_SEQUENCE', message.messageId);
        connection.strikes += 1;
        this.deps.security.record('STALE_SEQUENCE', {
          roomId: this.id,
          sessionId,
          ipHash: connection.ipHash,
        });
        return;
      }
      meta.lastSeq = message.sequence;
      meta.dirty = true;

      if (message.type === 'JOIN_ROOM' || message.type === 'RECONNECT') {
        connection.error('INVALID_STATE', message.messageId);
        return;
      }
      if (message.type === 'PING') {
        connection.send({
          type: 'PONG',
          payload: {
            clientSentAt: message.payload.clientSentAt,
            serverTime: this.deps.clock.now(),
          },
        });
        return;
      }
      if (message.type === 'REQUEST_STATE') {
        this.send(connection, { type: 'ROOM_STATE', payload: { room: this.view(connection) } });
        return;
      }

      const actor: Actor =
        connection.role === 'DISPLAY'
          ? { role: 'DISPLAY', sessionId }
          : { role: 'PLAYER', sessionId, playerId: connection.playerId! };

      let nicknameKey: string | undefined;
      let command = { type: message.type, payload: message.payload } as EngineCommand;
      if (message.type === 'SET_NICKNAME') {
        const checked = validateNickname(message.payload.nickname);
        if (!checked.ok) {
          connection.error('NICKNAME_INVALID', message.messageId, { reason: checked.reason });
          return;
        }
        nicknameKey = checked.key;
        command = { type: 'SET_NICKNAME', payload: { nickname: checked.nickname } };
      }

      const result = await this.apply({
        kind: 'COMMAND',
        at: receivedAt,
        entropy: this.entropy(),
        actor,
        command,
        messageId: message.messageId,
        ...(nicknameKey ? { nicknameKey } : {}),
      });

      if (result.ok) {
        if (message.type !== 'SUBMIT_ANSWER')
          this.send(connection, { type: 'ACK', payload: { messageId: message.messageId } });
        return;
      }
      if (HOST_COMMANDS.has(message.type) && result.code === 'NOT_HOST') {
        this.deps.security.record('HOST_COMMAND_FORBIDDEN', {
          roomId: this.id,
          sessionId,
          ipHash: connection.ipHash,
          detail: { type: message.type },
        });
      }
      if (message.type === 'SUBMIT_ANSWER') {
        this.send(connection, {
          type: 'ANSWER_REJECTED',
          payload: { messageId: message.messageId, code: result.code },
        });
      } else {
        connection.error(result.code, message.messageId);
      }
    });
  }

  /** Recipient count by role, for diagnostics. */
  describe(): {
    id: string;
    code: string;
    phase: string;
    players: number;
    connections: number;
    version: number;
  } {
    return {
      id: this.id,
      code: this.code,
      phase: this.state.phase,
      players: this.state.playerOrder.length,
      connections: this.connections.size,
      version: this.state.version,
    };
  }
}
