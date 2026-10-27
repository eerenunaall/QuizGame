import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '@quizparty/db';
import {
  VENUE_CSV_TEMPLATE,
  VENUE_JSONL_TEMPLATE,
  VENUE_LIMITS,
  VENUE_TEMPLATE_FILE_NAMES,
  venuePrompt,
} from '@quizparty/question-schema';
import {
  VenueContentError,
  analyzeVenueUpload,
  exportVenueSet,
  importVenueUpload,
  resolveVenueReport,
  retireVenueUpload,
  venueOpenReports,
  venueSetSummary,
} from '@quizparty/question-bank';
import type { AppConfig } from '../config';
import { apiError } from '../http/routes';
import { pseudonym } from '../security/crypto';
import type { SecurityLog } from '../security/events';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import type { Clock } from '../util/clock';
import { clientIp } from '../ws/gateway';
import type { VenueRole, VenueService } from './service';

export interface VenueContentDeps {
  config: AppConfig;
  db: Database;
  venues: VenueService;
  limiter: RateLimiter;
  security: SecurityLog;
  clock: Clock;
}

/** 2 MB of file as base64 plus the envelope. Every other route keeps the 16 KB default. */
const UPLOAD_BODY_LIMIT = Math.ceil((VENUE_LIMITS.maxBytes * 4) / 3) + 4096;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

const VenueParams = z.strictObject({ venueId: z.uuid() });
const UploadParams = z.strictObject({ venueId: z.uuid(), uploadId: z.uuid() });
const ReportParams = z.strictObject({ venueId: z.uuid(), reportId: z.uuid() });
const UploadBody = z.strictObject({
  fileName: z.string().max(200).default('yukleme'),
  /** The file's bytes, base64: the server decodes them (UTF-8, Windows-1254, UTF-16) itself. */
  data: z.string().min(1).max(UPLOAD_BODY_LIMIT),
});
const FormatQuery = z.strictObject({ format: z.enum(['csv', 'jsonl']).default('csv') });
const ReportBody = z.strictObject({ action: z.enum(['DISMISS', 'RETIRE']) });

/**
 * The venue's question sets (ADR-0025). Only the OWNER uploads, retires and exports; STAFF may read the
 * list of uploads and the counts. Non-members and unknown venues get the same 404 as everywhere in ADR-0024.
 */
