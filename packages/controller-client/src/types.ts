import type { ClientInfo, ErrorCode, RoomView } from '@quizparty/protocol';

export type MaybePromise<T> = T | Promise<T>;

/** Persistent key/value storage: localStorage on the web, SecureStore in the native app. */
export interface KeyValueStorage {
  get(key: string): MaybePromise<string | null>;
  set(key: string, value: string): MaybePromise<void>;
  remove(key: string): MaybePromise<void>;
}

/** The subset of the WebSocket API we use; satisfied by browsers, React Native and `ws`. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
export type SocketFactory = (url: string) => SocketLike;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<FetchResponseLike>;

export interface ClientConfig {
  /** ws:// or wss:// URL of the realtime endpoint, e.g. `wss://api.example/ws`. */
  wsUrl: string;
  /** Base URL of the HTTP API ('' for same-origin). */
  apiUrl: string;
  client: ClientInfo;
  storage: KeyValueStorage;
  socketFactory: SocketFactory;
  fetch: FetchLike;
  /** Wall clock (ms); injectable for tests. */
  now?: () => number;
  /** Monotonic clock (ms) used for countdown rendering. */
  perf?: () => number;
  /** Backoff schedule for reconnect attempts (ms). */
  backoffMs?: readonly number[];
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
}

export type Transport = 'IDLE' | 'CONNECTING' | 'ONLINE' | 'RECONNECTING' | 'CLOSED';

export type ClosedReason =
  'KICKED' | 'LEFT' | 'TOKEN_REUSE' | 'ROOM_CLOSED' | 'SESSION_EXPIRED' | 'SUPERSEDED' | 'REVOKED';

export interface StoredSession {
  sessionId: string;
  roomId: string;
  token: string;
  role: 'DISPLAY' | 'PLAYER';
  playerId: string | null;
  code: string;
}

export interface ClientError {
  code: ErrorCode;
  at: number;
  params?: Record<string, string | number>;
}

export interface ClientState {
  transport: Transport;
  session: StoredSession | null;
  room: RoomView | null;
  closedReason: ClosedReason | null;
  error: ClientError | null;
  /** The last rejected answer (so the controller can say "too late" / "already answered"). */
  answerRejection: ClientError | null;
  /** Set when a reconnect restored the game state (drives the "Game state restored." toast). */
  restoredAt: number | null;
  /** Option tapped locally and sent, awaiting the server's lock acknowledgement. */
  pendingAnswer: { questionId: string; optionId: string } | null;
  rttMs: number | null;
}

export const INITIAL_CLIENT_STATE: ClientState = {
  transport: 'IDLE',
  session: null,
  room: null,
  closedReason: null,
  error: null,
  answerRejection: null,
  restoredAt: null,
  pendingAnswer: null,
  rttMs: null,
};

export interface CreatedRoom {
  roomId: string;
  code: string;
  tier: 'FREE' | 'FULL';
  joinUrl: string;
  display: { sessionId: string; reconnectToken: string };
  maxPlayers: number;
}

export class ClientRequestError extends Error {
  readonly code: ErrorCode;
  readonly params: Record<string, string | number> | undefined;

  constructor(code: ErrorCode, params?: Record<string, string | number>) {
    super(code);
    this.code = code;
    this.params = params;
  }
}
