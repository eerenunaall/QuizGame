import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config';
import { apiError } from '../http/routes';
import type { SecurityLog } from '../security/events';
import { pseudonym } from '../security/crypto';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import { clientIp } from '../ws/gateway';
import type { AccountSessionService, AuthContext } from './account-sessions';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth guard for routes whose policy is `session` or `admin`; null elsewhere. */
    auth: AuthContext | null;
  }
}

export const CSRF_HEADER = 'x-quizparty-csrf';
export const SESSION_COOKIE = 'qp_session';
export const SECURE_SESSION_COOKIE = '__Host-qp_session';

/** The name the cookie wears: the `__Host-` prefix pins it to this origin and to HTTPS. */
export function cookieName(config: AppConfig): string {
  return config.env === 'production' ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

export function sessionCookie(config: AppConfig, token: string, maxAgeSeconds: number): string {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (config.env === 'production') flags.push('Secure');
  return `${cookieName(config)}=${token}; ${flags.join('; ')}`;
}

export function clearedSessionCookie(config: AppConfig): string {
  return sessionCookie(config, '', 0);
}

export interface GuardDeps {
  config: AppConfig;
  sessions: AccountSessionService;
  limiter: RateLimiter;
  security: SecurityLog;
}

/** How a request presented its credentials: a bearer header has no ambient authority, a cookie does. */
function credentials(
  request: FastifyRequest,
  config: AppConfig,
): { token: string; viaCookie: boolean } | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return { token: header.slice(7).trim(), viaCookie: false };
  const cookie = readCookie(request.headers.cookie, cookieName(config));
  return cookie ? { token: cookie, viaCookie: true } : null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The one place that turns a route's declared policy into enforcement. `session` needs any signed-in
 * account; `admin` needs a short-lived staff session and one of the route's roles. It runs before the
 * body is read, so an anonymous caller never makes the server parse anything. A route cannot opt out:
 * the policy it declares (which the boot-time check insists on) is the policy that is applied.
 */
export function installAuthGuard(app: FastifyInstance, deps: GuardDeps): void {
  const { config, sessions, limiter, security } = deps;
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const policy = request.routeOptions.config;
    if (policy.auth !== 'session' && policy.auth !== 'admin') return;
    const ipHash = pseudonym(
      config.serverSecret,
      'ip',
      clientIp(request.raw, config.trustProxyHops),
    );

    const presented = credentials(request, config);
    const context = presented ? await sessions.resolve(presented.token) : null;
    if (!presented || !context) return apiError(reply, 401, 'UNAUTHORIZED');

    // A cookie is sent by the browser on any request the user's browser makes, including ones a
    // hostile page triggers: state changes must prove they come from our own page.
    if (presented.viaCookie && !SAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      if (
        origin === undefined ||
        !config.allowedOrigins.includes(origin) ||
        request.headers[CSRF_HEADER] !== '1'
      ) {
        security.record('CSRF_REFUSED', { ipHash, detail: { method: request.method } });
        return apiError(reply, 403, 'FORBIDDEN');
      }
    }

    if (policy.auth === 'admin') {
      const allowed = policy.roles ?? [];
      const permitted =
        context.kind === 'ADMIN' && context.account.roles.some((role) => allowed.includes(role));
      if (!permitted) {
        security.record('ADMIN_FORBIDDEN', {
          ipHash,
          detail: { method: request.method, kind: context.kind },
        });
        return apiError(reply, 403, 'FORBIDDEN');
      }
    }

    if (policy.limit && policy.limit !== 'none') {
      const taken = limiter.take(`${policy.limit}:${context.account.id}`, LIMITS[policy.limit]);
      if (!taken.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: taken.retryAfterMs });
    }
    request.auth = context;
    return undefined;
  });
}
