import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sanitizeUserText } from '@quizparty/validation';
import type { Database } from '@quizparty/db';
import { AdminAudit } from '../admin/audit';
import { IdParams, adminError, parse } from '../admin/common';
import { CAN } from '../admin/permissions';
import type { AppConfig } from '../config';
import { apiError } from '../http/routes';
import { pseudonym } from '../security/crypto';
import type { SecurityLog } from '../security/events';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import { clientIp } from '../ws/gateway';
import { formatPairingCode } from './display-codes';
import { PAIRING_TTL_MS, type VenueDisplays } from './displays';
import { MAX_MINUTES_PER_STEP, VenueError, type VenueRole, type VenueService } from './service';

export interface DisplayRouteDeps {
  config: AppConfig;
  db: Database;
  venues: VenueService;
  displays: VenueDisplays;
  limiter: RateLimiter;
  security: SecurityLog;
}

/** Cookie names: the `__Host-` prefix pins them to this origin, HTTPS and `Path=/` (production only). */
export function displayCookieName(config: AppConfig): string {
  return config.env === 'production' ? '__Host-qp_display' : 'qp_display';
}
export function pairingCookieName(config: AppConfig): string {
  return config.env === 'production' ? '__Host-qp_display_pairing' : 'qp_display_pairing';
}
/** Browsers cap cookie lifetime at 400 days; the server's own idle expiry is shorter (ADR-0028 §3). */
const DISPLAY_COOKIE_MAX_AGE = 400 * 86_400;

function cookie(config: AppConfig, name: string, value: string, maxAgeSeconds: number): string {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (config.env === 'production') flags.push('Secure');
  return `${name}=${value}; ${flags.join('; ')}`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

/**
 * The display credential is an ambient cookie: a request that changes state with it must come from our
 * own page (a browser always sends Origin on POST). Requests without Origin are tools, which cannot hold
 * the HttpOnly cookie of a real TV unless they stole it, and a stolen one is what rotation catches.
 */
function sameOrigin(request: FastifyRequest, config: AppConfig): boolean {
  const origin = request.headers.origin;
  return origin === undefined || config.allowedOrigins.includes(origin);
}

const VenueParams = z.strictObject({ venueId: z.uuid() });
const DisplayParams = z.strictObject({ venueId: z.uuid(), displayId: z.uuid() });
const PairBody = z.strictObject({ code: z.string().min(1).max(20), name: z.string().max(80) });
const OpenBody = z.strictObject({ minutes: z.int().min(1).max(MAX_MINUTES_PER_STEP).optional() });

/**
 * The gate `POST /v1/rooms` asks under VENUE_LOCK (ADR-0028 §1). Returns the display that may create a
 * room (and refreshes its cookie when it rotates), or null after answering 403 itself.
 */
export function roomCreationGate(deps: DisplayRouteDeps) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ displayId: string | null } | null> => {
    if (!deps.config.venueLock) return { displayId: null };
    const ipHash = pseudonym(
      deps.config.serverSecret,
      'ip',
      clientIp(request.raw, deps.config.trustProxyHops),
    );
    const token = readCookie(request.headers.cookie, displayCookieName(deps.config));
    const outcome =
      token && sameOrigin(request, deps.config)
        ? await deps.displays.authenticate(token)
        : { kind: 'NONE' as const };
    if (outcome.kind !== 'OK') {
      deps.security.record('DISPLAY_UNPAIRED_CREATE', { ipHash });
      apiError(reply, 403, 'FORBIDDEN');
      return null;
    }
    if (outcome.rotateTo)
      void reply.header(
        'set-cookie',
        cookie(
          deps.config,
          displayCookieName(deps.config),
          outcome.rotateTo,
          DISPLAY_COOKIE_MAX_AGE,
        ),
      );
    return { displayId: outcome.display.id };
  };
}

/**
 * Venue displays (ADR-0028): the TV's two public calls (start a pairing, poll), the panel's calls under
 * `/v1/venues/:venueId/displays` and the admin console's. The TV calls carry no bearer token: the
 * credential is an HttpOnly cookie nothing in the page can read.
 */
