import { fileURLToPath } from 'node:url';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { createDatabase, createPool, type Database } from '@quizparty/db';
import type { Pool } from 'pg';
import type { AppConfig } from './config';
import { installInputHygiene } from './http/hygiene';
import { registerRoutes, apiError, type RouteSpec } from './http/routes';
import { StaticWeb } from './http/static-web';
import { registerAdminRoutes } from './admin';
import { buildAuditEngine } from './admin/engine';
import { AccountSessionService } from './auth/account-sessions';
import { AccountService } from './auth/accounts';
import { ConsoleEmailSender, WebhookEmailSender, type EmailSender } from './auth/email';
import { installAuthGuard } from './auth/guard';
import { OtpService } from './auth/otp';
import { registerAuthRoutes } from './auth/routes';
import { FeatureFlags } from './flags/service';
import { BanService } from './moderation/bans';
import { MaintenanceJob } from './moderation/maintenance';
import { QuestionReports } from './moderation/reports';
import { CategoryCatalogService } from './rooms/catalog';
import { DeckBuilder } from './rooms/deck-builder';
import { RoomManager } from './rooms/manager';
import { SessionService } from './rooms/sessions';
import { PgRoomStore } from './rooms/store';
import { AppleVerifier } from './payments/apple';
import { GoogleVerifier } from './payments/google';
import { registerPaymentRoutes } from './payments/routes';
import { LinkService } from './payments/links';
import { EntitlementService } from './payments/service';
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
  flags: FeatureFlags;
  bans: BanService;
  accounts: AccountService;
  accountSessions: AccountSessionService;
  entitlements: EntitlementService;
  maintenance: MaintenanceJob;
  routes: RouteSpec[];
  /** Graceful shutdown: stop accepting, flush rooms, release leases, close the pool. */
  close(): Promise<void>;
  /** Test hook: stop everything without flushing or releasing leases (simulated crash). */
  crash(): Promise<void>;
}

