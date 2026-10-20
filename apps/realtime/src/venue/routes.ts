import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizeEmail } from '../auth/otp';
import type { AppConfig } from '../config';
import { apiError } from '../http/routes';
import { pseudonym } from '../security/crypto';
import type { SecurityLog } from '../security/events';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import { clientIp } from '../ws/gateway';
import { parseRewardCode, VenueSettingsPatchSchema } from './settings';
import { MAX_MINUTES_PER_STEP, VenueError, type VenueRole, type VenueService } from './service';

export interface VenueRouteDeps {
  config: AppConfig;
  venues: VenueService;
  limiter: RateLimiter;
  security: SecurityLog;
}

const VenueParams = z.strictObject({ venueId: z.uuid() });
const SessionParams = z.strictObject({ venueId: z.uuid(), sessionId: z.uuid() });
const StaffParams = z.strictObject({ venueId: z.uuid(), accountId: z.uuid() });
const Minutes = z.int().min(1).max(MAX_MINUTES_PER_STEP);
const OpenBody = z.union([
  z.strictObject({ minutes: Minutes, roomCode: z.string().min(4).max(12) }),
  z.strictObject({ minutes: Minutes, link: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/u) }),
]);
const ExtendBody = z.strictObject({ minutes: Minutes });
const RedeemBody = z.strictObject({ code: z.string().min(1).max(20) });
const InviteBody = z.strictObject({ email: z.string().min(3).max(254) });

/**
 * The staff page's API (ADR-0024 §7). Every route is a signed-in (`session`) route, so the shared guard
 * authenticates it, rate-limits it per account and refuses cookie writes without the CSRF proof. Being
 * staff is checked here, per venue, on every request: a non-member and an unknown venue get the same 404.
 */
