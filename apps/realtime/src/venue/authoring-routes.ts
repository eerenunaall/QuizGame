import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '@quizparty/db';
import {
  DraftEdit,
  VenueContentError,
  analyzeVenueUpload,
  importVenueUpload,
  suggestOptions,
} from '@quizparty/question-bank';
import type { VenueIssue } from '@quizparty/question-schema';
import { AdminAudit } from '../admin/audit';
import { IdParams, adminError, parse } from '../admin/common';
import { CAN } from '../admin/permissions';
import type { AppConfig } from '../config';
import { apiError } from '../http/routes';
import { pseudonym } from '../security/crypto';
import type { SecurityLog } from '../security/events';
import type { RateLimiter } from '../security/rate-limit';
import type { Clock } from '../util/clock';
import { clientIp } from '../ws/gateway';
import { AuthoringError, type AuthoringService } from './authoring-service';
import type { VenueDrafts } from './authoring-drafts';
import { EXTRACT_LIMITS, extractDocument } from './extract';
import type { VenueService } from './service';

export interface AuthoringDeps {
  config: AppConfig;
  db: Database;
  venues: VenueService;
  authoring: AuthoringService;
  drafts: VenueDrafts;
  limiter: RateLimiter;
  security: SecurityLog;
  clock: Clock;
}

