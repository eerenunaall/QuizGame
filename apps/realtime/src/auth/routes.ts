import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LocaleSchema } from '@quizparty/protocol';
import type { AppConfig } from '../config';
import type { FeatureFlags } from '../flags/service';
import { apiError } from '../http/routes';
import type { BanService } from '../moderation/bans';
import { hmacHex, pseudonym } from '../security/crypto';
import type { SecurityLog } from '../security/events';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import { clientIp } from '../ws/gateway';
import type { AccountSessionService, SessionKind } from './account-sessions';
import { ADMIN_ABSOLUTE_MS, WEB_SLIDING_MS } from './account-sessions';
import type { Account, AccountService } from './accounts';
import { clearedSessionCookie, sessionCookie } from './guard';
import { normalizeEmail, type OtpService } from './otp';

const RequestBody = z.strictObject({
  email: z.string().min(3).max(254),
  locale: LocaleSchema.optional(),
});
const VerifyBody = z.strictObject({
  email: z.string().min(3).max(254),
  code: z.string().regex(/^\d{6}$/u),
  client: z.enum(['ADMIN', 'WEB', 'MOBILE']).default('WEB'),
});

export interface AuthRouteDeps {
  config: AppConfig;
  otp: OtpService | null;
  accounts: AccountService;
  sessions: AccountSessionService;
  flags: FeatureFlags;
  bans: BanService;
  limiter: RateLimiter;
  security: SecurityLog;
}

/** What a signed-in client may know about itself: nothing it did not give us, no internals. */
export function accountView(account: Account, kind: SessionKind) {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    locale: account.locale,
    roles: account.roles,
    sessionKind: kind,
  };
}

/**
 * Email one-time-code sign-in (ADR-0012). Asking for a code always gets the same answer, whatever
 * the address; a wrong, expired or used code always gets the same refusal. Staff sign in with
 * `client: "ADMIN"`, which yields a short-lived session; only those sessions reach the admin API.
 */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const { config, limiter } = deps;
  const ipHashOf = (request: Parameters<typeof clientIp>[0]): string =>
    pseudonym(config.serverSecret, 'ip', clientIp(request, config.trustProxyHops));

  const available = async (): Promise<boolean> =>
    deps.otp !== null && (await deps.flags.isEnabled('auth.email_login'));

  app.post(
    '/v1/auth/email/request',
    { config: { auth: 'public', limit: 'authRequest' } },
    async (request, reply) => {
      const ipHash = ipHashOf(request.raw);
      const limit = limiter.take(`authRequest:${ipHash}`, LIMITS.authRequest);
      if (!limit.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: limit.retryAfterMs });
      const body = RequestBody.safeParse(request.body);
      const email = body.success ? normalizeEmail(body.data.email) : null;
      if (!body.success || !email) return apiError(reply, 400, 'INVALID_MESSAGE');
      if (!(await available()) || !deps.otp) return apiError(reply, 404, 'FEATURE_DISABLED');
      if (await deps.bans.isBanned({ ip: ipHash })) return apiError(reply, 403, 'BANNED');
      await deps.otp.request(email, ipHash, body.data.locale ?? 'tr');
      // 202 whatever happened: sent, throttled, or an address nobody has ever used.
      return reply.code(202).send({ ok: true });
    },
  );

  app.post(
    '/v1/auth/email/verify',
    { config: { auth: 'public', limit: 'authVerify' } },
    async (request, reply) => {
      const ipHash = ipHashOf(request.raw);
      const byIp = limiter.take(`authVerify:${ipHash}`, LIMITS.authVerify);
      if (!byIp.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: byIp.retryAfterMs });
      const body = VerifyBody.safeParse(request.body);
      const email = body.success ? normalizeEmail(body.data.email) : null;
      if (!body.success || !email) return apiError(reply, 400, 'INVALID_MESSAGE');
      if (!(await available()) || !deps.otp) return apiError(reply, 404, 'FEATURE_DISABLED');
      const byEmail = limiter.take(
        `authVerifyEmail:${hmacHex(config.serverSecret, 'limit-email', email)}`,
        LIMITS.authVerifyEmail,
      );
      if (!byEmail.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: byEmail.retryAfterMs });

      const checked = await deps.otp.verify(email, body.data.code);
      const account = checked.ok ? await deps.accounts.signIn(email, 'tr') : null;
      if (!account || (await deps.bans.isBanned({ account: account.id, ip: ipHash }))) {
        deps.security.record('LOGIN_REFUSED', { ipHash });
        return apiError(reply, 401, 'UNAUTHORIZED');
      }
      const wantsStaff = body.data.client === 'ADMIN';
      if (wantsStaff && account.roles.length === 0) {
        deps.security.record('ADMIN_LOGIN_NOT_STAFF', { ipHash });
        return apiError(reply, 403, 'FORBIDDEN');
      }
      const kind: SessionKind = wantsStaff
        ? 'ADMIN'
        : body.data.client === 'MOBILE'
          ? 'MOBILE'
          : 'WEB';
      const ua = request.headers['user-agent'];
      const session = await deps.sessions.create(account.id, kind, {
        ipHash,
        userAgentHash: ua ? pseudonym(config.serverSecret, 'ua', ua) : null,
      });
      const maxAge = Math.floor((kind === 'ADMIN' ? ADMIN_ABSOLUTE_MS : WEB_SLIDING_MS) / 1000);
      if (body.data.client !== 'MOBILE')
        void reply.header('set-cookie', sessionCookie(config, session.token, maxAge));
      return {
        account: accountView(account, kind),
        session: { expiresAt: session.expiresAt.toISOString() },
        // Native clients keep the token in secure storage; browsers only ever get the HttpOnly cookie.
        ...(body.data.client === 'MOBILE' ? { token: session.token } : {}),
      };
    },
  );

  app.get('/v1/me', { config: { auth: 'session', limit: 'session' } }, (request) => {
    const auth = request.auth!;
    return { account: accountView(auth.account, auth.kind) };
  });

  app.post(
    '/v1/auth/logout',
    { config: { auth: 'session', limit: 'session' } },
    async (request, reply) => {
      await deps.sessions.revoke(request.auth!.sessionId);
      void reply.header('set-cookie', clearedSessionCookie(config));
      return { ok: true };
    },
  );
}
