import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '@quizparty/db';
import type { AppConfig } from '../config';
import { apiError } from '../http/routes';
import { pseudonym } from '../security/crypto';
import type { SecurityLog } from '../security/events';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import { clientIp } from '../ws/gateway';
import type { VenueRole, VenueService } from './service';

export interface VenueBankDeps {
  config: AppConfig;
  db: Database;
  venues: VenueService;
  limiter: RateLimiter;
  security: SecurityLog;
  onError: (error: unknown) => void;
}

const VenueParams = z.strictObject({ venueId: z.uuid() });
const CategoryQuery = z.strictObject({
  scope: z.enum(['GLOBAL', 'VENUE']).default('GLOBAL'),
  language: z.enum(['tr', 'en']).default('tr'),
});
const QuestionQuery = z.strictObject({
  scope: z.enum(['GLOBAL', 'VENUE']).default('GLOBAL'),
  language: z.enum(['tr', 'en']).default('tr'),
  q: z.string().trim().max(60).optional(),
  category: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/u)
    .optional(),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});
const PAGE = 12;
/** Questions the global browser shows are the ones guests can actually be asked. */
const PLAYABLE = 'ACTIVE';

const likeEscape = (text: string): string => text.replace(/[\\%_]/gu, (char) => `\\${char}`);

/**
 * The owner's answers view (ADR-0030 §5): a read-only browser of the venue's own questions and of the
 * global bank, with the correct option marked, so the café can check what guests will be asked. This
 * is a deliberate exception to "answers are not sent early": the data goes to one authenticated OWNER's
 * panel and never into a room. OWNER only (staff 403, anyone else 404, an admin-console session 403),
 * rate limited, and every read leaves a record. Other venues' private questions are not selectable here:
 * the scope is the global pool or the caller's own venue, fixed in the query, never taken from a parameter.
 */
export function registerVenueBankRoutes(app: FastifyInstance, deps: VenueBankDeps): void {
  const { venues, limiter, db } = deps;
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
      deps.security.record('VENUE_BANK_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method },
      });
      apiError(reply, 404, 'NOT_FOUND');
      return null;
    }
    if (role !== 'OWNER') {
      deps.security.record('VENUE_BANK_FORBIDDEN', {
        ipHash: ipHashOf(request),
        detail: { method: request.method, owner: true },
      });
      apiError(reply, 403, 'FORBIDDEN');
      return null;
    }
    const byVenue = limiter.take(`venueBankVenue:${params.data.venueId}`, LIMITS.venueBankVenue);
    if (!byVenue.allowed) {
      apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: byVenue.retryAfterMs });
      return null;
    }
    return { accountId: auth.account.id, venueId: params.data.venueId, role };
  }

  /** Not throttled like the security log: each read of the bank is a row, the route's own limit caps volume. */
  const logRead = (
    request: FastifyRequest,
    who: { accountId: string; venueId: string },
    detail: Record<string, string | number | boolean>,
  ): Promise<unknown> =>
    db
      .insertInto('security_events')
      .values({
        kind: 'VENUE_BANK_READ',
        ip_hash: ipHashOf(request),
        detail: JSON.stringify({ venue: who.venueId, account: who.accountId, ...detail }),
      })
      .execute();

  const policy = { auth: 'session', limit: 'venueBank' } as const;

  app.get('/v1/venues/:venueId/bank/categories', { config: policy }, async (request, reply) => {
    const who = await gate(request, reply);
    if (!who) return reply;
    const query = CategoryQuery.safeParse(request.query);
    if (!query.success) return apiError(reply, 400, 'INVALID_MESSAGE');
    const { scope, language } = query.data;
    const global = scope === 'GLOBAL';
    let categories = db
      .selectFrom('categories')
      .select(['id', 'label_tr', 'label_en', 'sort_order'])
      .where('enabled', '=', true);
    categories = global
      ? categories.where('owner_venue_id', 'is', null)
      : categories.where('owner_venue_id', '=', who.venueId);
    let counts = db
      .selectFrom('questions')
      .select(['category_id', sql<number>`count(*)`.as('n')])
      .where('language', '=', language);
    counts = global
      ? counts
          .where('owner_venue_id', 'is', null)
          .where('pool', '!=', 'VENUE')
          .where('status', '=', PLAYABLE)
      : counts
          .where('owner_venue_id', '=', who.venueId)
          .where('status', 'in', ['ACTIVE', 'REVIEW', 'RETIRED']);
    const [rows, perCategory] = await Promise.all([
      categories.orderBy('sort_order').execute(),
      counts.groupBy('category_id').execute(),
    ]);
    const countOf = new Map(perCategory.map((row) => [row.category_id, Number(row.n)]));
    await logRead(request, who, { what: 'categories', scope, language });
    return {
      categories: rows
        .map((row) => ({
          id: row.id,
          label: language === 'tr' ? row.label_tr : row.label_en,
          count: countOf.get(row.id) ?? 0,
        }))
        .filter((row) => row.count > 0),
    };
  });

  app.get('/v1/venues/:venueId/bank/questions', { config: policy }, async (request, reply) => {
    const who = await gate(request, reply);
    if (!who) return reply;
    const query = QuestionQuery.safeParse(request.query);
    if (!query.success) return apiError(reply, 400, 'INVALID_MESSAGE');
    const { scope, language, q, category, offset } = query.data;

    let base = db
      .selectFrom('questions')
      .innerJoin('categories', 'categories.id', 'questions.category_id')
      .where('questions.language', '=', language);
    // The scope is fixed here: the global pool (what guests are asked) or this venue's own questions.
    base =
      scope === 'GLOBAL'
        ? base
            .where('questions.owner_venue_id', 'is', null)
            .where('questions.pool', '!=', 'VENUE')
            .where('questions.status', '=', PLAYABLE)
        : base
            .where('questions.owner_venue_id', '=', who.venueId)
            .where('questions.status', 'in', ['ACTIVE', 'REVIEW', 'RETIRED']);
    if (category) base = base.where('questions.category_id', '=', category);
    if (q && q.length >= 2)
      base = base.where(sql<boolean>`questions.text ILIKE ${`%${likeEscape(q)}%`} ESCAPE '\\'`);

    const [rows, total] = await Promise.all([
      base
        .select([
          'questions.id as id',
          'questions.text as text',
          'questions.explanation as explanation',
          'questions.status as status',
          'questions.difficulty as difficulty',
          language === 'tr' ? 'categories.label_tr as category' : 'categories.label_en as category',
        ])
        .orderBy('questions.created_at')
        .orderBy('questions.id')
        .limit(PAGE + 1)
        .offset(offset)
        .execute(),
      base.select(sql<number>`count(*)`.as('n')).executeTakeFirstOrThrow(),
    ]);
    const page = rows.slice(0, PAGE);
    const options =
      page.length === 0
        ? []
        : await db
            .selectFrom('question_options')
            .select(['question_id', 'position', 'text', 'is_correct'])
            .where(
              'question_id',
              'in',
              page.map((row) => row.id),
            )
            .orderBy('position')
            .execute();
    await logRead(request, who, {
      what: 'questions',
      scope,
      language,
      search: q !== undefined && q.length > 0,
      category: category ?? '',
      offset,
      returned: page.length,
    });
    return {
      total: Number(total.n),
      hasMore: rows.length > PAGE,
      items: page.map((row) => ({
        id: row.id,
        text: row.text,
        explanation: row.explanation,
        status: row.status,
        difficulty: row.difficulty,
        category: row.category,
        options: options
          .filter((option) => option.question_id === row.id)
          .map((option) => ({ text: option.text, correct: option.is_correct })),
      })),
    };
  });
}
