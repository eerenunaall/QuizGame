import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CommandSchema } from '@quizparty/quiznight';
import type { AppConfig } from '../config';
import { apiError } from '../http/routes';
import { pseudonym } from '../security/crypto';
import type { SecurityLog } from '../security/events';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import { clientIp } from '../ws/gateway';
import type { QuizNightService } from './quiznight-service';
import { VenueError, type VenueRole, type VenueService } from './service';

export interface QuizNightRouteDeps {
  config: AppConfig;
  venues: VenueService;
  nights: QuizNightService;
  limiter: RateLimiter;
  security: SecurityLog;
}

const NightParams = z.strictObject({ venueId: z.uuid(), nightId: z.uuid() });
const VenueParams = z.strictObject({ venueId: z.uuid() });
const CommandBody = z.strictObject({
  cmd: CommandSchema,
  /** The log position the tablet last saw; a double tap on NEXT is refused instead of skipping a slide. */
  expectedSeq: z.int().min(0).optional(),
});
const RewardBody = z.strictObject({ teamId: z.string().min(1).max(64).optional() });
const RedeemBody = z.strictObject({ code: z.string().min(1).max(20) });
const MISS_WINDOW_MS = 600_000;
const MISS_LIMIT = 12;
const TvQuery = z.strictObject({ l: z.string().min(1).max(200) });

/**
 * Quiz Gecesi routes (ADR-0029). Everything under /v1/venues/:venueId/quiznights is OWNER only (a
 * stranger or another café's owner gets 404, staff 403) except the reward redeem route, which staff may
 * use. The TV endpoint is public but needs a signed, expiring, revocable display link.
 */
