import { randomUUID } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';
import {
  PROTOCOL_VERSION,
  type ClientMessageType,
  type Phase,
  type RoomView,
  type ServerMessage,
} from '@quizparty/protocol';

export interface ConnectOptions {
  origin?: string;
  /** Source address to bind (127.0.0.x on Linux) to simulate a client on another network. */
  localAddress?: string;
}

function decode(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/** A protocol-correct WebSocket client for tests; records every frame it receives. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  readonly frames: string[] = [];
  sessionId: string | null = null;
  roomId: string | null = null;
  playerId: string | null = null;
  token: string | null = null;
  role: 'DISPLAY' | 'PLAYER' | null = null;
  sequence = 0;
  closeInfo: { code: number; reason: string } | null = null;
  lastSentFrame: string | null = null;
  private cursor = 0;
  private readonly listeners = new Set<(message: ServerMessage) => void>();
  private waiters: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const frame = decode(data);
      this.frames.push(frame);
      const parsed = JSON.parse(frame) as ServerMessage;
      this.messages.push(parsed);
      for (const listener of this.listeners) listener(parsed);
      for (const wake of this.waiters.splice(0)) wake();
    });
    ws.on('close', (code, reason) => {
      this.closeInfo = { code, reason: reason.toString('utf8') };
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  static connect(url: string, options: ConnectOptions = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: options.origin ? { Origin: options.origin } : {},
        ...(options.localAddress ? { localAddress: options.localAddress } : {}),
      });
      const client = new TestClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, response) =>
        reject(new Error(`unexpected response ${response.statusCode}`)),
      );
    });
  }

  /** Sends a protocol-correct frame; returns the message id. Overrides allow crafting hostile frames. */
  send(
    type: ClientMessageType,
    payload: unknown,
    overrides: Partial<{
      sequence: number;
      messageId: string;
      sessionId: string | null;
      roomId: string | null;
      protocolVersion: number;
    }> = {},
  ): string {
    const messageId = overrides.messageId ?? randomUUID();
    this.sequence += 1;
    const frame = {
      type,
      protocolVersion: overrides.protocolVersion ?? PROTOCOL_VERSION,
      messageId,
      roomId: overrides.roomId === undefined ? this.roomId : overrides.roomId,
      sessionId: overrides.sessionId === undefined ? this.sessionId : overrides.sessionId,
      sequence: overrides.sequence ?? this.sequence,
      timestamp: Date.now(),
      payload,
    };
    this.lastSentFrame = JSON.stringify(frame);
    this.ws.send(this.lastSentFrame);
    return messageId;
  }

  /** Calls `listener` for every message received from now on; returns an unsubscribe function. */
  subscribe(listener: (message: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  private wait(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Resolves with the next unread message matching `predicate` (scanning from the cursor). */
  async next(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = 5_000,
    describe = 'message',
  ): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = this.cursor; i < this.messages.length; i++) {
        const message = this.messages[i]!;
        if (predicate(message)) {
          this.cursor = i + 1;
          return message;
        }
      }
      if (this.closeInfo && this.cursor >= this.messages.length) {
        throw new Error(
          `socket closed (${this.closeInfo.code} ${this.closeInfo.reason}) while waiting for ${describe}`,
        );
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `timed out waiting for ${describe}; received: ${this.messages
            .slice(-6)
            .map((m) => m.type)
            .join(', ')}`,
        );
      }
      await this.wait(remaining);
    }
  }

  nextOfType<T extends ServerMessage['type']>(
    type: T,
    timeoutMs?: number,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return this.next((m) => m.type === type, timeoutMs, type) as Promise<
      Extract<ServerMessage, { type: T }>
    >;
  }

  async waitForPhase(
    phase: Phase,
    timeoutMs = 8_000,
  ): Promise<Extract<ServerMessage, { type: 'PHASE_ENTERED' }>> {
    return (await this.next(
      (m) => m.type === 'PHASE_ENTERED' && m.payload.data.phase === phase,
      timeoutMs,
      `phase ${phase}`,
    )) as Extract<ServerMessage, { type: 'PHASE_ENTERED' }>;
  }

  /** Reads messages up to now without waiting (for negative assertions). */
  drain(): ServerMessage[] {
    const rest = this.messages.slice(this.cursor);
    this.cursor = this.messages.length;
    return rest;
  }

  async idle(ms: number): Promise<void> {
    await this.wait(ms);
  }

  async join(
    url: string,
    code: string,
    nickname: string,
    deviceId = `device-${randomUUID().replaceAll('-', '')}`,
    avatarId = 'fox',
  ): Promise<RoomView> {
    void url;
    this.send(
      'JOIN_ROOM',
      { code, nickname, avatarId, deviceId, client: { kind: 'WEB', version: 'test' } },
      { roomId: null, sessionId: null },
    );
    const joined = await this.nextOfType('ROOM_JOINED');
    this.sessionId = joined.payload.session.sessionId;
    this.playerId = joined.payload.session.playerId;
    this.token = joined.payload.session.reconnectToken;
    this.roomId = joined.payload.room.roomId;
    this.role = 'PLAYER';
    return joined.payload.room;
  }

  async attachDisplay(created: {
    roomId: string;
    display: { sessionId: string; reconnectToken: string };
  }): Promise<RoomView> {
    this.sessionId = created.display.sessionId;
    this.roomId = created.roomId;
    this.token = created.display.reconnectToken;
    return this.reconnect();
  }

  async reconnect(token = this.token): Promise<RoomView> {
    this.send('RECONNECT', { reconnectToken: token, client: { kind: 'WEB', version: 'test' } });
    const reconnected = await this.nextOfType('RECONNECTED');
    this.token = reconnected.payload.session.reconnectToken;
    this.role = reconnected.payload.role;
    this.playerId = reconnected.payload.session.playerId;
    return reconnected.payload.room;
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }

  /** Abruptly drops the TCP connection (no close handshake), like a phone losing signal. */
  drop(): void {
    this.ws.terminate();
  }
}

export async function connectedClients(url: string, count: number): Promise<TestClient[]> {
  return Promise.all(Array.from({ length: count }, () => TestClient.connect(url)));
}
