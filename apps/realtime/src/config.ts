import { hostname } from 'node:os';
import { z } from 'zod';

const DEV_SECRET = 'dev-only-change-me-dev-only-change-me';
const DEV_DATABASE_URL = 'postgres://quizparty:quizparty@127.0.0.1:5432/quizparty_dev';

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
const flag = (fallback: '0' | '1') =>
  z
    .enum(['0', '1'])
    .default(fallback)
    .transform((value) => value === '1');
const int = (fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(8080, 0, 65535),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1).optional(),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  ALLOWED_ORIGINS: csv,
  SERVER_SECRET: z.string().min(32).optional(),
  TRUST_PROXY_HOPS: int(0, 0, 5),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  INSTANCE_ID: z.string().min(1).max(64).optional(),
  DEFAULT_ROOM_TIER: z.enum(['FREE', 'FULL']).optional(),
  QP_ALLOW_DEV_SEED: flag('0'),
  VALIDATE_OUTBOUND: z.enum(['0', '1']).optional(),
  GAME_CONFIG_OVERRIDE: z.string().optional(),
  METRICS_TOKEN: z.string().min(16).optional(),
  HEARTBEAT_INTERVAL_MS: int(3_000, 50),
  LEASE_MS: int(10_000, 200),
  WS_PING_INTERVAL_MS: int(15_000, 50),
  WS_AUTH_TIMEOUT_MS: int(5_000, 50),
  MAX_WS_CONNECTIONS: int(5_000, 1),
  MAX_WS_PER_IP: int(40, 1),
  SERVE_WEB: flag('0'),
  WEB_DIST: z.string().optional(),
  SERVE_ADMIN: flag('0'),
  ADMIN_DIST: z.string().optional(),
  RATE_LIMIT_SCALE: z.coerce.number().min(0.1).max(1000).default(1),
  /** 0 switches the background maintenance pass off (tests run it by hand). */
  MAINTENANCE_INTERVAL_MS: int(15 * 60_000, 0),
  /** Addresses that become ADMIN on their first sign-in (how the first administrator exists). */
  ADMIN_BOOTSTRAP_EMAILS: csv,
  /** Where sign-in mail goes: any service that takes a JSON POST `{to, subject, text}`. */
  EMAIL_WEBHOOK_URL: z.string().url().optional(),
  EMAIL_WEBHOOK_TOKEN: z.string().min(8).optional(),
  /** Model-backed audit passes (ADR-0014): without a key the passes stay NOT_RUN. Names are never built in. */
  AUDIT_API_KEY: z.string().min(8).optional(),
  AUDIT_MODEL_FAST: z.string().min(1).max(100).optional(),
  AUDIT_MODEL_STRONG: z.string().min(1).max(100).optional(),
  AUDIT_API_BASE: z.string().url().optional(),
  EMBEDDINGS_BASE_URL: z.string().url().optional(),
  EMBEDDINGS_MODEL: z.string().min(1).max(100).optional(),
  EMBEDDINGS_API_KEY: z.string().min(8).optional(),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  publicWebUrl: string;
  allowedOrigins: string[];
  serverSecret: string;
  trustProxyHops: number;
  logLevel: string;
  instanceId: string;
  defaultRoomTier: 'FREE' | 'FULL';
  allowDevSeed: boolean;
  validateOutbound: boolean;
  gameConfigOverride: unknown;
  metricsToken: string | null;
  heartbeatIntervalMs: number;
  leaseMs: number;
  wsPingIntervalMs: number;
  wsAuthTimeoutMs: number;
  maxWsConnections: number;
  maxWsPerIp: number;
  serveWeb: boolean;
  serveAdmin: boolean;
  adminDist: string | null;
  webDist: string | null;
  /** Multiplies every rate-limit bucket; must stay 1 in production (tests/dev only). */
  rateLimitScale: number;
  maintenanceIntervalMs: number;
  adminBootstrapEmails: string[];
  emailWebhook: { url: string; token: string | null } | null;
  audit: { apiKey: string; apiBase: string | null; modelFast: string; modelStrong: string } | null;
  embeddings: { baseUrl: string; model: string; apiKey: string | null } | null;
}