export function registerVenueContentRoutes(app: FastifyInstance, deps: VenueContentDeps): void {
  const { venues, limiter, db } = deps;
  const ipHashOf = (request: FastifyRequest): string =>
    pseudonym(deps.config.serverSecret, 'ip', clientIp(request.raw, deps.config.trustProxyHops));

  async function gate(
    request: FastifyRequest,
    reply: FastifyReply,
    need: VenueRole,
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
      deps.security.record('VENUE_CONTENT_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method },
      });
      apiError(reply, 404, 'NOT_FOUND');
      return null;
    }
    if (need === 'OWNER' && role !== 'OWNER') {
      deps.security.record('VENUE_CONTENT_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method, owner: true },
      });
      apiError(reply, 403, 'FORBIDDEN');
      return null;
    }
    return { accountId: auth.account.id, venueId: params.data.venueId, role };
  }

  const read = { auth: 'session', limit: 'venue' } as const;
  const upload = {
    bodyLimit: UPLOAD_BODY_LIMIT + 1024,
    config: { auth: 'session', limit: 'venueContent' } as const,
  };

  app.get('/v1/venues/:venueId/questions', { config: read }, async (request, reply) => {
    const who = await gate(request, reply, 'STAFF');
    if (!who) return reply;
    return {
      role: who.role,
      canManage: who.role === 'OWNER',
      limits: {
        maxBytes: VENUE_LIMITS.maxBytes,
        maxRows: VENUE_LIMITS.maxRows,
        maxQuestions: VENUE_LIMITS.maxQuestionsPerVenue,
        maxCategories: VENUE_LIMITS.maxCategoriesPerVenue,
      },
      ...(await venueSetSummary(db, who.venueId)),
    };
  });

  app.get('/v1/venues/:venueId/questions/template', { config: read }, async (request, reply) => {
    const who = await gate(request, reply, 'OWNER');
    if (!who) return reply;
    const query = FormatQuery.safeParse(request.query);
    if (!query.success) return apiError(reply, 400, 'INVALID_MESSAGE');
    const csv = query.data.format === 'csv';
    return reply
      .header('content-type', `${csv ? 'text/csv' : 'application/x-ndjson'}; charset=utf-8`)
      .header(
        'content-disposition',
        `attachment; filename="${VENUE_TEMPLATE_FILE_NAMES[csv ? 'CSV' : 'JSONL']}"`,
      )
      .send(`\uFEFF${csv ? VENUE_CSV_TEMPLATE : VENUE_JSONL_TEMPLATE}`);
  });

  app.get('/v1/venues/:venueId/questions/prompt', { config: read }, async (request, reply) => {
    const who = await gate(request, reply, 'OWNER');
    if (!who) return reply;
    const query = FormatQuery.safeParse(request.query);
    if (!query.success) return apiError(reply, 400, 'INVALID_MESSAGE');
    return {
      format: query.data.format,
      prompt: venuePrompt(query.data.format === 'csv' ? 'CSV' : 'JSONL'),
    };
  });

  /** Dry-run and import share the body, the limits and the analysis; only the import writes. */
  const uploadHandler =
    (write: boolean) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      const who = await gate(request, reply, 'OWNER');
      if (!who) return reply;
      const byVenue = limiter.take(`venueContentVenue:${who.venueId}`, LIMITS.venueContentVenue);
      if (!byVenue.allowed)
        return apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: byVenue.retryAfterMs });
      const body = UploadBody.safeParse(request.body);
      if (!body.success || !BASE64.test(body.data.data))
        return apiError(reply, 400, 'INVALID_MESSAGE');
      const bytes = new Uint8Array(Buffer.from(body.data.data, 'base64'));
      const input = { venueId: who.venueId, fileName: body.data.fileName, bytes };
      const options = { now: new Date(deps.clock.now()) };
      try {
        const result = write
          ? await importVenueUpload(db, { ...input, accountId: who.accountId }, options)
          : await analyzeVenueUpload(db, input, options);
        // A file that is not a question file at all (binary, zip, garbage) leaves a trace.
        if ('ok' in result && result.ok === false)
          deps.security.record('VENUE_CONTENT_REJECTED', {
            ipHash: ipHashOf(request),
            detail: { code: result.issue.code, write },
          });
        return result;
      } catch (error) {
        if (error instanceof VenueContentError && error.code === 'VENUE_FULL')
          return apiError(reply, 409, 'LIMIT_REACHED');
        throw error;
      }
    };
  app.post('/v1/venues/:venueId/questions/dry-run', upload, uploadHandler(false));
  app.post('/v1/venues/:venueId/questions/import', upload, uploadHandler(true));

  app.post(
    '/v1/venues/:venueId/questions/uploads/:uploadId/retire',
    { config: read },
    async (request, reply) => {
      const who = await gate(request, reply, 'OWNER');
      if (!who) return reply;
      const params = UploadParams.safeParse(request.params);
      if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
      try {
        return await retireVenueUpload(
          db,
          who.venueId,
          params.data.uploadId,
          { accountId: who.accountId, admin: false },
          new Date(deps.clock.now()),
        );
      } catch (error) {
        if (error instanceof VenueContentError)
          return error.code === 'NOT_FOUND'
            ? apiError(reply, 404, 'NOT_FOUND')
            : apiError(reply, 409, 'INVALID_STATE');
        throw error;
      }
    },
  );

  app.get('/v1/venues/:venueId/questions/export', { config: read }, async (request, reply) => {
    const who = await gate(request, reply, 'OWNER');
    if (!who) return reply;
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="sorularimiz.csv"')
      .send(`\uFEFF${await exportVenueSet(db, who.venueId)}`);
  });

  app.get('/v1/venues/:venueId/questions/reports', { config: read }, async (request, reply) => {
    const who = await gate(request, reply, 'OWNER');
    if (!who) return reply;
    return { items: await venueOpenReports(db, who.venueId) };
  });

  app.post(
    '/v1/venues/:venueId/questions/reports/:reportId/resolve',
    { config: read },
    async (request, reply) => {
      const who = await gate(request, reply, 'OWNER');
      if (!who) return reply;
      const params = ReportParams.safeParse(request.params);
      const body = ReportBody.safeParse(request.body);
      if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      try {
        await resolveVenueReport(
          db,
          who.venueId,
          params.data.reportId,
          body.data.action,
          { accountId: who.accountId, admin: false },
          new Date(deps.clock.now()),
        );
        return { ok: true };
      } catch (error) {
        if (error instanceof VenueContentError) return apiError(reply, 404, 'NOT_FOUND');
        throw error;
      }
    },
  );
}
