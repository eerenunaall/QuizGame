import { fileURLToPath } from 'node:url';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { createDatabase, createPool, type Database } from '@quizparty/db';
import type { Pool } from 'pg';
import type { AppConfig } from './config';
import { registerRoutes, apiError, type RouteSpec } from './http/routes';
import { DeckBuilder } from './rooms/deck-builder';
import { RoomManager } from './rooms/manager';
import { SessionService } from './rooms/sessions';
import { PgRoomStore } from './rooms/store';
import { SecurityLog } from './security/events';
import { MemoryRateLimiter } from './security/rate-limit';
import { DbTelemetrySink } from './telemetry/sink';
import { systemClock, type Clock } from './util/clock';
import { createMetrics } from './util/metrics';
import { Gateway } from './ws/gateway';

export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../database/migrations', import.meta.url),
);

export interface BuiltApp {
  app: FastifyInstance;
  config: AppConfig;
  db: Database;
  pool: Pool;
  manager: RoomManager;
  gateway: Gateway;
  routes: RouteSpec[];
  /** Graceful shutdown: stop accepting, flush rooms, release leases, close the pool. */
  close(): Promise<void>;
  /** Test hook: stop everything without flushing or releasing leases (simulated crash). */
  crash(): Promise<void>;
}

export interface BuildOptions {
  config: AppConfig;
  clock?: Clock;
}

/** Wires every component. Does not listen; callers use `app.listen` (see main.ts) or `app.inject`. */
export async function buildApp(options: BuildOptions): Promise<BuiltApp> {
  const { config } = options;
  const clock = options.clock ?? systemClock;
  const securityHeaders = (): Record<string, string> => ({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
    ...(config.env === 'production'
      ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
      : {}),
  });
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'reconnectToken',
        '*.reconnectToken',
        '*.token',
      ],
    },
    bodyLimit: 16 * 1024,
    logController: new LogController({ disableRequestLogging: config.env === 'test' }),
    trustProxy: false,
    // Malformed URLs never reach the router, so hooks do not run: answer them here with the same
    // headers and error shape as every other response.
    frameworkErrors: (_error, _request, reply) => {
      void reply.headers(securityHeaders());
      void apiError(reply, 400, 'INVALID_MESSAGE');
    },
  });

  // Structural guard: no route may exist without an explicit auth/limit policy (ADR-0018).
  const routes: RouteSpec[] = [];
  app.addHook('onRoute', (route) => {
    if (route.method === 'HEAD' || route.method === 'OPTIONS') return;
    const policy = route.config;
    if (!policy?.auth || !policy.limit) {
      throw new Error(
        `Route ${String(route.method)} ${route.url} must declare config.auth and config.limit`,
      );
    }
    routes.push({
      method: String(route.method),
      url: route.url,
      auth: policy.auth,
      limit: policy.limit,
    });
  });

  const pool = createPool(config.databaseUrl, {
    max: 12,
    applicationName: `quizparty-${config.instanceId}`,
  });
  const db = createDatabase(pool);
  const metrics = createMetrics();
  const limiter = new MemoryRateLimiter(() => clock.now(), config.rateLimitScale);
  limiter.start();
  const log = app.log;
  const onError = (error: unknown) => log.error({ err: error }, 'background task failed');

  const sessions = new SessionService(db, config.serverSecret, clock);
  const store = new PgRoomStore(db, config.instanceId, config.leaseMs, clock);
  const deckBuilder = new DeckBuilder(db, { allowDevSeed: config.allowDevSeed, clock });
  const telemetry = new DbTelemetrySink(db, onError);
  telemetry.start();
  const security = new SecurityLog(db, clock, metrics, onError);
  const manager = new RoomManager({
    config,
    clock,
    store,
    sessions,
    deckBuilder,
    telemetry,
    security,
    metrics,
    log,
  });
  const gateway = new Gateway({
    config,
    clock,
    manager,
    sessions,
    limiter,
    security,
    metrics,
    log,
  });

  // Security headers and CORS for the HTTP API.
  app.addHook('onRequest', (request, reply, done) => {
    const origin = request.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      void reply.header('Access-Control-Allow-Origin', origin);
      void reply.header('Vary', 'Origin');
      if (request.method === 'OPTIONS') {
        void reply
          .header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
          .header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
          .header('Access-Control-Max-Age', '600')
          .code(204)
          .send();
        return;
      }
    }
    done();
  });
  app.addHook('onSend', (_request, reply, payload, done) => {
    void reply.headers(securityHeaders());
    done(null, payload);
  });
  app.setNotFoundHandler((_request, reply) => apiError(reply, 404, 'NOT_FOUND'));
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    const status =
      typeof (error as { statusCode?: number }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (status >= 400 && status < 500) return apiError(reply, status, 'INVALID_MESSAGE');
    return apiError(reply, 500, 'INTERNAL'); // never leak internals or stack traces
  });

  registerRoutes(app, { config, manager, limiter, metrics, pool, migrationsDir: MIGRATIONS_DIR });
  await app.ready();
  gateway.attach(app.server);

  const recovered = await manager.recoverAll();
  if (recovered > 0) log.info({ recovered }, 'recovered rooms from the durable log');
  manager.startHeartbeat();

  let closed = false;
  const shutdown = async (graceful: boolean): Promise<void> => {
    if (closed) return;
    closed = true;
    limiter.stop();
    gateway.shutdown();
    if (graceful) await manager.stop();
    else manager.abandonForTest();
    await telemetry.stop();
    await app.close();
    await pool.end();
  };

  return {
    app,
    config,
    db,
    pool,
    manager,
    gateway,
    routes,
    close: () => shutdown(true),
    crash: () => shutdown(false),
  };
}
