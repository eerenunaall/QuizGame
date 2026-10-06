import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { parseRoomCode } from '@quizparty/shared';
import {
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_PLAYERS_LIMIT,
  parseClientMessage,
  type ClientMessage,
} from '@quizparty/protocol';
import { validateNickname } from '@quizparty/validation';
import type { AppConfig } from '../config';
import type { RoomManager } from '../rooms/manager';
import type { SessionService } from '../rooms/sessions';
import { pseudonym } from '../security/crypto';
import type { SecurityLog } from '../security/events';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import type { Clock } from '../util/clock';
import type { Metrics } from '../util/metrics';
import { Connection } from './connection';

export interface GatewayDeps {
  config: AppConfig;
  clock: Clock;
  manager: RoomManager;
  sessions: SessionService;
  limiter: RateLimiter;
  security: SecurityLog;
  metrics: Metrics;
  log: FastifyBaseLogger;
}

const MAX_STRIKES = 15;
const MAX_BUFFERED_BYTES = 1_000_000;

/** Decodes a text frame regardless of how `ws` delivers it (single buffer, fragments or ArrayBuffer). */
export function decodeFrame(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/** Extracts the client address, trusting `X-Forwarded-For` only for the configured proxy depth. */
export function clientIp(request: IncomingMessage, trustedHops: number): string {
  const direct = request.socket.remoteAddress ?? 'unknown';
  if (trustedHops <= 0) return direct;
  const header = request.headers['x-forwarded-for'];
  const chain = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return chain.length >= trustedHops ? chain[chain.length - trustedHops]! : direct;
}

/** WebSocket endpoint: upgrade policy, connection lifecycle, rate limits and message routing. */
export class Gateway {
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_CLIENT_MESSAGE_BYTES,
  });
  private readonly connections = new Set<Connection>();
  private readonly perIp = new Map<string, number>();
  private pingTimer: NodeJS.Timeout | null = null;
  private server: Server | null = null;
  private upgradeHandler: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null =
    null;

  constructor(private readonly deps: GatewayDeps) {}

  attach(server: Server): void {
    this.server = server;
    this.upgradeHandler = (req, socket, head) => this.onUpgrade(req, socket, head);
    server.on('upgrade', this.upgradeHandler);
    this.pingTimer = setInterval(() => this.pingAll(), this.deps.config.wsPingIntervalMs);
    this.pingTimer.unref();
  }

  connectionCount(): number {
    return this.connections.size;
  }

  private reject(socket: Duplex, status: number, text: string): void {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const { config, limiter, metrics } = this.deps;
    const path = (req.url ?? '/').split('?')[0];
    if (path !== '/ws') return this.reject(socket, 404, 'Not Found');

    // Browsers always send Origin; refuse cross-site WebSocket hijacking. Native apps and tools
    // send none and are authorised by session tokens instead (ADR-0008).
    const origin = req.headers.origin;
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
      metrics.security.inc({ kind: 'WS_ORIGIN_REJECTED' });
      return this.reject(socket, 403, 'Forbidden');
    }
    const ip = clientIp(req, config.trustProxyHops);
    const ipHash = pseudonym(config.serverSecret, 'ip', ip);
    if (this.connections.size >= config.maxWsConnections)
      return this.reject(socket, 503, 'Service Unavailable');
    if ((this.perIp.get(ipHash) ?? 0) >= config.maxWsPerIp)
      return this.reject(socket, 429, 'Too Many Requests');
    if (!limiter.take(`ws:${ipHash}`, LIMITS.wsConnect).allowed)
      return this.reject(socket, 429, 'Too Many Requests');

    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, ip, ipHash));
  }

  private onConnection(ws: WebSocket, ip: string, ipHash: string): void {
    const { config, clock, metrics } = this.deps;
    const connection = new Connection(
      ws,
      ip,
      ipHash,
      { validateOutbound: config.validateOutbound, maxBufferedBytes: MAX_BUFFERED_BYTES },
      clock,
    );
    this.connections.add(connection);
    this.perIp.set(ipHash, (this.perIp.get(ipHash) ?? 0) + 1);
    metrics.wsConnections.set(this.connections.size);

    // A socket that does not authenticate quickly is dropped (slow-loris style abuse).
    const authTimer = setTimeout(() => {
      if (!connection.sessionId) connection.close(4008, 'authentication timeout');
    }, config.wsAuthTimeoutMs);

    ws.on('pong', () => {
      connection.alive = true;
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        connection.close(1003, 'binary frames are not supported');
        return;
      }
      this.onMessage(connection, decodeFrame(data), clock.now());
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      connection.closed = true;
      this.connections.delete(connection);
      const remaining = (this.perIp.get(ipHash) ?? 1) - 1;
      if (remaining <= 0) this.perIp.delete(ipHash);
      else this.perIp.set(ipHash, remaining);
      metrics.wsConnections.set(this.connections.size);
      if (connection.roomId) this.deps.manager.get(connection.roomId)?.detach(connection);
    });
    ws.on('error', () => {
      // Errors are followed by 'close'; nothing to do and nothing to leak.
    });
  }

  private onMessage(connection: Connection, raw: string, receivedAt: number): void {
    const { limiter, metrics, log } = this.deps;
    if (!limiter.take(`msg:${connection.id}`, LIMITS.message).allowed) {
      metrics.messages.inc({ type: 'unknown', result: 'rate_limited' });
      connection.strikes += 1;
      if (connection.strikes >= MAX_STRIKES) connection.close(1008, 'rate limit exceeded');
      else connection.error('RATE_LIMITED', null, { retryAfterMs: 500 });
      return;
    }
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      metrics.messages.inc({ type: 'unknown', result: 'invalid' });
      connection.strikes += 1;
      if (
        !limiter.take(`invalid:${connection.id}`, LIMITS.invalidMessage).allowed ||
        connection.strikes >= MAX_STRIKES
      ) {
        connection.close(1008, 'too many invalid messages');
        return;
      }
      log.debug({ detail: parsed.error.detail }, 'invalid client message');
      connection.error(parsed.error.code, parsed.error.messageId);
      return;
    }
    const message = parsed.value;
    if (connection.strikes >= MAX_STRIKES) {
      connection.close(1008, 'too many violations');
      return;
    }
    void this.route(connection, message, receivedAt)
      .then(() => metrics.messages.inc({ type: message.type, result: 'ok' }))
      .catch((error: unknown) => {
        metrics.messages.inc({ type: message.type, result: 'error' });
        metrics.errors.inc({ kind: 'message' });
        log.error({ err: error, type: message.type }, 'message handling failed');
        connection.error('INTERNAL', message.messageId);
      });
  }

  private async route(
    connection: Connection,
    message: ClientMessage,
    receivedAt: number,
  ): Promise<void> {
    if (message.type === 'PING') {
      connection.send({
        type: 'PONG',
        payload: { clientSentAt: message.payload.clientSentAt, serverTime: this.deps.clock.now() },
      });
      return;
    }
    if (!connection.sessionId) {
      if (message.type === 'JOIN_ROOM') return this.join(connection, message);
      if (message.type === 'RECONNECT') return this.reconnect(connection, message);
      connection.strikes += 1;
      connection.error('UNAUTHORIZED', message.messageId);
      return;
    }
    const room = connection.roomId ? this.deps.manager.get(connection.roomId) : undefined;
    if (!room) {
      connection.error('ROOM_CLOSED', message.messageId);
      connection.close(4006, 'room closed');
      return;
    }
    if (
      message.type === 'SUBMIT_ANSWER' &&
      !this.deps.limiter.take(`answer:${connection.sessionId}`, LIMITS.answer).allowed
    ) {
      connection.error('RATE_LIMITED', message.messageId, { retryAfterMs: 1000 });
      return;
    }
    await room.handleClientMessage(connection, message, receivedAt);
  }

  private async join(
    connection: Connection,
    message: Extract<ClientMessage, { type: 'JOIN_ROOM' }>,
  ): Promise<void> {
    const { limiter, manager, security, config } = this.deps;
    const joinLimit = limiter.take(`join:${connection.ipHash}`, LIMITS.join);
    if (!joinLimit.allowed) {
      connection.error('RATE_LIMITED', message.messageId, { retryAfterMs: joinLimit.retryAfterMs });
      return;
    }
    const code = parseRoomCode(message.payload.code);
    const room = code ? manager.getByCode(code) : undefined;
    if (!room || room.isClosing()) {
      // Same answer for "malformed", "unknown" and "closed": nothing to enumerate. Misses are expensive.
      limiter.take(`join:${connection.ipHash}`, LIMITS.join, 2);
      security.record('ROOM_CODE_MISS', { ipHash: connection.ipHash });
      connection.error('ROOM_NOT_FOUND', message.messageId);
      return;
    }
    const nickname = validateNickname(message.payload.nickname);
    if (!nickname.ok) {
      connection.error('NICKNAME_INVALID', message.messageId, { reason: nickname.reason });
      return;
    }
    const outcome = await room.joinPlayer(connection, {
      nickname: nickname.nickname,
      key: nickname.key,
      avatarId: message.payload.avatarId,
      deviceId: message.payload.deviceId,
      clientKind: message.payload.client.kind,
    });
    if (!outcome.ok) connection.error(outcome.code, message.messageId, outcome.params);
    void config;
  }

  private async reconnect(
    connection: Connection,
    message: Extract<ClientMessage, { type: 'RECONNECT' }>,
  ): Promise<void> {
    const { limiter, sessions, manager, security, metrics } = this.deps;
    if (!message.sessionId || !message.roomId) {
      connection.error('INVALID_MESSAGE', message.messageId);
      return;
    }
    const attempt = limiter.take(`reconnect:${connection.ipHash}`, LIMITS.reconnect);
    if (!attempt.allowed) {
      connection.error('RATE_LIMITED', message.messageId, { retryAfterMs: attempt.retryAfterMs });
      return;
    }
    const rotated = await sessions.rotate(message.sessionId, message.payload.reconnectToken);
    if (rotated.kind === 'INVALID') {
      connection.error('SESSION_EXPIRED', message.messageId);
      connection.close(4005, 'session invalid');
      return;
    }
    if (rotated.kind === 'REUSE') {
      metrics.security.inc({ kind: 'RECONNECT_TOKEN_REUSE' });
      security.record('RECONNECT_TOKEN_REUSE_SEEN', {
        roomId: rotated.session.roomId,
        sessionId: rotated.session.id,
        ipHash: connection.ipHash,
      });
      manager.get(rotated.session.roomId)?.revokeSession(rotated.session.id, 'TOKEN_REUSE');
      connection.error('SESSION_REVOKED', message.messageId);
      connection.close(4002, 'revoked');
      return;
    }
    const room = manager.get(rotated.session.roomId);
    if (!room || room.isClosing()) {
      connection.error('ROOM_CLOSED', message.messageId);
      connection.close(4006, 'room closed');
      return;
    }
    if (message.roomId !== rotated.session.roomId) {
      connection.error('FORBIDDEN', message.messageId);
      return;
    }
    const outcome = await room.reconnect(connection, rotated.session, rotated.token);
    if (!outcome.ok) {
      connection.error(outcome.code, message.messageId);
      connection.close(4005, 'cannot reconnect');
    }
  }

  private pingAll(): void {
    for (const connection of this.connections) {
      if (!connection.alive) {
        connection.ws.terminate();
        continue;
      }
      connection.alive = false;
      try {
        connection.ws.ping();
      } catch {
        connection.ws.terminate();
      }
    }
  }

  shutdown(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.server && this.upgradeHandler) this.server.off('upgrade', this.upgradeHandler);
    for (const connection of this.connections) connection.close(1012, 'service restart');
    this.wss.close();
  }
}

export { MAX_PLAYERS_LIMIT };