const VenueParams = z.strictObject({ venueId: z.uuid() });
const RunParams = z.strictObject({ venueId: z.uuid(), runId: z.uuid() });
const DraftParams = z.strictObject({ venueId: z.uuid(), draftId: z.uuid() });
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;
/** 10 MB of file as base64 plus the envelope; the global 16 KB default applies to every other route. */
const DOCUMENT_BODY_LIMIT = Math.ceil((EXTRACT_LIMITS.maxBytes * 4) / 3) + 4096;
const RunBody = z.strictObject({
  fileName: z.string().max(200).default('belge'),
  data: z.string().min(1).max(DOCUMENT_BODY_LIMIT),
  category: z.string().trim().min(1).max(80).default('Belgeden sorular'),
});
/** Pasted or typed question text (no model): about 100 KB of text is far more than 200 questions need. */
const TEXT_BODY_LIMIT = 150_000;
const Difficulty = z.enum(['EASY', 'MEDIUM', 'HARD', 'EXPERT']).default('MEDIUM');
const ImportTextBody = z.strictObject({
  fileName: z.string().trim().max(120).default('Yapıştırılan sorular'),
  text: z.string().min(1).max(TEXT_BODY_LIMIT),
  category: z.string().trim().min(1).max(80).default('Genel kültür'),
  difficulty: Difficulty,
});
const ImportFileBody = z.strictObject({
  fileName: z.string().max(200).default('belge'),
  data: z.string().min(1).max(DOCUMENT_BODY_LIMIT),
  category: z.string().trim().min(1).max(80).default('Genel kültür'),
  difficulty: Difficulty,
});
/** A spreadsheet export or JSON lines belong in the question upload box, not in the text reader. */
const TABLE_HEAD =
  /^\s*(?:[{[]|"?(?:category|kategori|question|soru)"?\s*[,;\t].*(?:option|[sş][ıi]k|correct|do[gğ]ru))/iu;
/** "Yanlış seçenekleri otomatik doldur": the right answer in, three look-alike wrong ones out (no model). */
const OptionsBody = z.strictObject({
  correct: z.string().trim().min(1).max(200),
  category: z.string().trim().max(80).optional(),
  own: z.array(z.string().max(200)).max(200).optional(),
});
const ApproveBody = z.union([
  z.strictObject({ all: z.literal(true) }),
  z.strictObject({ ids: z.array(z.uuid()).min(1).max(100) }),
]);
const Text = (max: number) => z.string().max(max);
/** The studio form (ADR-0028 §6). The same limits as a file row are enforced again by the import pipeline. */
const ManualBody = z.strictObject({
  mode: z.enum(['check', 'save']),
  category: Text(80),
  question: Text(600),
  options: z.array(Text(200)).length(4),
  correctIndex: z.int().min(0).max(3),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD', 'EXPERT']),
  explanation: Text(600).optional(),
  sourceUrl: Text(300).optional(),
});

export interface ManualAnswer {
  /** OK: the question passes (saved when mode is save). Anything else was not stored. */
  status: 'OK' | 'REVIEW' | 'REJECT' | 'INVALID' | 'DUPLICATE' | 'FULL';
  saved: boolean;
  issues: VenueIssue[];
}

/**
 * The manual question form of the Soru Stüdyosu (ADR-0028 §6). The form becomes one JSONL row and goes
 * through exactly the pipeline of a file upload (validation, player-text gate, heuristics, duplicate
 * checks), so a hand-written question can never be less checked than an uploaded one. OWNER only.
 */
export function registerVenueAuthoringRoutes(app: FastifyInstance, deps: AuthoringDeps): void {
  const { venues, db } = deps;
  const ipHashOf = (request: FastifyRequest): string =>
    pseudonym(deps.config.serverSecret, 'ip', clientIp(request.raw, deps.config.trustProxyHops));

  async function ownerGate(
    request: FastifyRequest,
    reply: FastifyReply,
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
      deps.security.record('VENUE_CONTENT_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method, studio: true },
      });
      apiError(reply, 404, 'NOT_FOUND');
      return null;
    }
    if (role !== 'OWNER') {
      deps.security.record('VENUE_CONTENT_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method, owner: true, studio: true },
      });
      apiError(reply, 403, 'FORBIDDEN');
      return null;
    }
    return { accountId: auth.account.id, venueId: params.data.venueId };
  }

  app.post(
    '/v1/venues/:venueId/questions/manual',
    { config: { auth: 'session', limit: 'venueStudio' } },
    async (request, reply) => {
      const who = await ownerGate(request, reply);
      if (!who) return reply;
      const body = ManualBody.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      const form = body.data;
      const row: Record<string, unknown> = {
        category: form.category,
        difficulty: form.difficulty,
        question: form.question,
        options: form.options,
        correctIndex: form.correctIndex,
        authorType: 'HUMAN',
        ...(form.explanation?.trim() ? { explanation: form.explanation } : {}),
        ...(form.sourceUrl?.trim() ? { sources: [{ url: form.sourceUrl.trim() }] } : {}),
      };
      const input = {
        venueId: who.venueId,
        fileName: 'Elle yazılan soru',
        bytes: new TextEncoder().encode(`${JSON.stringify(row)}\n`),
      };
      const options = { now: new Date(deps.clock.now()) };
      try {
        const result =
          form.mode === 'save'
            ? await importVenueUpload(
                db,
                { ...input, accountId: who.accountId, origin: 'MANUAL' },
                options,
              )
            : await analyzeVenueUpload(db, input, options);
        const analysis = 'analysis' in result ? result.analysis : result;
        if ('ok' in analysis && analysis.ok === false)
          return {
            status: 'INVALID',
            saved: false,
            issues: [analysis.issue],
          } satisfies ManualAnswer;
        const report = analysis.rows[0];
        const duplicate = analysis.alreadyImported !== null;
        const saved = 'imported' in result && result.imported === 1;
        const answer: ManualAnswer = report
          ? { status: report.status, saved: false, issues: report.issues }
          : {
              status: duplicate ? 'DUPLICATE' : 'OK',
              saved,
              issues: duplicate ? [{ field: '', code: 'duplicate' }] : [],
            };
        return answer;
      } catch (error) {
        if (error instanceof VenueContentError && error.code === 'VENUE_FULL')
          return apiError(reply, 409, 'LIMIT_REACHED');
        throw error;
      }
    },
  );

  // ───────────── documents to drafts (ADR-0028 §6) ─────────────
  const read = { auth: 'session', limit: 'venue' } as const;
  const write = { auth: 'session', limit: 'venueStudio' } as const;

  /**
   * Questions that already exist as text become drafts with no model and no key (owner decision 2026-11-10):
   * the same review gate and import checks as every other draft. Pasted text and uploaded documents share
   * `VenueDrafts.importText`; only the document route reads a file first (in the extraction worker).
   */
  const importAnswer = async (
    reply: FastifyReply,
    run: () => ReturnType<VenueDrafts['importText']>,
  ) => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AuthoringError && error.code === 'SAME_FILE')
        return apiError(reply, 409, 'INVALID_STATE', { reason: 'same_file' });
      throw error;
    }
  };

  app.post(
    '/v1/venues/:venueId/authoring/import-text',
    { bodyLimit: TEXT_BODY_LIMIT + 2048, config: { auth: 'session', limit: 'venueStudio' } },
    async (request, reply) => {
      const who = await ownerGate(request, reply);
      if (!who) return reply;
      const body = ImportTextBody.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      if (TABLE_HEAD.test(body.data.text))
        return apiError(reply, 422, 'INVALID_MESSAGE', { reason: 'table_format' });
      return importAnswer(reply, () =>
        deps.drafts.importText({ ...who, ...body.data, text: body.data.text }),
      );
    },
  );

  app.post(
    '/v1/venues/:venueId/authoring/import-file',
    {
      bodyLimit: DOCUMENT_BODY_LIMIT + 1024,
      config: { auth: 'session', limit: 'venueAuthoring' },
    },
    async (request, reply) => {
      const who = await ownerGate(request, reply);
      if (!who) return reply;
      const body = ImportFileBody.safeParse(request.body);
      if (!body.success || !BASE64.test(body.data.data))
        return apiError(reply, 400, 'INVALID_MESSAGE');
      const extracted = await extractDocument(
        new Uint8Array(Buffer.from(body.data.data, 'base64')),
        body.data.fileName,
      );
      if (!extracted.ok) {
        if (extracted.code === 'busy')
          return apiError(reply, 429, 'RATE_LIMITED', { reason: 'busy' });
        if (extracted.code !== 'too_big' && extracted.code !== 'no_text')
          deps.security.record('VENUE_CONTENT_REJECTED', {
            ipHash: ipHashOf(request),
            detail: { authoring: true, code: extracted.code },
          });
        return apiError(reply, 422, 'INVALID_MESSAGE', { reason: extracted.code });
      }
      const text = extracted.sections.map((section) => section.text).join('\n');
      if (TABLE_HEAD.test(text))
        return apiError(reply, 422, 'INVALID_MESSAGE', { reason: 'table_format' });
      return importAnswer(reply, () =>
        deps.drafts.importText({
          venueId: who.venueId,
          accountId: who.accountId,
          fileName: body.data.fileName.slice(0, 120),
          text,
          category: body.data.category,
          difficulty: body.data.difficulty,
        }),
      );
    },
  );

  app.post(
    '/v1/venues/:venueId/authoring/options',
    { config: { auth: 'session', limit: 'venueStudio' } },
    async (request, reply) => {
      const who = await ownerGate(request, reply);
      if (!who) return reply;
      const body = OptionsBody.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      const category = body.data.category?.toLocaleLowerCase('tr') ?? '';
      const fetchPool = async (sameCategory: boolean): Promise<string[]> => {
        let query = db
          .selectFrom('question_options as o')
          .innerJoin('questions as q', 'q.id', 'o.question_id')
          .innerJoin('categories as c', 'c.id', 'q.category_id')
          .select('o.text')
          .where('o.is_correct', '=', true)
          .where('q.status', '=', 'ACTIVE')
          .where('q.language', '=', 'tr')
          // The global pool and this café's own questions; another café's private ones are never read.
          .where((eb) =>
            eb.or([eb('q.owner_venue_id', 'is', null), eb('q.owner_venue_id', '=', who.venueId)]),
          );
        if (sameCategory) query = query.where(sql<boolean>`lower(c.label_tr) = ${category}`);
        const rows = await query
          .orderBy(sql`random()`)
          .limit(400)
          .execute();
        return rows.map((row) => row.text);
      };
      let candidates = category ? await fetchPool(true) : [];
      // A small or unknown category borrows from the whole bank: the shape (words, capitals, digits) still matches.
      if (candidates.length < 12) candidates = [...candidates, ...(await fetchPool(false))];
      return suggestOptions({
        correct: body.data.correct,
        candidates,
        ...(body.data.own ? { own: body.data.own } : {}),
        random: Math.random,
      });
    },
  );

  app.get('/v1/venues/:venueId/authoring', { config: read }, async (request, reply) => {
    const who = await ownerGate(request, reply);
    if (!who) return reply;
    return {
      enabled: deps.authoring.enabled,
      quota: await deps.authoring.quota(who.venueId),
      limits: {
        maxBytes: EXTRACT_LIMITS.maxBytes,
        maxPages: EXTRACT_LIMITS.maxPages,
        maxChars: EXTRACT_LIMITS.maxChars,
      },
    };
  });

  app.post(
    '/v1/venues/:venueId/authoring/runs',
    {
      bodyLimit: DOCUMENT_BODY_LIMIT + 1024,
      config: { auth: 'session', limit: 'venueAuthoring' },
    },
    async (request, reply) => {
      const who = await ownerGate(request, reply);
      if (!who) return reply;
      const body = RunBody.safeParse(request.body);
      if (!body.success || !BASE64.test(body.data.data))
        return apiError(reply, 400, 'INVALID_MESSAGE');
      const bytes = new Uint8Array(Buffer.from(body.data.data, 'base64'));
      try {
        const { runId } = await deps.authoring.start({
          venueId: who.venueId,
          accountId: who.accountId,
          fileName: body.data.fileName,
          bytes,
          category: body.data.category,
        });
        return reply.code(202).send({ runId });
      } catch (error) {
        if (!(error instanceof AuthoringError)) throw error;
        switch (error.code) {
          case 'DISABLED':
            return apiError(reply, 404, 'FEATURE_DISABLED', { reason: 'authoring' });
          case 'QUOTA': {
            const params: Record<string, string | number> = {
              reason: error.detail.global ? 'busy' : 'quota',
            };
            if (typeof error.detail.limit === 'number') params.limit = error.detail.limit;
            if (typeof error.detail.resetAt === 'number') params.resetAt = error.detail.resetAt;
            return apiError(reply, 429, 'RATE_LIMITED', params);
          }
          case 'RUNNING':
            return apiError(reply, 409, 'INVALID_STATE', { reason: 'running' });
          case 'SAME_FILE':
            return apiError(reply, 409, 'INVALID_STATE', { reason: 'same_file' });
          case 'EXTRACT': {
            const code = String(error.detail.code);
            // Two documents are being read already: try again in a moment (not the file's fault).
            if (code === 'busy') return apiError(reply, 429, 'RATE_LIMITED', { reason: 'busy' });
            // A file that is not a document at all leaves a trace; an honest "too big" does not.
            if (code !== 'too_big' && code !== 'no_text')
              deps.security.record('VENUE_CONTENT_REJECTED', {
                ipHash: ipHashOf(request),
                detail: { authoring: true, code },
              });
            return apiError(reply, 422, 'INVALID_MESSAGE', { reason: code });
          }
          case 'NOT_FOUND':
            return apiError(reply, 404, 'NOT_FOUND');
        }
      }
    },
  );

  app.get('/v1/venues/:venueId/authoring/runs/:runId', { config: read }, async (request, reply) => {
    const who = await ownerGate(request, reply);
    if (!who) return reply;
    const params = RunParams.safeParse(request.params);
    if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
    try {
      return await deps.authoring.getRun(who.venueId, params.data.runId);
    } catch (error) {
      if (error instanceof AuthoringError) return apiError(reply, 404, 'NOT_FOUND');
      throw error;
    }
  });

  app.get('/v1/venues/:venueId/authoring/drafts', { config: read }, async (request, reply) => {
    const who = await ownerGate(request, reply);
    if (!who) return reply;
    return { items: await deps.drafts.list(who.venueId) };
  });

  app.post(
    '/v1/venues/:venueId/authoring/drafts/:draftId',
    { config: write },
    async (request, reply) => {
      const who = await ownerGate(request, reply);
      if (!who) return reply;
      const params = DraftParams.safeParse(request.params);
      const body = DraftEdit.safeParse(request.body);
      if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      const result = await deps.drafts.update(who.venueId, params.data.draftId, body.data);
      return result ?? apiError(reply, 404, 'NOT_FOUND');
    },
  );

  app.post(
    '/v1/venues/:venueId/authoring/drafts/:draftId/delete',
    { config: write },
    async (request, reply) => {
      const who = await ownerGate(request, reply);
      if (!who) return reply;
      const params = DraftParams.safeParse(request.params);
      if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
      return (await deps.drafts.remove(who.venueId, params.data.draftId))
        ? { ok: true }
        : apiError(reply, 404, 'NOT_FOUND');
    },
  );

  app.post(
    '/v1/venues/:venueId/authoring/drafts/approve',
    { config: write },
    async (request, reply) => {
      const who = await ownerGate(request, reply);
      if (!who) return reply;
      const body = ApproveBody.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      try {
        return await deps.drafts.approve(
          who.venueId,
          who.accountId,
          'all' in body.data ? 'all' : body.data.ids,
        );
      } catch (error) {
        if (error instanceof VenueContentError && error.code === 'VENUE_FULL')
          return apiError(reply, 409, 'LIMIT_REACHED');
        throw error;
      }
    },
  );

  // ───────────── the admin console: the per-venue daily quota (ADR-0028 §6) ─────────────
  const audit = new AdminAudit(db, deps.config, app.log);

  app.get(
    '/v1/admin/venues/:id/authoring',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.venuesRead } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      if (!params) return reply;
      const venue = await db
        .selectFrom('venues')
        .select('authoring_daily_runs')
        .where('id', '=', params.id)
        .executeTakeFirst();
      if (!venue) return adminError(reply, 404, 'NOT_FOUND');
      const quota = await deps.authoring.quota(params.id);
      return {
        enabled: deps.authoring.enabled,
        dailyRuns: venue.authoring_daily_runs,
        defaultRuns: deps.config.authoring?.dailyRuns ?? 0,
        usedToday: quota.used,
      };
    },
  );

  app.post(
    '/v1/admin/venues/:id/authoring',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.venuesWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(
            z.strictObject({ dailyRuns: z.int().min(0).max(500).nullable() }),
            request.body,
            reply,
          )
        : null;
      if (!params || !body) return reply;
      const result = await db
        .updateTable('venues')
        .set({ authoring_daily_runs: body.dailyRuns })
        .where('id', '=', params.id)
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) return adminError(reply, 404, 'NOT_FOUND');
      await audit.record(
        request,
        'venue.authoring_quota',
        { type: 'venue', id: params.id },
        {
          dailyRuns: body.dailyRuns,
        },
      );
      return { dailyRuns: body.dailyRuns };
    },
  );
}
