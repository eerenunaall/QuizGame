import type { FastifyBaseLogger } from 'fastify';
import { randomToken, randomUuid } from '@quizparty/shared';
import {
  HOST_COMMANDS,
  MAX_STATEMENT_LENGTH,
  type AvatarId,
  type ClientMessage,
  type ErrorCode,
  type PlayMode,
  type RoomView,
  type Ruleset,
  type ServerEvent,
  type TeamId,
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
  type VenueMeter,
  type Viewer,
} from '@quizparty/game-engine';
import { sanitizeUserText, validateNickname } from '@quizparty/validation';
import type { AppConfig } from '../config';
import type { QuestionReports } from '../moderation/reports';
import { FeatureDisabledError, type PersonalDecks } from '../blind/decks';
import type { LinkService } from '../payments/links';
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
  personalDecks: PersonalDecks;
  telemetry: TelemetrySink;
  reports: QuestionReports;
  links: LinkService;
  security: SecurityLog;
  metrics: Metrics;
  log: FastifyBaseLogger;
  onClosed(room: LiveRoom): void;
  /** A game reached its results (venue rewards listen here, ADR-0024). Called outside the room queue. */
  onGameFinished?: (room: LiveRoom, gameId: string) => void;
}

/** Venue reward of the results on screen; kept in memory only (never in the engine, its log or snapshots). */
interface HeldReward {
  gameId: string;
  playerId: string;
  /** Team play (ADR-0026 §8): the winning team, whose representative holds the code. */
  teamId?: TeamId;
  payload: { code: string; text: string; expiresAt: number };
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
/** The answer is public from the reveal on; only then may a player flag the question. */
const REPORTABLE_PHASES: ReadonlySet<string> = new Set([
  'REVEAL',
  'POWER_RESOLUTION',
  'SCORE_UPDATE',
  'MICRO_INTERMISSION',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  private venueReward: HeldReward | null = null;

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
        case 'persist': {
          const record = effect.record;
          this.persistChain = this.persistChain
            .then(() => this.deps.store.persistGameRecord(this.id, record))
            .catch((error: unknown) => this.fail('persist', error));
          if (record.type === 'GAME_STARTED') this.venueReward = null;
          if (record.type === 'GAME_FINISHED' && this.deps.onGameFinished) {
            const listener = this.deps.onGameFinished;
            // Not inside the queue: the listener reads the database and comes back through enqueue.
            queueMicrotask(() => listener(this, record.gameId));
          }
          break;
        }
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
        const deck =
          effect.request.mode === 'CLASSIC'
            ? await this.deps.deckBuilder.build(effect.request)
            : await this.deps.personalDecks.build(effect.request);
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
          error instanceof NotEnoughQuestionsError
            ? 'NOT_ENOUGH_QUESTIONS'
            : error instanceof FeatureDisabledError
              ? 'FEATURE_DISABLED'
              : 'INTERNAL';
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
      // A socket holds one seat (ATTACK 38); a closed one never gets a seat it could not give back.
      if (connection.sessionId) return { ok: false, code: 'INVALID_STATE' };
      if (connection.closed) return { ok: false, code: 'SESSION_EXPIRED' };
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
          ipHash: connection.ipHash,
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
      this.detachIfGone(connection);
      return { ok: true };
    });
  }

  /**
   * The socket may have closed while it was being seated: its close event saw no room yet, so
   * nobody else will take the seat offline (ATTACK 38). Runs inside the queue, after `register`.
   */
  private detachIfGone(connection: Connection): void {
    if (connection.closed) this.detach(connection);
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
      this.resendVenueReward(connection);
      this.detachIfGone(connection);
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
        if (this.state.sensitiveContent) await this.deps.store.scrubRoom(this.id);
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

      if (message.type === 'REPORT_QUESTION') {
        await this.reportQuestion(connection, message, sessionId);
        return;
      }
      if (message.type === 'REQUEST_UNLOCK_LINK') {
        await this.unlockLink(connection, message.messageId);
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
      if (message.type === 'SUBMIT_STATEMENT') {
        // The same moderation as every other player-written text (ADR-0018); the engine only ever sees clean words.
        const checked = sanitizeUserText(message.payload.text, { maxLength: MAX_STATEMENT_LENGTH });
        if (!checked.ok) {
          connection.error('TEXT_REJECTED', message.messageId, { reason: checked.reason });
          return;
        }
        command = { type: 'SUBMIT_STATEMENT', payload: { text: checked.text } };
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
      // ASSIGN_TEAM is open to every player for themselves; moving somebody else is the host's alone.
      if (
        (HOST_COMMANDS.has(message.type) || message.type === 'ASSIGN_TEAM') &&
        result.code === 'NOT_HOST'
      ) {
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

  /**
   * A player flags the question whose answer was just revealed. This is not game state, so it does
   * not go through the reducer or the event log; the server decides which question it is (the id the
   * client sends must match), and nothing the player typed is stored.
   */
  private async reportQuestion(
    connection: Connection,
    message: Extract<ClientMessage, { type: 'REPORT_QUESTION' }>,
    sessionId: string,
  ): Promise<void> {
    const reject = (code: ErrorCode): void => connection.error(code, message.messageId);
    if (connection.role !== 'PLAYER') return reject('FORBIDDEN');
    const round = this.state.game?.round ?? null;
    const question = round?.question ?? null;
    if (!round || !question || !round.outcome || !REPORTABLE_PHASES.has(this.state.phase))
      return reject('INVALID_STATE');
    if (message.payload.questionId !== question.questionId) return reject('QUESTION_MISMATCH');
    if (!UUID_RE.test(question.questionId)) return reject('INVALID_STATE'); // only stored questions have a record to flag
    const source = this.state.game?.deck.questions[question.questionId]?.source;
    // Who Said It statements live only in this room and are erased at close: there is no record to flag.
    if (source !== 'BANK' && source !== 'BLIND' && source !== 'CUSTOM')
      return reject('INVALID_STATE');
    if (!(await this.deps.reports.enabled())) return reject('FEATURE_DISABLED');
    if (source === 'BANK') {
      await this.deps.reports.submit({
        questionId: question.questionId,
        sessionId,
        roomId: this.id,
        reason: message.payload.reason,
      });
    } else {
      // Personal content goes to moderation by id only (ADR-0015): the quiz is the room's own, never the client's word.
      const quizId = this.state.contentRef;
      if (!quizId) return reject('INVALID_STATE');
      const stored = await this.deps.reports.personal.submit({
        quizId,
        kind: source,
        questionId: question.questionId,
        sessionId,
        roomId: this.id,
        reason: message.payload.reason,
      });
      if (!stored) return reject('INVALID_STATE');
    }
    this.send(connection, { type: 'ACK', payload: { messageId: message.messageId } });
  }

  /**
   * The TV asks for a link to show as a QR code. Only the display may ask; the server mints a
   * one-time token bound to this room (at most a handful open at once) and tells nobody else.
   */
  private async unlockLink(connection: Connection, messageId: string): Promise<void> {
    if (connection.role !== 'DISPLAY') return connection.error('FORBIDDEN', messageId);
    if (this.state.phase !== 'LOBBY' && this.state.phase !== 'RESULTS')
      return connection.error('INVALID_STATE', messageId);
    const link = await this.deps.links.create(this.id);
    if (!link) return connection.error('RATE_LIMITED', messageId, { retryAfterMs: 30_000 });
    this.send(connection, { type: 'UNLOCK_LINK', payload: link });
    this.send(connection, { type: 'ACK', payload: { messageId } });
  }

  /** A moderator removed this session (a ban): the player sees an ordinary removal and is cut off. */
  expelSession(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (!connection) return;
    try {
      connection.send({ type: 'SESSION_REVOKED', payload: { reason: 'KICKED' } });
    } catch {
      // already closing
    }
    connection.close(4003, 'removed');
    this.connections.delete(sessionId);
    const meta = this.sessionMeta.get(sessionId);
    if (meta?.role === 'PLAYER' && meta.playerId) {
      const playerId = meta.playerId;
      void this.enqueue(async () => {
        await this.apply({
          kind: 'PLAYER_CONNECTION',
          at: this.deps.clock.now(),
          entropy: this.entropy(),
          playerId,
          connected: false,
        });
      }).catch((error: unknown) => this.fail('expel', error));
    }
  }

  /** What a moderator may see of a live room: who is in it, never anything they typed beyond a nickname. */
  adminView(): {
    id: string;
    code: string;
    phase: string;
    tier: string;
    language: string;
    connections: number;
    createdAt: number;
    players: {
      playerId: string;
      nickname: string;
      avatarId: string;
      status: string;
      connected: boolean;
      sessionId: string;
    }[];
  } {
    const state = this.state;
    return {
      id: this.id,
      code: this.code,
      phase: state.phase,
      tier: state.tier,
      language: state.contentLanguage,
      connections: this.connections.size,
      createdAt: state.createdAt,
      players: Object.values(state.players).map((player) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        avatarId: player.avatarId,
        status: player.status,
        connected: player.connection === 'CONNECTED',
        sessionId: player.sessionId,
      })),
    };
  }

  mode(): 'CLASSIC' | 'BLIND' | 'CUSTOM' | 'WHO_SAID_IT' {
    return this.state.settings.mode;
  }

  tier(): 'FREE' | 'FULL' {
    return this.state.tier;
  }

  /** The account whose purchase unlocks this room, if one was linked. */
  hostAccountId(): string | null {
    return this.state.hostAccountId;
  }

  /**
   * The linked account's entitlement changed (a purchase, a restore, a refund) or an account was
   * linked: the engine moves the tier and tells every screen; the row follows.
   */
  applyEntitlement(
    tier: 'FREE' | 'FULL',
    hostAccountId: string | null,
    reason: 'GRANTED' | 'RESTORED' | 'LINKED' | 'REVOKED' | 'EXPIRED',
  ): Promise<void> {
    return this.enqueue(async () => {
      await this.apply({
        kind: 'ENTITLEMENT',
        at: this.deps.clock.now(),
        entropy: this.entropy(),
        tier,
        hostAccountId,
        reason,
      });
      await this.deps.store
        .saveEntitlement(this.id, this.state.tier, this.state.hostAccountId)
        .catch((error: unknown) => this.fail('entitlement', error));
    });
  }

  // ───────────── venue mode (ADR-0024) ─────────────

  /** The table's meter as the room holds it (null for every room that is not a metered café table). */
  venueMeter(): VenueMeter | null {
    return this.state.venue ?? null;
  }

  /** Staff opened a table: the venue's play mode, ruleset, team names and café window (ADR-0026 §7). */
  applyTablePreset(preset: {
    play: PlayMode;
    ruleset: Ruleset;
    teamNames: string[];
    simpleAnswerSeconds: number | null;
  }): Promise<void> {
    return this.enqueue(async () => {
      await this.apply({
        kind: 'TABLE_PRESET',
        at: this.deps.clock.now(),
        entropy: this.entropy(),
        ...preset,
      });
    });
  }

  /** Staff changed the table (or its time ran out): the engine stores the meter and tells every screen. */
  applyVenueMeter(meter: VenueMeter | null): Promise<void> {
    return this.enqueue(async () => {
      await this.apply({
        kind: 'VENUE_METER',
        at: this.deps.clock.now(),
        entropy: this.entropy(),
        meter,
      });
    });
  }

  /**
   * A reward was issued for the results of `gameId`: the code goes to the winner's phone only, the
   * display hears who won (for its banner). Nothing is sent when the room has moved on.
   */
  deliverVenueReward(
    gameId: string,
    playerId: string,
    payload: { code: string; text: string; expiresAt: number },
    teamId?: TeamId,
  ): Promise<boolean> {
    return this.enqueue(() => {
      if (this.state.phase !== 'RESULTS' || this.state.game?.gameId !== gameId)
        return Promise.resolve(false);
      this.venueReward = { gameId, playerId, payload, ...(teamId ? { teamId } : {}) };
      this.deliver({ to: 'PLAYER', playerId }, { type: 'VENUE_REWARD', payload });
      this.deliver(
        { to: 'DISPLAY' },
        { type: 'VENUE_REWARD_ISSUED', payload: { playerId, ...(teamId ? { teamId } : {}) } },
      );
      return Promise.resolve(true);
    });
  }

  /** A phone or TV that reconnects while the same results are on screen hears about the reward again. */
  private resendVenueReward(connection: Connection): void {
    const held = this.venueReward;
    if (!held || this.state.phase !== 'RESULTS' || this.state.game?.gameId !== held.gameId) return;
    if (connection.role === 'DISPLAY')
      this.send(connection, {
        type: 'VENUE_REWARD_ISSUED',
        payload: { playerId: held.playerId, ...(held.teamId ? { teamId: held.teamId } : {}) },
      });
    else if (connection.playerId === held.playerId)
      this.send(connection, { type: 'VENUE_REWARD', payload: held.payload });
  }

  /** Attaches a personal quiz (or returns to the classic game); the engine decides if the room may. */
  setContent(
    mode: 'CLASSIC' | 'BLIND' | 'CUSTOM' | 'WHO_SAID_IT',
    ref: string | null,
    title: string | null,
    rounds: number | null,
  ): Promise<{ ok: true } | { ok: false; code: ErrorCode }> {
    return this.enqueue(async () => {
      const result = await this.apply({
        kind: 'SET_CONTENT',
        at: this.deps.clock.now(),
        entropy: this.entropy(),
        mode,
        ref,
        title,
        rounds,
      });
      return result.ok ? { ok: true as const } : { ok: false as const, code: result.code };
    });
  }

  /** A moderator ends the room for everyone; the reason on record is ADMIN. */
  closeByAdmin(): Promise<void> {
    return this.enqueue(async () => {
      await this.apply({
        kind: 'CLOSE',
        at: this.deps.clock.now(),
        entropy: this.entropy(),
        reason: 'ADMIN',
      });
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