/**
 * Parses and validates the environment. Production refuses to start with development secrets,
 * plain-http public URLs or an empty origin allow-list (ADR-0003: fail closed).
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${detail}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';

  if (production) {
    const problems: string[] = [];
    if (!e.SERVER_SECRET || e.SERVER_SECRET === DEV_SECRET)
      problems.push('SERVER_SECRET must be set to a unique 32+ character secret');
    if (!e.DATABASE_URL) problems.push('DATABASE_URL is required');
    if (e.ALLOWED_ORIGINS.length === 0) problems.push('ALLOWED_ORIGINS must list the web origins');
    if (!e.PUBLIC_WEB_URL.startsWith('https://')) problems.push('PUBLIC_WEB_URL must be https');
    if (e.ALLOWED_ORIGINS.some((origin) => !origin.startsWith('https://')))
      problems.push('ALLOWED_ORIGINS must be https origins');
    if (e.QP_ALLOW_DEV_SEED) problems.push('QP_ALLOW_DEV_SEED must be 0 in production');
    if (e.RATE_LIMIT_SCALE !== 1) problems.push('RATE_LIMIT_SCALE must be 1 in production');
    if (problems.length > 0)
      throw new Error(`Unsafe production configuration: ${problems.join('; ')}`);
  }

  let gameConfigOverride: unknown = {};
  if (e.GAME_CONFIG_OVERRIDE) {
    try {
      gameConfigOverride = JSON.parse(e.GAME_CONFIG_OVERRIDE);
    } catch {
      throw new Error('Invalid configuration: GAME_CONFIG_OVERRIDE is not valid JSON');
    }
  }

  if (e.AUDIT_API_KEY && !e.AUDIT_MODEL_FAST)
    throw new Error('Invalid configuration: AUDIT_API_KEY needs AUDIT_MODEL_FAST');

  const webOrigin = new URL(e.PUBLIC_WEB_URL).origin;
  const allowedOrigins = Array.from(
    new Set([...e.ALLOWED_ORIGINS, ...(production ? [] : [webOrigin])]),
  );

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL ?? DEV_DATABASE_URL,
    publicWebUrl: e.PUBLIC_WEB_URL.replace(/\/+$/, ''),
    allowedOrigins,
    serverSecret: e.SERVER_SECRET ?? DEV_SECRET,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    instanceId: e.INSTANCE_ID ?? `${hostname()}-${process.pid}`,
    defaultRoomTier: e.DEFAULT_ROOM_TIER ?? (production ? 'FREE' : 'FULL'),
    allowDevSeed: e.QP_ALLOW_DEV_SEED,
    validateOutbound: e.VALIDATE_OUTBOUND ? e.VALIDATE_OUTBOUND === '1' : !production,
    gameConfigOverride,
    metricsToken: e.METRICS_TOKEN ?? null,
    heartbeatIntervalMs: e.HEARTBEAT_INTERVAL_MS,
    leaseMs: e.LEASE_MS,
    wsPingIntervalMs: e.WS_PING_INTERVAL_MS,
    wsAuthTimeoutMs: e.WS_AUTH_TIMEOUT_MS,
    maxWsConnections: e.MAX_WS_CONNECTIONS,
    maxWsPerIp: e.MAX_WS_PER_IP,
    serveWeb: e.SERVE_WEB,
    webDist: e.WEB_DIST ?? null,
    serveAdmin: e.SERVE_ADMIN,
    adminDist: e.ADMIN_DIST ?? null,
    rateLimitScale: e.RATE_LIMIT_SCALE,
    maintenanceIntervalMs: e.NODE_ENV === 'test' ? 0 : e.MAINTENANCE_INTERVAL_MS,
    adminBootstrapEmails: e.ADMIN_BOOTSTRAP_EMAILS.map((email) => email.trim().toLowerCase()),
    emailWebhook: e.EMAIL_WEBHOOK_URL
      ? { url: e.EMAIL_WEBHOOK_URL, token: e.EMAIL_WEBHOOK_TOKEN ?? null }
      : null,
    audit:
      e.AUDIT_API_KEY && e.AUDIT_MODEL_FAST
        ? {
            apiKey: e.AUDIT_API_KEY,
            apiBase: e.AUDIT_API_BASE ?? null,
            modelFast: e.AUDIT_MODEL_FAST,
            modelStrong: e.AUDIT_MODEL_STRONG ?? e.AUDIT_MODEL_FAST,
          }
        : null,
    embeddings:
      e.EMBEDDINGS_BASE_URL && e.EMBEDDINGS_MODEL
        ? {
            baseUrl: e.EMBEDDINGS_BASE_URL,
            model: e.EMBEDDINGS_MODEL,
            apiKey: e.EMBEDDINGS_API_KEY ?? null,
          }
        : null,
  };
}
