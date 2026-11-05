import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '@quizparty/db';
import { VenueContentError, analyzeVenueUpload, importVenueUpload } from '@quizparty/question-bank';
import type { VenueIssue } from '@quizparty/question-schema';
import type { AppConfig } from '../config';
import { apiError } from '../http/routes';
import { pseudonym } from '../security/crypto';
import type { SecurityLog } from '../security/events';
import type { RateLimiter } from '../security/rate-limit';
import type { Clock } from '../util/clock';
import { clientIp } from '../ws/gateway';
import type { VenueService } from './service';

export interface AuthoringDeps {
  config: AppConfig;
  db: Database;
  venues: VenueService;
  limiter: RateLimiter;
  security: SecurityLog;
  clock: Clock;
}

const VenueParams = z.strictObject({ venueId: z.uuid() });
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
}
