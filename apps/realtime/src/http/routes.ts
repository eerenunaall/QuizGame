import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { migrationsCurrent } from '@quizparty/db';
import { parseRoomCode } from '@quizparty/shared';
import {
  CreateRoomRequestSchema,
  LocaleSchema,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  type ErrorCode,
} from '@quizparty/protocol';
import type { Role } from '../auth/accounts';
import type { AppConfig } from '../config';
import type { FeatureFlags } from '../flags/service';
import type { BanService } from '../moderation/bans';
import type { CategoryCatalogService } from '../rooms/catalog';
import type { RoomManager } from '../rooms/manager';
import { clientIp } from '../ws/gateway';
import { pseudonym } from '../security/crypto';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import type { Metrics } from '../util/metrics';
import type { Pool } from 'pg';

/** `session`: any signed-in account. `admin`: a staff session holding one of the route's `roles`. */
export type RouteAuth = 'public' | 'metrics-token' | 'session' | 'admin';
export type RouteLimit = keyof typeof LIMITS | 'none';
declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: RouteAuth;
    limit?: RouteLimit;
    roles?: readonly Role[];
  }
}

export interface RouteSpec {
  method: string;
  url: string;
  auth: RouteAuth;
  limit: RouteLimit;
  roles: readonly Role[];
}

export interface RouteDeps {
  config: AppConfig;
  manager: RoomManager;
  catalog: CategoryCatalogService;
  flags: FeatureFlags;
  bans: BanService;
  limiter: RateLimiter;
  metrics: Metrics;
  pool: Pool;
  migrationsDir: string;
}

const MAX_ROOMS_PER_INSTANCE = 20_000;

export function apiError(
  reply: FastifyReply,
  status: number,
  code: ErrorCode | 'NOT_FOUND',
  params?: Record<string, string | number>,
): FastifyReply {
  return reply.code(status).send({ error: { code, ...(params ? { params } : {}) } });
}

function ipHashOf(request: FastifyRequest, deps: RouteDeps): string {
  return pseudonym(
    deps.config.serverSecret,
    'ip',
    clientIp(request.raw, deps.config.trustProxyHops),
  );
}

const CreateRoomBody = CreateRoomRequestSchema;
const CatalogQuery = z.strictObject({ language: LocaleSchema.default('tr') });

/**
 * HTTP surface. Every route must declare `config.auth` and `config.limit`; the onRoute guard in
 * `app.ts` refuses to boot otherwise, so a new endpoint cannot ship without an explicit policy.
 */
export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { config, manager, limiter, pool } = deps;

  app.get('/healthz', { config: { auth: 'public', limit: 'none' } }, () => ({ ok: true }));

  app.get('/readyz', { config: { auth: 'public', limit: 'none' } }, async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      if (!(await migrationsCurrent(pool, deps.migrationsDir)))
        throw new Error('migrations pending');
      return { ok: true, rooms: manager.size() };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  app.get(
    '/metrics',
    { config: { auth: 'metrics-token', limit: 'none' } },
    async (request, reply) => {
      const header = request.headers.authorization ?? '';
      if (!config.metricsToken || !sameSecret(header, `Bearer ${config.metricsToken}`))
        return apiError(reply, 401, 'UNAUTHORIZED');
      void reply.header('Content-Type', deps.metrics.registry.contentType);
      return deps.metrics.registry.metrics();
    },
  );

  app.get('/v1/config', { config: { auth: 'public', limit: 'none' } }, () => ({
    protocolVersion: PROTOCOL_VERSION,
    minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
    webUrl: config.publicWebUrl,
    wsPath: '/ws',
  }));

  app.post(
    '/v1/rooms',
    { config: { auth: 'public', limit: 'roomCreate' } },
    async (request, reply) => {
      const limit = limiter.take(`roomCreate:${ipHashOf(request, deps)}`, LIMITS.roomCreate);
      if (!limit.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: limit.retryAfterMs });
      if (await deps.bans.isBanned({ ip: ipHashOf(request, deps) }))
        return apiError(reply, 403, 'BANNED');
      const body = CreateRoomBody.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      if (manager.size() >= MAX_ROOMS_PER_INSTANCE) return apiError(reply, 503, 'INTERNAL');

      const created = await manager.createRoom({
        tier: config.defaultRoomTier,
        language: body.data.locale ?? 'tr',
        clientKind: body.data.client.kind,
        ipHash: ipHashOf(request, deps),
      });
      const { room } = created;
      return reply.code(201).send({
        roomId: room.id,
        code: room.code,
        tier: room.state.tier,
        joinUrl: `${config.publicWebUrl}/join/${room.code}`,
        display: { sessionId: created.displaySessionId, reconnectToken: created.displayToken },
        maxPlayers: room.state.config.maxPlayers,
      });
    },
  );

  // The public feature switches clients may adapt to (never anything sensitive: see `public` in the table).
  app.get('/v1/flags', { config: { auth: 'public', limit: 'flags' } }, async (request, reply) => {
    const limit = limiter.take(`flags:${ipHashOf(request, deps)}`, LIMITS.flags);
    if (!limit.allowed)
      return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: limit.retryAfterMs });
    return { flags: await deps.flags.publicFlags() };
  });

  app.get(
    '/v1/categories',
    { config: { auth: 'public', limit: 'catalog' } },
    async (request, reply) => {
      const limit = limiter.take(`catalog:${ipHashOf(request, deps)}`, LIMITS.catalog);
      if (!limit.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: limit.retryAfterMs });
      const query = CatalogQuery.safeParse(request.query);
      if (!query.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      return deps.catalog.list(query.data.language);
    },
  );

  app.get<{ Params: { code: string } }>(
    '/v1/rooms/:code/preview',
    { config: { auth: 'public', limit: 'roomLookup' } },
    async (request, reply) => {
      const key = `roomLookup:${ipHashOf(request, deps)}`;
      const limit = limiter.take(key, LIMITS.roomLookup);
      if (!limit.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: limit.retryAfterMs });
      const code = parseRoomCode(request.params.code);
      const room = code ? manager.getByCode(code) : undefined;
      if (!room || room.isClosing()) {
        limiter.take(key, LIMITS.roomLookup, 3); // misses are expensive: makes enumeration impractical
        return apiError(reply, 404, 'ROOM_NOT_FOUND');
      }
      const state = room.state;
      const joinable = state.phase === 'WAITING' || state.phase === 'LOBBY';
      return {
        code: room.code,
        joinable,
        phase: joinable ? 'LOBBY' : state.phase === 'RESULTS' ? 'FINISHED' : 'IN_GAME',
        playerCount: state.playerOrder.length,
        maxPlayers: state.config.maxPlayers,
      };
    },
  );
}

/** Constant-time comparison; hashing first makes both sides the same length so nothing leaks through it. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
