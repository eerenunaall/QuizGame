import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config';
import { apiError } from '../http/routes';
import { pseudonym } from '../security/crypto';
import type { SecurityLog } from '../security/events';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import { clientIp } from '../ws/gateway';
import { AssetLimitError } from './assets';
import { ImageRejected, MAX_IMAGE_BYTES } from './images';
import type { VenueRole, VenueService } from './service';

export interface VenueAssetDeps {
  config: AppConfig;
  venues: VenueService;
  limiter: RateLimiter;
  security: SecurityLog;
}

/** base64 of the largest file plus the JSON envelope; every other route keeps the 16 KB default. */
const UPLOAD_BODY_LIMIT = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;
const VenueParams = z.strictObject({ venueId: z.uuid() });
const HashParams = z.strictObject({ venueId: z.uuid(), hash: z.string().regex(/^[0-9a-f]{64}$/u) });
const UploadBody = z.strictObject({
  kind: z.enum(['LOGO', 'TEAM']),
  /** The file's bytes in base64. No file name and no content type: the server decides from the bytes. */
  data: z.string().min(1).max(UPLOAD_BODY_LIMIT),
});

/**
 * Venue images (ADR-0030 §4). Management is OWNER only and, like every venue route, answers a non-member
 * and an unknown venue with the same 404. Serving is public by content hash (TVs and phones are anonymous
 * visitors): the address is `/v1/venue-assets/<venue>/<sha256>`, and any wrong pair is the same 404.
 */
export function registerVenueAssetRoutes(app: FastifyInstance, deps: VenueAssetDeps): void {
  const { venues, limiter } = deps;
  const ipHashOf = (request: FastifyRequest): string =>
    pseudonym(deps.config.serverSecret, 'ip', clientIp(request.raw, deps.config.trustProxyHops));

  async function gate(
    request: FastifyRequest,
    reply: FastifyReply,
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
      deps.security.record('VENUE_ASSET_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method },
      });
      apiError(reply, 404, 'NOT_FOUND');
      return null;
    }
    if (role !== 'OWNER') {
      deps.security.record('VENUE_ASSET_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method, owner: true },
      });
      apiError(reply, 403, 'FORBIDDEN');
      return null;
    }
    return { accountId: auth.account.id, venueId: params.data.venueId, role };
  }

  const manage = { auth: 'session', limit: 'venue' } as const;

  app.get('/v1/venues/:venueId/assets', { config: manage }, async (request, reply) => {
    const who = await gate(request, reply);
    if (!who) return reply;
    const assets = await venues.assets.list(who.venueId);
    return {
      assets: assets.map((asset) => ({
        hash: asset.hash,
        contentType: asset.contentType,
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes,
      })),
    };
  });

  app.post(
    '/v1/venues/:venueId/assets',
    { bodyLimit: UPLOAD_BODY_LIMIT + 1024, config: { auth: 'session', limit: 'venueAsset' } },
    async (request, reply) => {
      const who = await gate(request, reply);
      if (!who) return reply;
      const byVenue = limiter.take(`venueAssetVenue:${who.venueId}`, LIMITS.venueAssetVenue);
      if (!byVenue.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: byVenue.retryAfterMs });
      const body = UploadBody.safeParse(request.body);
      if (!body.success || !BASE64.test(body.data.data))
        return apiError(reply, 400, 'INVALID_MESSAGE');
      const bytes = new Uint8Array(Buffer.from(body.data.data, 'base64'));
      try {
        const asset = await venues.assets.put(who.venueId, who.accountId, body.data.kind, bytes);
        return reply.code(201).send({
          asset: {
            hash: asset.hash,
            contentType: asset.contentType,
            width: asset.width,
            height: asset.height,
            bytes: asset.bytes,
          },
        });
      } catch (error) {
        if (error instanceof ImageRejected) {
          // A refused file is a trace worth keeping (SVG with script, polyglots, renamed HTML).
          deps.security.record('VENUE_ASSET_REJECTED', {
            ipHash: ipHashOf(request),
            detail: { reason: error.reason },
          });
          return apiError(reply, 400, 'IMAGE_REJECTED', { reason: error.reason });
        }
        if (error instanceof AssetLimitError) return apiError(reply, 409, 'LIMIT_REACHED');
        throw error;
      }
    },
  );

  app.post(
    '/v1/venues/:venueId/assets/:hash/remove',
    { config: manage },
    async (request, reply) => {
      const who = await gate(request, reply);
      if (!who) return reply;
      const params = HashParams.safeParse(request.params);
      if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
      if (!(await venues.removeAsset(who.venueId, params.data.hash)))
        return apiError(reply, 404, 'NOT_FOUND');
      return { ok: true };
    },
  );

  // Public by hash (documented in ADR-0030 §4): the 256-bit address is the proof, the venue is part of the
  // key, and a wrong pair of either kind is the same 404. Never a listing, never a redirect.
  app.get(
    '/v1/venue-assets/:venueId/:hash',
    { config: { auth: 'public', limit: 'venueAssetServe' } },
    async (request, reply) => {
      const key = `venueAssetServe:${ipHashOf(request)}`;
      const taken = limiter.take(key, LIMITS.venueAssetServe);
      if (!taken.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: taken.retryAfterMs });
      const params = HashParams.safeParse(request.params);
      const found = params.success
        ? await venues.assets.read(params.data.venueId, params.data.hash)
        : null;
      if (!found) {
        limiter.take(key, LIMITS.venueAssetServe, 3); // misses are expensive: enumeration is impractical
        return apiError(reply, 404, 'NOT_FOUND');
      }
      return reply
        .header('Content-Type', found.contentType)
        .header('Content-Length', String(found.bytes.length))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'")
        .header('Content-Disposition', 'inline; filename="logo"')
        .header('Cross-Origin-Resource-Policy', 'same-origin')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(found.bytes);
    },
  );
}