export function registerQuizNightRoutes(app: FastifyInstance, deps: QuizNightRouteDeps): void {
  const { config, venues, nights, limiter } = deps;
  const ipHashOf = (request: FastifyRequest): string =>
    pseudonym(config.serverSecret, 'ip', clientIp(request.raw, config.trustProxyHops));
  const misses = new Map<string, number[]>();
  const fail = (reply: FastifyReply, error: unknown): FastifyReply => {
    if (error instanceof VenueError) return apiError(reply, error.status, error.code, error.params);
    throw error;
  };

  async function gate(
    request: FastifyRequest,
    reply: FastifyReply,
    need: VenueRole | 'ANY',
  ): Promise<{ accountId: string; venueId: string } | null> {
    if (!(await venues.enabled())) {
      apiError(reply, 404, 'FEATURE_DISABLED');
      return null;
    }
    const auth = request.auth!;
    if (auth.kind === 'ADMIN') {
      apiError(reply, 403, 'FORBIDDEN');
      return null;
    }
    const params = VenueParams.safeParse({
      venueId: (request.params as { venueId?: string }).venueId,
    });
    const role = params.success ? await venues.role(auth.account.id, params.data.venueId) : null;
    if (!params.success || !role) {
      deps.security.record('VENUE_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method, quizNight: true },
      });
      apiError(reply, 404, 'NOT_FOUND');
      return null;
    }
    if (need === 'OWNER' && role !== 'OWNER') {
      deps.security.record('VENUE_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method, owner: true, quizNight: true },
      });
      apiError(reply, 403, 'FORBIDDEN');
      return null;
    }
    return { accountId: auth.account.id, venueId: params.data.venueId };
  }

  /** Owner gate plus the night id from the path (a malformed id is just "not found"). */
  async function nightGate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ accountId: string; venueId: string; nightId: string } | null> {
    const who = await gate(request, reply, 'OWNER');
    if (!who) return null;
    const params = NightParams.safeParse(request.params);
    if (!params.success) {
      apiError(reply, 404, 'NOT_FOUND');
      return null;
    }
    return { ...who, nightId: params.data.nightId };
  }

  const policy = { auth: 'session', limit: 'venue' } as const;
  const base = '/v1/venues/:venueId/quiznights';

  app.get(base, { config: policy }, async (request, reply) => {
    const who = await gate(request, reply, 'OWNER');
    if (!who) return reply;
    return { nights: await nights.list(who.venueId) };
  });

  app.post(base, { config: policy }, async (request, reply) => {
    const who = await gate(request, reply, 'OWNER');
    if (!who) return reply;
    try {
      return reply
        .code(201)
        .send({ night: await nights.create(who.venueId, who.accountId, request.body) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get(`${base}/:nightId`, { config: policy }, async (request, reply) => {
    const who = await nightGate(request, reply);
    if (!who) return reply;
    try {
      return { night: await nights.detail(who.venueId, who.nightId) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post(`${base}/:nightId/config`, { config: policy }, async (request, reply) => {
    const who = await nightGate(request, reply);
    if (!who) return reply;
    try {
      return { night: await nights.updateConfig(who.venueId, who.nightId, request.body) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post(`${base}/:nightId/delete`, { config: policy }, async (request, reply) => {
    const who = await nightGate(request, reply);
    if (!who) return reply;
    try {
      await nights.remove(who.venueId, who.nightId);
      return { ok: true };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get(`${base}/:nightId/state`, { config: policy }, async (request, reply) => {
    const who = await nightGate(request, reply);
    if (!who) return reply;
    try {
      return { host: await nights.hostState(who.venueId, who.nightId) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post(`${base}/:nightId/command`, { config: policy }, async (request, reply) => {
    const who = await nightGate(request, reply);
    if (!who) return reply;
    // The actor and the clock are the server's: the body may carry neither (strict schema).
    const body = CommandBody.safeParse(request.body);
    if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
    try {
      return await nights.command(
        who.venueId,
        who.nightId,
        who.accountId,
        body.data.cmd,
        body.data.expectedSeq,
      );
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get(`${base}/:nightId/log`, { config: policy }, async (request, reply) => {
    const who = await nightGate(request, reply);
    if (!who) return reply;
    try {
      return { events: await nights.log(who.venueId, who.nightId) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post(`${base}/:nightId/links`, { config: policy }, async (request, reply) => {
    const who = await nightGate(request, reply);
    if (!who) return reply;
    try {
      const link = await nights.createLink(who.venueId, who.nightId, who.accountId);
      return reply.code(201).send({
        url: `${config.publicWebUrl}/tv/gece?l=${encodeURIComponent(link.token)}`,
        expiresAt: link.expiresAt,
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post(`${base}/:nightId/links/revoke`, { config: policy }, async (request, reply) => {
    const who = await nightGate(request, reply);
    if (!who) return reply;
    try {
      return { revoked: await nights.revokeLinks(who.venueId, who.nightId) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post(`${base}/:nightId/reward`, { config: policy }, async (request, reply) => {
    const who = await nightGate(request, reply);
    if (!who) return reply;
    const body = RewardBody.safeParse(request.body ?? {});
    if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
    try {
      return reply
        .code(201)
        .send(await nights.issueReward(who.venueId, who.nightId, who.accountId, body.data.teamId));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post(
    `${base}/rewards/redeem`,
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
      try {
        return await nights.redeem(who.venueId, who.accountId, body.data.code);
      } catch (error) {
        if (error instanceof VenueError && error.status === 404) {
          limiter.take(`venueRedeem:${who.accountId}`, LIMITS.venueRedeem, 1);
          limiter.take(venueKey, LIMITS.venueRedeemVenue, 1);
          deps.security.record('VENUE_REDEEM_FAILED', {
            ipHash: ipHashOf(request),
            detail: { venue: who.venueId, quizNight: true },
          });
        }
        return fail(reply, error);
      }
    },
  );

  // ───────────── the TV ─────────────

  app.get(
    '/v1/quiznight/tv',
    { config: { auth: 'public', limit: 'quizNightLink' } },
    async (request, reply) => {
      void reply.header('Cache-Control', 'no-store');
      const ipHash = ipHashOf(request);
      const taken = limiter.take(`quizNightLink:${ipHash}`, LIMITS.quizNightLink);
      if (!taken.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: taken.retryAfterMs });
      // Wrong links are counted apart: a few misses per address in ten minutes, then a pause. A real TV
      // never misses, so this bounds guessing without touching legitimate polling.
      const nowMs = nights.nowMs();
      const recent = (misses.get(ipHash) ?? []).filter((at) => nowMs - at < MISS_WINDOW_MS);
      misses.set(ipHash, recent);
      if (recent.length >= MISS_LIMIT * config.rateLimitScale)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: MISS_WINDOW_MS });
      const query = TvQuery.safeParse(request.query);
      const nightId = query.success ? await nights.nightOfToken(query.data.l) : null;
      const view = nightId ? await nights.tvViewOf(nightId) : null;
      if (!view) {
        recent.push(nowMs);
        if (misses.size > 5000) misses.clear();
        deps.security.record('QUIZNIGHT_LINK_REFUSED', { ipHash });
        return apiError(reply, 404, 'NOT_FOUND');
      }
      return { view };
    },
  );
}