export interface BuildOptions {
  config: AppConfig;
  clock?: Clock;
  /** Replaces the configured mail delivery (tests read codes from a mailbox double). */
  emailSender?: EmailSender;
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
    const roles = policy.roles ?? [];
    // Staff routes name the roles that may use them; "any staff" is not a policy, and neither is an
    // unlimited signed-in route (a stolen session must not be a free pass for scripts).
    if (policy.auth === 'admin' && roles.length === 0)
      throw new Error(`Admin route ${String(route.method)} ${route.url} must declare config.roles`);
    if ((policy.auth === 'admin' || policy.auth === 'session') && policy.limit === 'none')
      throw new Error(`Route ${String(route.method)} ${route.url} must declare a rate limit`);
    if (policy.auth !== 'admin' && roles.length > 0)
      throw new Error(
        `Route ${String(route.method)} ${route.url} declares roles without auth: admin`,
      );
    routes.push({
      method: String(route.method),
      url: route.url,
      auth: policy.auth,
      limit: policy.limit,
      roles,
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
  const flags = new FeatureFlags(db, clock);
  const bans = new BanService(db);
  const deckBuilder = new DeckBuilder(db, { allowDevSeed: config.allowDevSeed, clock, flags });
  const catalog = new CategoryCatalogService(db, deckBuilder, {
    allowDevSeed: config.allowDevSeed,
    clock,
    flags,
  });
  const telemetry = new DbTelemetrySink(db, onError);
  telemetry.start();
  const security = new SecurityLog(db, clock, metrics, onError);
  const accounts = new AccountService(db, clock, config.adminBootstrapEmails);
  const accountSessions = new AccountSessionService(db, accounts, config.serverSecret, clock);
  const mail: EmailSender | null =
    options.emailSender ??
    (config.emailWebhook
      ? new WebhookEmailSender({
          url: config.emailWebhook.url,
          ...(config.emailWebhook.token ? { token: config.emailWebhook.token } : {}),
        })
      : config.env === 'production'
        ? null // fail closed: no way to deliver a code means no email sign-in
        : new ConsoleEmailSender((line) => log.info(line)));
  const otp = mail ? new OtpService(db, config.serverSecret, clock, mail, onError) : null;
  const reports = new QuestionReports(db, flags, config.serverSecret, telemetry);
  const maintenance = new MaintenanceJob(
    db,
    clock,
    config.maintenanceIntervalMs,
    onError,
    (report) => {
      if (report.ran) log.info(report, 'question maintenance');
    },
  );
  const links = new LinkService({
    db,
    clock,
    secret: config.serverSecret,
    publicWebUrl: config.publicWebUrl,
  });
  const manager = new RoomManager({
    config,
    links,
    clock,
    store,
    sessions,
    deckBuilder,
    telemetry,
    reports,
    security,
    metrics,
    log,
  });
  const payments = config.payments;
  const apple =
    payments.enabled && payments.apple
      ? new AppleVerifier(payments.apple, payments.acceptSandbox)
      : null;
  const google =
    payments.enabled && payments.google ? new GoogleVerifier(payments.google, clock) : null;
  const entitlements = new EntitlementService({
    db,
    clock,
    secret: config.serverSecret,
    verifiers: { ...(apple ? { IOS: apple } : {}), ...(google ? { ANDROID: google } : {}) },
    acceptSandbox: payments.acceptSandbox,
    onChanged: (accountId, tier, reason) => manager.entitlementChanged(accountId, tier, reason),
    onSecurity: (kind, detail) => security.record(kind, { detail }),
    onError,
  });
  const gateway = new Gateway({
    config,
    clock,
    manager,
    sessions,
    limiter,
    bans,
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
    // Routes that set their own caching or CSP (the static web app) keep it; the API gets the strict defaults.
    for (const [name, value] of Object.entries(securityHeaders()))
      if (!reply.hasHeader(name)) void reply.header(name, value);
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

  if (config.serveAdmin) {
    const root = config.adminDist ?? fileURLToPath(new URL('../../admin/dist', import.meta.url));
    const publicUrl = new URL(config.publicWebUrl);
    const admin = new StaticWeb({
      root,
      webSocketOrigin: `${publicUrl.protocol === 'https:' ? 'wss' : 'ws'}://${publicUrl.host}`,
      production: config.env === 'production',
      mount: '/admin',
      label: 'admin',
    });
    await admin.init();
    const serveAdmin = (request: FastifyRequest, reply: FastifyReply) =>
      admin.handle(request, reply);
    app.get('/admin', { config: { auth: 'public', limit: 'none' } }, serveAdmin);
    app.get('/admin/*', { config: { auth: 'public', limit: 'none' } }, serveAdmin);
  }
  if (config.serveWeb) {
    const root = config.webDist ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
    const publicUrl = new URL(config.publicWebUrl);
    const web = new StaticWeb({
      root,
      webSocketOrigin: `${publicUrl.protocol === 'https:' ? 'wss' : 'ws'}://${publicUrl.host}`,
      production: config.env === 'production',
    });
    await web.init();
    app.get('/*', { config: { auth: 'public', limit: 'none' } }, (request, reply) =>
      web.handle(request, reply),
    );
  }

  installInputHygiene(app);
  installAuthGuard(app, { config, sessions: accountSessions, limiter, security });
  registerAuthRoutes(app, {
    config,
    otp,
    accounts,
    sessions: accountSessions,
    flags,
    bans,
    limiter,
    security,
  });
  registerAdminRoutes(app, {
    config,
    db,
    clock,
    manager,
    accounts,
    accountSessions,
    flags,
    engine: buildAuditEngine(config),
  });
  registerPaymentRoutes(app, {
    config,
    entitlements,
    links,
    manager,
    apple,
    google,
    limiter,
    security,
    onError,
  });
  registerRoutes(app, {
    config,
    manager,
    catalog,
    flags,
    bans,
    limiter,
    metrics,
    pool,
    migrationsDir: MIGRATIONS_DIR,
  });
  await app.ready();
  gateway.attach(app.server);

  const recovered = await manager.recoverAll();
  if (recovered > 0) log.info({ recovered }, 'recovered rooms from the durable log');
  manager.startHeartbeat();
  maintenance.start();

  let closed = false;
  const shutdown = async (graceful: boolean): Promise<void> => {
    if (closed) return;
    closed = true;
    limiter.stop();
    maintenance.stop();
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
    flags,
    bans,
    accounts,
    accountSessions,
    entitlements,
    maintenance,
    routes,
    close: () => shutdown(true),
    crash: () => shutdown(false),
  };
}
