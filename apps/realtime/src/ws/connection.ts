import type { WebSocket } from 'ws';
import { randomUuid } from '@quizparty/shared';
import { buildServerMessage, validateServerMessage, type ServerEvent } from '@quizparty/protocol';
import type { Clock } from '../util/clock';

export class OutboundValidationError extends Error {}

export interface ConnectionOptions {
  validateOutbound: boolean;
  maxBufferedBytes: number;
}

const WS_OPEN = 1;

/** One WebSocket, its per-connection outbound sequence and (once authenticated) its session. */
export class Connection {
  readonly id = randomUuid();
  sessionId: string | null = null;
  roomId: string | null = null;
  role: 'DISPLAY' | 'PLAYER' | null = null;
  playerId: string | null = null;
  /** True once the snapshot has been delivered; broadcasts skip connections that are not ready. */
  ready = false;
  alive = true;
  closed = false;
  strikes = 0;
  private sequence = 0;

  constructor(
    readonly ws: WebSocket,
    readonly ip: string,
    readonly ipHash: string,
    private readonly options: ConnectionOptions,
    private readonly clock: Clock,
  ) {}

  send(event: ServerEvent, extra: { stateVersion?: number } = {}): void {
    if (this.closed || this.ws.readyState !== WS_OPEN) return;
    this.sequence += 1;
    const message = buildServerMessage(event, {
      messageId: randomUuid(),
      roomId: this.roomId,
      sessionId: this.sessionId,
      sequence: this.sequence,
      timestamp: this.clock.now(),
      ...(extra.stateVersion === undefined ? {} : { stateVersion: extra.stateVersion }),
    });
    if (this.options.validateOutbound) {
      const checked = validateServerMessage(message);
      if (!checked.ok) throw new OutboundValidationError(`${event.type}: ${checked.error}`);
    }
    if (this.ws.bufferedAmount > this.options.maxBufferedBytes) {
      this.close(1013, 'slow consumer');
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  error(
    code: Extract<ServerEvent, { type: 'ERROR' }>['payload']['code'],
    messageId: string | null,
    params?: Record<string, string | number>,
  ): void {
    this.send({ type: 'ERROR', payload: { messageId, code, ...(params ? { params } : {}) } });
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(code, reason);
    } catch {
      this.ws.terminate();
    }
    // A peer that never answers the close handshake must not hold the socket forever.
    const timer = setTimeout(() => this.ws.terminate(), 3_000);
    timer.unref();
  }
}
