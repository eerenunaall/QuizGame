import { PROTOCOL_VERSION } from '@quizparty/protocol/constants';
import type {
  AvatarId,
  CategoryCatalog,
  ClientMessageType,
  ClientPayload,
  ErrorCode,
  Locale,
  RoomPreview,
  ServerMessage,
} from '@quizparty/protocol';
import { applyServerMessage } from './apply';
import { ClockSync } from './clock';
import { Store } from './store';
import {
  ClientRequestError,
  INITIAL_CLIENT_STATE,
  type ClientConfig,
  type ClientState,
  type ClosedReason,
  type CreatedRoom,
  type SocketLike,
  type StoredSession,
} from './types';

const OPEN = 1;
const DEFAULT_BACKOFF = [300, 700, 1500, 3000, 5000] as const;

const KEYS = {
  device: 'qp.device',
  sequence: 'qp.seq',
  display: 'qp.display',
  player: (code: string) => `qp.player.${code}`,
} as const;

interface Waiter {
  resolve(): void;
  reject(error: ClientRequestError): void;
  timer: ReturnType<typeof setTimeout>;
}

type Parse = (raw: string) => ServerMessage | null;
const defaultParse: Parse = (raw) => {
  try {
    const value = JSON.parse(raw) as { type?: unknown; payload?: unknown; sequence?: unknown };
    return typeof value.type === 'string' &&
      typeof value.payload === 'object' &&
      typeof value.sequence === 'number'
      ? (value as unknown as ServerMessage)
      : null;
  } catch {
    return null;
  }
};

/**
 * Transport-agnostic game client shared by the browser controller, the TV display and the native
 * app. It owns reconnection (back-off, token rotation, liveness pings), clock synchronisation and
 * the view store; UI layers only render `store` and call intent methods. The server stays
 * authoritative: nothing here decides validity, timing or score (ADR-0006/0008).
 */
export class GameClient {
  readonly store = new Store<ClientState>(INITIAL_CLIENT_STATE);
  readonly clock: ClockSync;
  /** Optional strict parser (tests and dev builds validate every inbound message). */
  parse: Parse = defaultParse;

  private socket: SocketLike | null = null;
  private generation = 0;
  private sequence = 0;
  private lastServerSequence = 0;
  private attempt = 0;
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pings = new Map<number, number>();
  private readonly waiters = new Map<string, Waiter>();
  private joinWaiter: {
    messageId: string;
    resolve(): void;
    reject(error: ClientRequestError): void;
  } | null = null;
  private lastPingStamp = 0;
  private sinceSequencePersist = 0;
  private readonly config: ClientConfig;
  private readonly now: () => number;
  private readonly perf: () => number;

  constructor(config: ClientConfig) {
    this.config = config;
    this.now = config.now ?? (() => Date.now());
    this.perf =
      config.perf ??
      (() => (globalThis as unknown as { performance: { now(): number } }).performance.now());
    this.clock = new ClockSync(this.perf, this.now);
  }

  /** Estimated server time in epoch ms, for countdown rendering. */
  serverNow(): number {
    return this.clock.serverNow();
  }

  get state(): ClientState {
    return this.store.get();
  }

  // ───────────── identity & storage ─────────────

  async deviceId(): Promise<string> {
    const existing = await this.config.storage.get(KEYS.device);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const bytes = new Uint8Array(18);
    const crypto = (
      globalThis as unknown as { crypto?: { getRandomValues<T extends ArrayBufferView>(a: T): T } }
    ).crypto;
    if (crypto) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    const id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    await this.config.storage.set(KEYS.device, id);
    return id;
  }