export function registerVenueDisplayRoutes(app: FastifyInstance, deps: DisplayRouteDeps): void {
  const { config, venues, displays, limiter } = deps;
  const ipHashOf = (request: FastifyRequest): string =>
    pseudonym(config.serverSecret, 'ip', clientIp(request.raw, config.trustProxyHops));
  const fail = (reply: FastifyReply, error: unknown): FastifyReply => {
    if (error instanceof VenueError) return apiError(reply, error.status, error.code, error.params);
    throw error;
  };

  // ───────────── the TV ─────────────

  app.post(
    '/v1/display/pairing',
    { config: { auth: 'public', limit: 'displayPairStart' } },
    async (request, reply) => {
      if (!config.venueLock) return apiError(reply, 404, 'FEATURE_DISABLED');
      if (!sameOrigin(request, config)) return apiError(reply, 403, 'FORBIDDEN');
      const taken = limiter.take(`displayPairStart:${ipHashOf(request)}`, LIMITS.displayPairStart);
      if (!taken.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: taken.retryAfterMs });
      try {
        const pairing = await displays.startPairing();
        void reply.header(
          'set-cookie',
          cookie(config, pairingCookieName(config), pairing.secret, PAIRING_TTL_MS / 1000 + 60),
        );
        // The code is shown on this screen only; it is never logged and only its keyed hash is stored.
        return reply.code(201).send({
          code: formatPairingCode(pairing.code),
          expiresAt: pairing.expiresAt,
          pairUrl: `${config.publicWebUrl}/staff?pair=${pairing.code}`,
        });
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.post(
    '/v1/display/poll',
    { config: { auth: 'public', limit: 'displayPoll' } },
    async (request, reply) => {
      if (!config.venueLock) return { lock: false, paired: false };
      if (!sameOrigin(request, config)) return apiError(reply, 403, 'FORBIDDEN');
      const taken = limiter.take(`displayPoll:${ipHashOf(request)}`, LIMITS.displayPoll);
      if (!taken.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: taken.retryAfterMs });
      const cookies: string[] = [];
      const header = request.headers.cookie;
      const displayName = displayCookieName(config);
      const pairingName = pairingCookieName(config);

      const token = readCookie(header, displayName);
      let outcome = await displays.authenticate(token);
      if (token && outcome.kind === 'NONE') cookies.push(cookie(config, displayName, '', 0));

      if (outcome.kind === 'NONE') {
        const secret = readCookie(header, pairingName);
        const pairing = secret ? await displays.collectPairing(secret) : null;
        if (pairing?.state === 'PAIRED') {
          cookies.push(cookie(config, displayName, pairing.token, DISPLAY_COOKIE_MAX_AGE));
          cookies.push(cookie(config, pairingName, '', 0));
          outcome = await displays.authenticate(pairing.token);
        } else {
          if (secret && !pairing) cookies.push(cookie(config, pairingName, '', 0));
          if (cookies.length > 0) void reply.header('set-cookie', cookies);
          return {
            lock: true,
            paired: false,
            pairing: pairing ? { expiresAt: pairing.expiresAt } : null,
          };
        }
      }
      if (outcome.kind !== 'OK') {
        void reply.header('set-cookie', cookies);
        return { lock: true, paired: false, pairing: null };
      }
      if (outcome.rotateTo)
        cookies.push(cookie(config, displayName, outcome.rotateTo, DISPLAY_COOKIE_MAX_AGE));
      if (cookies.length > 0) void reply.header('set-cookie', cookies);
      const delivery = displays.takeDelivery(outcome.display.id);
      return {
        lock: true,
        paired: true,
        display: { name: outcome.display.name },
        ...(delivery ? { delivery } : {}),
      };
    },
  );

  // ───────────── the panel ─────────────

  async function gate(
    request: FastifyRequest,
    reply: FastifyReply,
    need: VenueRole | 'ANY',
  ): Promise<{ accountId: string; venueId: string; role: VenueRole } | null> {
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
        detail: { method: request.method, displays: true },
      });
      apiError(reply, 404, 'NOT_FOUND');
      return null;
    }
    if (need === 'OWNER' && role !== 'OWNER') {
      deps.security.record('VENUE_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method, owner: true, displays: true },
      });
      apiError(reply, 403, 'FORBIDDEN');
      return null;
    }
    return { accountId: auth.account.id, venueId: params.data.venueId, role };
  }

  const policy = { auth: 'session', limit: 'venue' } as const;

  app.get('/v1/venues/:venueId/displays', { config: policy }, async (request, reply) => {
    const who = await gate(request, reply, 'ANY');
    if (!who) return reply;
    return { ...(await displays.list(who.venueId)), role: who.role };
  });

  app.post(
    '/v1/venues/:venueId/displays/pair',
    { config: { auth: 'session', limit: 'displayPair' } },
    async (request, reply) => {
      const who = await gate(request, reply, 'OWNER');
      if (!who) return reply;
      const venueKey = `displayPairVenue:${who.venueId}`;
      const byVenue = limiter.take(venueKey, LIMITS.displayPairVenue);
      if (!byVenue.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: byVenue.retryAfterMs });
      const body = PairBody.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      const name = sanitizeUserText(body.data.name, { maxLength: 40, allowLinks: false });
      if (!name.ok) return apiError(reply, 400, 'TEXT_REJECTED', { reason: name.reason });
      try {
        return reply
          .code(201)
          .send(await displays.claim(who.venueId, who.accountId, body.data.code, name.text));
      } catch (error) {
        if (error instanceof VenueError && error.status === 404) {
          // A wrong code costs double, per account and per venue (ADR-0028 §2).
          limiter.take(`displayPair:${who.accountId}`, LIMITS.displayPair, 1);
          limiter.take(venueKey, LIMITS.displayPairVenue, 1);
          deps.security.record('DISPLAY_PAIR_MISS', {
            ipHash: ipHashOf(request),
            detail: { venue: who.venueId },
          });
        }
        return fail(reply, error);
      }
    },
  );

  app.post(
    '/v1/venues/:venueId/displays/:displayId/open',
    { config: policy },
    async (request, reply) => {
      const who = await gate(request, reply, 'ANY');
      if (!who) return reply;
      const params = DisplayParams.safeParse(request.params);
      if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
      const body = OpenBody.safeParse(request.body ?? {});
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      try {
        return await displays.openGame(
          who.venueId,
          params.data.displayId,
          who.accountId,
          body.data.minutes ?? null,
        );
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.post(
    '/v1/venues/:venueId/displays/:displayId/revoke',
    { config: policy },
    async (request, reply) => {
      const who = await gate(request, reply, 'OWNER');
      if (!who) return reply;
      const params = DisplayParams.safeParse(request.params);
      if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
      try {
        await displays.revoke(who.venueId, params.data.displayId, who.accountId, 'OWNER');
        return { ok: true };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  // ───────────── the admin console (ADR-0028 §5) ─────────────

  const audit = new AdminAudit(deps.db, config, app.log);
  const DisplayAdminParams = z.strictObject({ id: z.uuid(), displayId: z.uuid() });

  app.get(
    '/v1/admin/venues/:id/displays',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.venuesRead } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      if (!params) return reply;
      const listed = await displays.adminList(params.id);
      if (!listed) return adminError(reply, 404, 'NOT_FOUND');
      return listed;
    },
  );

  app.post(
    '/v1/admin/venues/:id/displays/:displayId/revoke',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.venuesWrite } },
    async (request, reply) => {
      const params = parse(DisplayAdminParams, request.params, reply);
      if (!params) return reply;
      try {
        await displays.revoke(params.id, params.displayId, request.auth!.account.id, 'ADMIN');
      } catch (error) {
        if (error instanceof VenueError) return adminError(reply, 404, 'NOT_FOUND');
        throw error;
      }
      await audit.record(
        request,
        'venue.display.revoke',
        { type: 'venue', id: params.id },
        {
          displayId: params.displayId,
        },
      );
      return { ok: true };
    },
  );

  app.post(
    '/v1/admin/venues/:id/seats',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.venuesWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(z.strictObject({ seats: z.int().min(0).max(50) }), request.body, reply)
        : null;
      if (!params || !body) return reply;
      if (!(await displays.setSeats(params.id, body.seats)))
        return adminError(reply, 404, 'NOT_FOUND');
      await audit.record(
        request,
        'venue.seats',
        { type: 'venue', id: params.id },
        {
          seats: body.seats,
        },
      );
      return { seats: body.seats };
    },
  );
}