export function registerVenueRoutes(app: FastifyInstance, deps: VenueRouteDeps): void {
  const { venues, limiter } = deps;
  const ipHashOf = (request: FastifyRequest): string =>
    pseudonym(deps.config.serverSecret, 'ip', clientIp(request.raw, deps.config.trustProxyHops));

  const fail = (reply: FastifyReply, error: unknown): FastifyReply => {
    if (error instanceof VenueError) return apiError(reply, error.status, error.code, error.params);
    throw error;
  };

  /** The feature is on, the caller is a person (not an admin-console session) and, for a venue, its staff. */
  async function gate(
    request: FastifyRequest,
    reply: FastifyReply,
    need: VenueRole | 'ANY' | null,
  ): Promise<{ accountId: string; venueId: string | null; role: VenueRole | null } | null> {
    if (!(await venues.enabled())) {
      apiError(reply, 404, 'FEATURE_DISABLED');
      return null;
    }
    const auth = request.auth!;
    if (auth.kind === 'ADMIN') {
      apiError(reply, 403, 'FORBIDDEN');
      return null;
    }
    if (need === null) return { accountId: auth.account.id, venueId: null, role: null };
    const params = VenueParams.safeParse({
      venueId: (request.params as { venueId?: string }).venueId,
    });
    const role = params.success ? await venues.role(auth.account.id, params.data.venueId) : null;
    if (!params.success || !role) {
      deps.security.record('VENUE_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method },
      });
      apiError(reply, 404, 'NOT_FOUND');
      return null;
    }
    if (need === 'OWNER' && role !== 'OWNER') {
      deps.security.record('VENUE_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method, owner: true },
      });
      apiError(reply, 403, 'FORBIDDEN');
      return null;
    }
    return { accountId: auth.account.id, venueId: params.data.venueId, role };
  }

  const policy = { auth: 'session', limit: 'venue' } as const;

  app.get('/v1/venue/me', { config: policy }, async (request, reply) => {
    const who = await gate(request, reply, null);
    if (!who) return reply;
    return { venues: await venues.myVenues(who.accountId) };
  });

  app.get('/v1/venues/:venueId/sessions', { config: policy }, async (request, reply) => {
    const who = await gate(request, reply, 'ANY');
    if (!who) return reply;
    const [tables, settings] = await Promise.all([
      venues.sessions(who.venueId!),
      venues.settings(who.venueId!),
    ]);
    return {
      ...tables,
      role: who.role,
      steps: settings.extendSteps,
      defaultMinutes: settings.defaultMinutes,
    };
  });

  app.post('/v1/venues/:venueId/sessions', { config: policy }, async (request, reply) => {
    const who = await gate(request, reply, 'ANY');
    if (!who) return reply;
    const body = OpenBody.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
    try {
      const { minutes, ...target } = body.data;
      return reply.code(201).send(await venues.open(who.venueId!, who.accountId, minutes, target));
    } catch (error) {
      return fail(reply, error);
    }
  });

  const sessionAction = (
    action: 'extend' | 'pause' | 'resume' | 'end',
  ): ((request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => {
    return async (request, reply) => {
      const who = await gate(request, reply, 'ANY');
      if (!who) return reply;
      const params = SessionParams.safeParse(request.params);
      if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
      const { venueId, sessionId } = params.data;
      try {
        if (action === 'extend') {
          const body = ExtendBody.safeParse(request.body);
          if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
          return await venues.extend(venueId, sessionId, who.accountId, body.data.minutes);
        }
        if (action === 'pause') return await venues.pause(venueId, sessionId, who.accountId);
        if (action === 'resume') return await venues.resume(venueId, sessionId, who.accountId);
        return await venues.end(venueId, sessionId, who.accountId);
      } catch (error) {
        return fail(reply, error);
      }
    };
  };
  for (const action of ['extend', 'pause', 'resume', 'end'] as const)
    app.post(
      `/v1/venues/:venueId/sessions/:sessionId/${action}`,
      { config: policy },
      sessionAction(action),
    );

  app.post(
    '/v1/venues/:venueId/rewards/redeem',
    { config: { auth: 'session', limit: 'venueRedeem' } },
    async (request, reply) => {
      const who = await gate(request, reply, 'ANY');
      if (!who) return reply;
      const venueKey = `venueRedeemVenue:${who.venueId}`;
      const byVenue = limiter.take(venueKey, LIMITS.venueRedeemVenue);
      if (!byVenue.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: byVenue.retryAfterMs });
      const body = RedeemBody.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      // A wrong guess costs more than a right one: per account (on top of the guard's token) and per venue.
      const missed = (): void => {
        limiter.take(`venueRedeem:${who.accountId}`, LIMITS.venueRedeem, 1);
        limiter.take(venueKey, LIMITS.venueRedeemVenue, 1);
        deps.security.record('VENUE_REDEEM_FAILED', {
          ipHash: ipHashOf(request),
          detail: { venue: who.venueId! },
        });
      };
      const code = parseRewardCode(body.data.code);
      if (!code) {
        missed();
        return apiError(reply, 404, 'NOT_FOUND');
      }
      try {
        return await venues.redeem(who.venueId!, who.accountId, code);
      } catch (error) {
        if (error instanceof VenueError && error.status === 404) missed();
        return fail(reply, error);
      }
    },
  );

  app.get('/v1/venues/:venueId/settings', { config: policy }, async (request, reply) => {
    const who = await gate(request, reply, 'ANY');
    if (!who) return reply;
    return { settings: await venues.settings(who.venueId!), role: who.role };
  });

  app.post('/v1/venues/:venueId/settings', { config: policy }, async (request, reply) => {
    const who = await gate(request, reply, 'OWNER');
    if (!who) return reply;
    const body = VenueSettingsPatchSchema.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
    try {
      return { settings: await venues.updateSettings(who.venueId!, body.data) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/v1/venues/:venueId/staff', { config: policy }, async (request, reply) => {
    const who = await gate(request, reply, 'OWNER');
    if (!who) return reply;
    return { staff: await venues.staff(who.venueId!) };
  });

  app.post('/v1/venues/:venueId/staff', { config: policy }, async (request, reply) => {
    const who = await gate(request, reply, 'OWNER');
    if (!who) return reply;
    const body = InviteBody.safeParse(request.body);
    const email = body.success ? normalizeEmail(body.data.email) : null;
    if (!email) return apiError(reply, 400, 'INVALID_MESSAGE');
    try {
      return reply
        .code(201)
        .send(await venues.addStaff(who.venueId!, email, 'STAFF', who.accountId));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post(
    '/v1/venues/:venueId/staff/:accountId/remove',
    { config: policy },
    async (request, reply) => {
      const who = await gate(request, reply, 'OWNER');
      if (!who) return reply;
      const params = StaffParams.safeParse(request.params);
      if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
      try {
        await venues.removeStaff(params.data.venueId, params.data.accountId);
        return { ok: true };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );
}