  async storedSession(role: 'DISPLAY' | 'PLAYER', code?: string): Promise<StoredSession | null> {
    const key = role === 'DISPLAY' ? KEYS.display : code ? KEYS.player(code) : null;
    if (!key) return null;
    const raw = await this.config.storage.get(key);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as StoredSession;
      return value.sessionId && value.roomId && value.token && value.code ? value : null;
    } catch {
      return null;
    }
  }

  private storageKey(session: StoredSession): string {
    return session.role === 'DISPLAY' ? KEYS.display : KEYS.player(session.code);
  }

  private async persistSession(session: StoredSession): Promise<void> {
    await this.config.storage.set(this.storageKey(session), JSON.stringify(session));
  }

  private async clearSession(session: StoredSession | null): Promise<void> {
    if (session) await this.config.storage.remove(this.storageKey(session));
  }

  private async loadSequence(): Promise<void> {
    const stored = Number(await this.config.storage.get(KEYS.sequence));
    if (Number.isFinite(stored)) this.sequence = Math.max(this.sequence, stored);
  }

  /** Strictly increasing, seeded from the wall clock so it survives lost storage (ADR-0008). */
  private nextSequence(): number {
    this.sequence = Math.max(this.sequence + 1, this.now());
    this.sinceSequencePersist += 1;
    if (this.sinceSequencePersist >= 8) {
      this.sinceSequencePersist = 0;
      void Promise.resolve(this.config.storage.set(KEYS.sequence, String(this.sequence))).catch(
        () => undefined,
      );
    }
    return this.sequence;
  }

  // ───────────── HTTP ─────────────

  private async http(path: string, init: { method: string; body?: unknown }): Promise<unknown> {
    const response = await this.config.fetch(`${this.config.apiUrl}${path}`, {
      method: init.method,
      headers: { 'content-type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: ErrorCode; params?: Record<string, string | number> };
    };
    if (!response.ok)
      throw new ClientRequestError(body.error?.code ?? 'INTERNAL', body.error?.params);
    return body;
  }

  async createRoom(locale?: 'tr' | 'en'): Promise<CreatedRoom> {
    const created = (await this.http('/v1/rooms', {
      method: 'POST',
      body: { client: this.config.client, ...(locale ? { locale } : {}) },
    })) as CreatedRoom;
    const session: StoredSession = {
      sessionId: created.display.sessionId,
      roomId: created.roomId,
      token: created.display.reconnectToken,
      role: 'DISPLAY',
      playerId: null,
      code: created.code,
    };
    await this.persistSession(session);
    await this.connectWith(session);
    return created;
  }

  async preview(code: string): Promise<RoomPreview | null> {
    try {
      return (await this.http(`/v1/rooms/${encodeURIComponent(code)}/preview`, {
        method: 'GET',
      })) as RoomPreview;
    } catch (error) {
      if (error instanceof ClientRequestError && error.code === 'ROOM_NOT_FOUND') return null;
      throw error;
    }
  }

  /** The categories a lobby can offer (and which one is free this week). */
  async categories(language: Locale = 'tr'): Promise<CategoryCatalog> {
    return (await this.http(`/v1/categories?language=${language}`, {
      method: 'GET',
    })) as CategoryCatalog;
  }

  // ───────────── connecting ─────────────

  /** Resumes a stored session (page reload, app restart). Returns false when there is none. */
  async resume(role: 'DISPLAY' | 'PLAYER', code?: string): Promise<boolean> {
    const session = await this.storedSession(role, code);
    if (!session) return false;
    await this.connectWith(session);
    return true;
  }

  /** Joins a room as a new player. Resolves once the server has admitted us. */
  async join(code: string, nickname: string, avatarId: AvatarId): Promise<void> {
    await this.loadSequence();
    const deviceId = await this.deviceId();
    this.intentionalClose = false;
    this.store.update((s) => ({ ...s, transport: 'CONNECTING', closedReason: null, error: null }));
    const generation = this.openSocket();
    await new Promise<void>((resolve, reject) => {
      const messageId = this.uuid();
      this.joinWaiter = { messageId, resolve, reject };
      this.onOpenOnce(generation, () => {
        this.sendFrame(
          'JOIN_ROOM',
          {
            code,
            nickname,
            avatarId,
            deviceId,
            client: this.config.client,
          } satisfies ClientPayload<'JOIN_ROOM'>,
          { messageId, roomId: null, sessionId: null },
        );
      });
    }).catch((error: unknown) => {
      this.closeSocket(1000, 'join failed');
      this.store.update((s) => ({ ...s, transport: 'IDLE' }));
      throw error;
    });
  }

  private async connectWith(session: StoredSession): Promise<void> {
    await this.loadSequence();
    this.intentionalClose = false;
    this.clearTimers();
    this.store.update((s) => ({
      ...s,
      session,
      closedReason: null,
      transport: this.attempt === 0 ? 'CONNECTING' : 'RECONNECTING',
    }));
    const generation = this.openSocket();
    this.onOpenOnce(generation, () => {
      void (async () => {
        // Re-read: another tab may have rotated the token since we last looked.
        const fresh = (await this.storedSession(session.role, session.code)) ?? session;
        if (generation !== this.generation) return;
        this.sendFrame(
          'RECONNECT',
          {
            reconnectToken: fresh.token,
            client: this.config.client,
          } satisfies ClientPayload<'RECONNECT'>,
          { roomId: fresh.roomId, sessionId: fresh.sessionId },
        );
      })();
    });
  }

  private openSocket(): number {
    this.closeSocket(1000, 'reconnecting');
    const generation = ++this.generation;
    this.lastServerSequence = 0;
    const socket = this.config.socketFactory(this.config.wsUrl);
    this.socket = socket;
    socket.onmessage = (event) => {
      if (generation === this.generation && typeof event.data === 'string')
        this.onMessage(event.data);
    };
    socket.onclose = (event) => {
      if (generation === this.generation) this.onClose(event.code);
    };
    socket.onerror = () => {
      // The matching close event drives reconnection.
    };
    return generation;
  }

  private onOpenOnce(generation: number, callback: () => void): void {
    const socket = this.socket;
    if (!socket) return;
    socket.onopen = () => {
      if (generation !== this.generation) return;
      callback();
    };
  }

  private closeSocket(code: number, reason: string): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close(code, reason);
    } catch {
      // already closed
    }
    this.stopLiveness();
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopLiveness();
  }

  private stopLiveness(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  // ───────────── inbound ─────────────

  private onMessage(raw: string): void {
    const message = this.parse(raw);
    if (!message) return;

    if (this.lastServerSequence !== 0 && message.sequence !== this.lastServerSequence + 1) {
      // A gap means we missed something: ask for a fresh snapshot instead of guessing.
      this.sendFrame('REQUEST_STATE', {});
    }
    this.lastServerSequence = message.sequence;

    switch (message.type) {
      case 'PONG': {
        const sentPerf = this.pings.get(message.payload.clientSentAt);
        this.pings.delete(message.payload.clientSentAt);
        if (sentPerf !== undefined) {
          this.clock.observe(sentPerf, this.perf(), message.payload.serverTime);
          this.store.update((s) => ({ ...s, rttMs: this.clock.rtt() }));
        }
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pongTimer = null;
        return;
      }
      case 'ROOM_JOINED': {
        const session: StoredSession = {
          sessionId: message.payload.session.sessionId,
          roomId: message.payload.room.roomId,
          token: message.payload.session.reconnectToken,
          role: 'PLAYER',
          playerId: message.payload.session.playerId,
          code: message.payload.room.code,
        };
        this.attempt = 0;
        void this.persistSession(session);
        this.store.update((s) => ({
          ...applyServerMessage({ ...s, session }, message, this.now()),
          transport: 'ONLINE',
        }));
        this.startLiveness();
        this.joinWaiter?.resolve();
        this.joinWaiter = null;
        return;
      }
      case 'RECONNECTED': {
        const session: StoredSession = {
          sessionId: message.payload.session.sessionId,
          roomId: message.payload.room.roomId,
          token: message.payload.session.reconnectToken,
          role: message.payload.role,
          playerId: message.payload.session.playerId,
          code: message.payload.room.code,
        };
        this.attempt = 0;
        void this.persistSession(session);
        this.store.update((s) => ({
          ...applyServerMessage({ ...s, session }, message, this.now()),
          transport: 'ONLINE',
        }));
        this.startLiveness();
        return;
      }
      case 'ACK':
        this.settle(message.payload.messageId);
        break;
      case 'ANSWER_ACCEPTED':
        this.settle(message.payload.messageId);
        break;
      case 'ANSWER_REJECTED':
        this.settle(message.payload.messageId, message.payload.code);
        break;
      case 'ERROR': {
        const { messageId, code, params } = message.payload;
        if (this.joinWaiter && messageId === this.joinWaiter.messageId) {
          this.joinWaiter.reject(new ClientRequestError(code, params));
          this.joinWaiter = null;
        } else if (messageId) {
          this.settle(messageId, code, params);
        }
        if (code === 'SESSION_EXPIRED' || code === 'SESSION_REVOKED') {
          void this.terminate(code === 'SESSION_EXPIRED' ? 'SESSION_EXPIRED' : 'REVOKED');
          return;
        }
        if (code === 'ROOM_CLOSED' && !messageId) {
          void this.terminate('ROOM_CLOSED');
          return;
        }
        break;
      }
      case 'SESSION_REVOKED':
        this.store.update((s) => applyServerMessage(s, message, this.now()));
        void this.terminate(
          message.payload.reason === 'ROOM_CLOSED' ? 'ROOM_CLOSED' : message.payload.reason,
        );
        return;
      case 'SESSION_SUPERSEDED':
        this.store.update((s) => applyServerMessage(s, message, this.now()));
        void this.terminate('SUPERSEDED', false);
        return;
      // Pure state events: applied by the reducer below. Listed explicitly so that adding a server
      // message type forces a decision here.
      case 'ROOM_STATE':
      case 'PLAYER_JOINED':
      case 'PLAYER_LEFT':
      case 'PLAYER_STATUS':
      case 'LEADER_CHANGED':
      case 'SETTINGS_CHANGED':
      case 'NICKNAME_CHANGED':
      case 'PHASE_ENTERED':
      case 'ANSWER_LOCKED':
      case 'PLAYER_STATE':
      case 'ENTITLEMENT_CHANGED':
      case 'DISPLAY_STATUS':
      case 'ROOM_CLOSING':
        break;
    }

    this.store.update((s) => applyServerMessage(s, message, this.now()));
    if (message.type === 'PHASE_ENTERED' && message.payload.data.phase === 'ROOM_CLOSED') {
      void this.terminate('ROOM_CLOSED');
    }
  }

  /** Rejects every in-flight request so no promise is left hanging when the connection ends. */
  private failPending(code: ErrorCode): void {
    for (const id of [...this.waiters.keys()]) this.settle(id, code);
    if (this.joinWaiter) {
      this.joinWaiter.reject(new ClientRequestError(code));
      this.joinWaiter = null;
    }
  }

  private settle(
    messageId: string,
    code?: ErrorCode,
    params?: Record<string, string | number>,
  ): void {
    const waiter = this.waiters.get(messageId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.waiters.delete(messageId);
    if (code) waiter.reject(new ClientRequestError(code, params));
    else waiter.resolve();
  }

  private onClose(code: number): void {
    this.socket = null;
    this.stopLiveness();
    this.failPending('INTERNAL');
    if (this.intentionalClose) return;
    const state = this.store.get();
    if (state.closedReason) return;
    switch (code) {
      case 4001:
        void this.terminate('SUPERSEDED', false);
        return;
      case 4002:
        void this.terminate('REVOKED');
        return;
      case 4003:
        void this.terminate('KICKED');
        return;
      case 4004:
        void this.terminate('LEFT');
        return;
      case 4005:
        void this.terminate('SESSION_EXPIRED');
        return;
      case 4006:
        void this.terminate('ROOM_CLOSED');
        return;
      default:
        this.scheduleReconnect(code === 1008 ? 5_000 : 0);
    }
  }

  private scheduleReconnect(minDelayMs: number): void {
    const state = this.store.get();
    if (!state.session || this.intentionalClose || state.closedReason) return;
    this.store.update((s) => ({ ...s, transport: 'RECONNECTING' }));
    if (this.reconnectTimer) return;
    const schedule = this.config.backoffMs ?? DEFAULT_BACKOFF;
    const base = schedule[Math.min(this.attempt, schedule.length - 1)] ?? 5_000;
    const jitter = Math.floor(Math.random() * 250);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        const session = this.store.get().session;
        if (session) void this.connectWith(session);
      },
      Math.max(base, minDelayMs) + jitter,
    );
  }

  /** Stops talking to the server for good (kicked, revoked, room closed …). */
  private async terminate(
    reason: ClosedReason,
    clearStorage = true,
    keepRoom = true,
  ): Promise<void> {
    this.intentionalClose = true;
    this.clearTimers();
    const session = this.store.get().session;
    this.closeSocket(1000, 'terminated');
    // The server may close the room before it acknowledges the command that caused it (END_ROOM).
    this.failPending(
      reason === 'ROOM_CLOSED'
        ? 'ROOM_CLOSED'
        : reason === 'SESSION_EXPIRED'
          ? 'SESSION_EXPIRED'
          : 'SESSION_REVOKED',
    );
    this.store.update((s) => ({
      ...s,
      transport: 'CLOSED',
      closedReason: reason,
      session: clearStorage ? null : s.session,
      room: keepRoom ? s.room : null,
    }));
    if (clearStorage) await this.clearSession(session);
  }

  // ───────────── liveness & clock ─────────────

  private startLiveness(): void {
    this.stopLiveness();
    this.ping();
    this.pingTimer = setInterval(() => this.ping(), this.config.pingIntervalMs ?? 5_000);
  }

  private ping(): void {
    if (!this.socket || this.socket.readyState !== OPEN) return;
    this.lastPingStamp = Math.max(this.lastPingStamp + 1, this.now());
    this.pings.set(this.lastPingStamp, this.perf());
    this.sendFrame('PING', { clientSentAt: this.lastPingStamp });
    if (this.pongTimer) return;
    // A connection that silently died (Wi-Fi ↔ 5G switch, sleeping tab) never answers: recycle it.
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      const socket = this.socket;
      this.socket = null;
      this.generation += 1;
      if (socket) {
        socket.onclose = null;
        try {
          socket.close(4000, 'pong timeout');
        } catch {
          // ignore
        }
      }
      this.scheduleReconnect(0);
    }, this.config.pongTimeoutMs ?? 10_000);
  }

  /** Call when the page becomes visible or the network comes back: reconnect now / probe liveness. */
  nudge(): void {
    const state = this.store.get();
    if (state.transport === 'RECONNECTING') {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      if (state.session) void this.connectWith(state.session);
    } else if (state.transport === 'ONLINE') {
      this.ping();
    }
  }

  // ───────────── outbound ─────────────

  private uuid(): string {
    const crypto = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (crypto?.randomUUID) return crypto.randomUUID();
    const hex = (n: number) =>
      Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
  }

  private sendFrame(
    type: ClientMessageType,
    payload: unknown,
    overrides: { messageId?: string; roomId?: string | null; sessionId?: string | null } = {},
  ): string {
    const socket = this.socket;
    const session = this.store.get().session;
    const messageId = overrides.messageId ?? this.uuid();
    if (!socket || socket.readyState !== OPEN) return messageId;
    socket.send(
      JSON.stringify({
        type,
        protocolVersion: PROTOCOL_VERSION,
        messageId,
        roomId: overrides.roomId === undefined ? (session?.roomId ?? null) : overrides.roomId,
        sessionId:
          overrides.sessionId === undefined ? (session?.sessionId ?? null) : overrides.sessionId,
        sequence: this.nextSequence(),
        timestamp: this.now(),
        payload,
      }),
    );
    return messageId;
  }

  /** Sends an intent and resolves when the server acknowledges it (or rejects with its error code). */
  request<T extends ClientMessageType>(
    type: T,
    payload: ClientPayload<T>,
    timeoutMs = 8_000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket || socket.readyState !== OPEN) {
        reject(new ClientRequestError('INTERNAL'));
        return;
      }
      const messageId = this.uuid();
      const timer = setTimeout(() => {
        this.waiters.delete(messageId);
        reject(new ClientRequestError('INTERNAL'));
      }, timeoutMs);
      this.waiters.set(messageId, { resolve, reject, timer });
      this.sendFrame(type, payload, { messageId });
    });
  }

  /** Intent: lock in an answer. The tap is reflected locally at once; the server confirms the lock. */
  submitAnswer(optionId: string): Promise<void> {
    const data = this.store.get().room?.phaseData;
    if (!data || data.phase !== 'ANSWERING')
      return Promise.reject(new ClientRequestError('INVALID_STATE'));
    this.store.update((s) => ({
      ...s,
      pendingAnswer: { questionId: data.questionId, optionId },
      answerRejection: null,
    }));
    return this.request('SUBMIT_ANSWER', {
      questionId: data.questionId,
      optionId,
      clientSentAt: this.now(),
    });
  }

  setReady(ready: boolean): Promise<void> {
    return this.request('READY', { ready });
  }
  startGame(): Promise<void> {
    return this.request('START_GAME', {});
  }
  rematch(): Promise<void> {
    return this.request('REMATCH', {});
  }
  backToLobby(): Promise<void> {
    return this.request('BACK_TO_LOBBY', {});
  }
  /** Ends the room for everyone. The room closing *is* the success signal, so that is not an error. */
  async endRoom(): Promise<void> {
    try {
      await this.request('END_ROOM', {});
    } catch (error) {
      if (this.store.get().closedReason !== 'ROOM_CLOSED') throw error;
    }
  }
  /** Lobby settings; send only what changed. */
  setSettings(settings: ClientPayload<'SET_SETTINGS'>): Promise<void> {
    return this.request('SET_SETTINGS', settings);
  }
  kick(playerId: string): Promise<void> {
    return this.request('KICK_PLAYER', { playerId });
  }
  transferLeader(playerId: string): Promise<void> {
    return this.request('TRANSFER_LEADER', { playerId });
  }
  requestState(): void {
    this.sendFrame('REQUEST_STATE', {});
  }

  // ───────────── leaving ─────────────

  /** Pauses the connection (page hidden/unloading) but keeps the session for resuming. */
  suspend(): void {
    this.intentionalClose = true;
    this.clearTimers();
    this.closeSocket(1000, 'suspended');
    this.store.update((s) => ({ ...s, transport: 'IDLE' }));
    void Promise.resolve(this.config.storage.set(KEYS.sequence, String(this.sequence))).catch(
      () => undefined,
    );
  }

  /** Leaves the room for good. */
  async leave(): Promise<void> {
    try {
      await this.request('LEAVE_ROOM', {}, 2_000);
    } catch {
      // leaving is best effort; the local session is dropped regardless
    }
    await this.terminate('LEFT');
  }

  /** Drops the stored session without talking to the server (e.g. "Join again"). */
  async forget(): Promise<void> {
    this.intentionalClose = true;
    this.clearTimers();
    const session = this.store.get().session;
    this.closeSocket(1000, 'forgotten');
    await this.clearSession(session);
    this.store.set(INITIAL_CLIENT_STATE);
  }
}
