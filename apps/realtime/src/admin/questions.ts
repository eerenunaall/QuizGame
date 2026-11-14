import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '@quizparty/db';
import {
  approveQuestion,
  computeFindings,
  editQuestion,
  exportForAudit,
  importAuditResults,
  importQuestions,
  listAudits,
  loadQuestion,
  parseImportText,
  parseResults,
  rejectQuestion,
  renderCsv,
  renderJsonl,
  runAudit,
  selectQuestionIds,
  transitionQuestion,
  type EditPatch,
} from '@quizparty/question-bank';
import {
  AUDIT_STATUSES,
  CsvError,
  JsonlLimitError,
  POOLS,
  QUESTION_STATUSES,
} from '@quizparty/question-schema';
import { DifficultySchema, LocaleSchema } from '@quizparty/protocol';
import type { AppConfig } from '../config';
import type { Clock } from '../util/clock';
import type { AdminAudit } from './audit';
import {
  IdParams,
  Page,
  actorOf,
  adminError,
  isoOrNull,
  lifecycleReply,
  likeTerm,
  parse,
} from './common';
import type { AuditEngine } from './engine';
import { CAN } from './permissions';

export interface QuestionRouteDeps {
  config: AppConfig;
  db: Database;
  clock: Clock;
  audit: AdminAudit;
  engine: AuditEngine;
}

const StatusList = z
  .string()
  .max(120)
  .transform((value) => value.split(',').filter(Boolean))
  .pipe(z.array(z.enum(QUESTION_STATUSES)).max(QUESTION_STATUSES.length));

const ListQuery = Page.extend({
  status: StatusList.optional(),
  category: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/u)
    .optional(),
  language: LocaleSchema.optional(),
  pool: z.enum(POOLS).optional(),
  difficulty: DifficultySchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  expiring: z.enum(['1']).optional(),
  sort: z.enum(['updated', 'created', 'reports', 'usage']).default('updated'),
}).strict();

const OptionsSchema = z
  .array(z.strictObject({ text: z.string().min(1).max(200), correct: z.boolean() }))
  .min(2)
  .max(6);

const PatchBody = z.strictObject({
  expectedRevision: z.int().min(1),
  text: z.string().min(1).max(600).optional(),
  explanation: z.string().max(600).nullable().optional(),
  difficulty: DifficultySchema.optional(),
  category: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/u)
    .optional(),
  language: LocaleSchema.optional(),
  pool: z.enum(POOLS).optional(),
  options: OptionsSchema.optional(),
  subcategory: z.string().max(60).nullable().optional(),
  topic: z.string().max(60).nullable().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
  lastVerifiedAt: z.iso.datetime().nullable().optional(),
  sources: z
    .array(
      z.strictObject({ url: z.url().max(500), title: z.string().max(200).nullable().optional() }),
    )
    .max(10)
    .optional(),
});

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;

/** A file the parser refuses (unterminated quote, absurd cell, too many lines) is the editor's to fix: 422, not a fault. */
function readFile<T>(reply: FastifyReply, read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof CsvError || error instanceof JsonlLimitError)) throw error;
    adminError(reply, 422, 'INVALID_FILE', { reason: error.message });
    return null;
  }
}
const MAX_REPORTED_ITEMS = 500;

function toPatch(body: z.infer<typeof PatchBody>): EditPatch {
  return {
    ...(body.text !== undefined ? { text: body.text } : {}),
    ...(body.explanation !== undefined ? { explanation: body.explanation } : {}),
    ...(body.difficulty ? { difficulty: body.difficulty } : {}),
    ...(body.category ? { category: body.category } : {}),
    ...(body.language ? { language: body.language } : {}),
    ...(body.pool ? { pool: body.pool } : {}),
    ...(body.options ? { options: body.options } : {}),
    ...(body.subcategory !== undefined ? { subcategory: body.subcategory } : {}),
    ...(body.topic !== undefined ? { topic: body.topic } : {}),
    ...(body.expiresAt !== undefined
      ? { expiresAt: body.expiresAt === null ? null : new Date(body.expiresAt) }
      : {}),
    ...(body.lastVerifiedAt !== undefined
      ? { lastVerifiedAt: body.lastVerifiedAt === null ? null : new Date(body.lastVerifiedAt) }
      : {}),
    ...(body.sources
      ? { sources: body.sources.map((s) => ({ url: s.url, title: s.title ?? null })) }
      : {}),
  };
}

export function registerQuestionRoutes(app: FastifyInstance, deps: QuestionRouteDeps): void {
  const { db, clock, audit, engine } = deps;
  const now = (): Date => new Date(clock.now());

  app.get(
    '/v1/admin/questions',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.questionsRead } },
    async (request, reply) => {
      const query = parse(ListQuery, request.query, reply);
      if (!query) return reply;
      let base = db.selectFrom('questions');
      if (query.status && query.status.length > 0) base = base.where('status', 'in', query.status);
      if (query.category) base = base.where('category_id', '=', query.category);
      if (query.language) base = base.where('language', '=', query.language);
      if (query.pool) base = base.where('pool', '=', query.pool);
      if (query.difficulty) base = base.where('difficulty', '=', query.difficulty);
      if (query.expiring) base = base.where('expires_at', 'is not', null);
      if (query.q) {
        const term = query.q;
        base = z.uuid().safeParse(term).success
          ? base.where('id', '=', term)
          : base.where((eb) =>
              eb.or([eb('text', 'ilike', likeTerm(term)), eb('external_id', '=', term)]),
            );
      }
      const total = await base
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      const order = {
        updated: sql`updated_at DESC`,
        created: sql`created_at DESC`,
        reports: sql`report_count DESC, updated_at DESC`,
        usage: sql`usage_count DESC, updated_at DESC`,
      }[query.sort];
      const rows = await base
        .select([
          'id',
          'external_id',
          'status',
          'category_id',
          'difficulty',
          'language',
          'pool',
          'text',
          'revision',
          'report_count',
          'answer_count',
          'correct_answer_count',
          'usage_count',
          'expires_at',
          'updated_at',
          'is_dev_seed',
        ])
        .orderBy(order)
        .orderBy('id')
        .limit(query.limit)
        .offset(query.offset)
        .execute();
      return {
        total: Number(total.n),
        items: rows.map((row) => ({
          id: row.id,
          externalId: row.external_id,
          status: row.status,
          category: row.category_id,
          difficulty: row.difficulty,
          language: row.language,
          pool: row.pool,
          text: row.text,
          revision: row.revision,
          reportCount: Number(row.report_count),
          answerCount: Number(row.answer_count),
          correctRate:
            Number(row.answer_count) > 0
              ? Math.round((Number(row.correct_answer_count) / Number(row.answer_count)) * 1000) /
                1000
              : null,
          usageCount: Number(row.usage_count),
          expiresAt: isoOrNull(row.expires_at),
          updatedAt: row.updated_at.toISOString(),
          isDevSeed: row.is_dev_seed,
        })),
      };
    },
  );

  app.get(
    '/v1/admin/questions/:id',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.questionsRead } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      if (!params) return reply;
      const stored = await loadQuestion(db, params.id);
      if (!stored) return adminError(reply, 404, 'NOT_FOUND');
      const [audits, log, options, counts, analysis] = await Promise.all([
        listAudits(db, stored.id),
        db
          .selectFrom('question_status_log')
          .select(['at', 'from_status', 'to_status', 'actor_account_id', 'reason', 'detail'])
          .where('question_id', '=', stored.id)
          .orderBy('id', 'desc')
          .limit(100)
          .execute(),
        db
          .selectFrom('question_options')
          .select(['id', 'position', 'pick_count'])
          .where('question_id', '=', stored.id)
          .orderBy('position')
          .execute(),
        db
          .selectFrom('question_reports')
          .select(['reason', 'status', (eb) => eb.fn.countAll<number>().as('n')])
          .where('question_id', '=', stored.id)
          .groupBy(['reason', 'status'])
          .execute(),
        computeFindings(db, stored, {
          now: now(),
          ...(engine.embeddings ? { embeddings: engine.embeddings } : {}),
        }),
      ]);
      const stats = await db
        .selectFrom('questions')
        .select([
          'usage_count',
          'answer_count',
          'correct_answer_count',
          'skip_count',
          'last_used_at',
          'verification_status',
          'retire_reason',
          'retired_at',
          'created_at',
          'updated_at',
        ])
        .where('id', '=', stored.id)
        .executeTakeFirstOrThrow();
      const picks = new Map(options.map((o) => [o.id, Number(o.pick_count)]));
      const { question } = stored;
      return {
        question: {
          id: stored.id,
          externalId: stored.externalId,
          revision: stored.revision,
          status: stored.status,
          isDevSeed: stored.isDevSeed,
          sourceRequired: stored.sourceRequired,
          language: question.language,
          category: question.category,
          subcategory: question.subcategory,
          topic: question.topic,
          difficulty: question.difficulty,
          pool: question.pool,
          text: question.text,
          explanation: question.explanation,
          authorType: question.authorType,
          options: stored.options.map((o) => ({
            id: o.id,
            position: o.position,
            text: o.text,
            correct: o.correct,
            pickCount: picks.get(o.id) ?? 0,
          })),
          sources: question.sources.map((s) => ({
            url: s.url,
            title: s.title,
            retrievedAt: isoOrNull(s.retrievedAt),
          })),
          expiresAt: isoOrNull(question.expiresAt),
          lastVerifiedAt: isoOrNull(question.lastVerifiedAt),
          verificationStatus: stats.verification_status,
          retiredAt: isoOrNull(stats.retired_at),
          retireReason: stats.retire_reason,
          createdAt: stats.created_at.toISOString(),
          updatedAt: stats.updated_at.toISOString(),
        },
        stats: {
          usageCount: Number(stats.usage_count),
          answerCount: Number(stats.answer_count),
          correctAnswerCount: Number(stats.correct_answer_count),
          skipCount: Number(stats.skip_count),
          lastUsedAt: isoOrNull(stats.last_used_at),
        },
        findings: analysis.findings.map((f) => ({
          code: f.code,
          severity: f.severity,
          dimension: f.dimension,
          ...(f.detail ? { detail: f.detail } : {}),
        })),
        audits: audits.map((a) => ({
          id: a.id,
          createdAt: a.createdAt.toISOString(),
          revision: a.revision,
          actor: a.actor,
          ...a.result,
        })),
        statusLog: log.map((l) => ({
          at: l.at.toISOString(),
          from: l.from_status,
          to: l.to_status,
          actor: l.actor_account_id,
          reason: l.reason,
          detail: l.detail,
        })),
        reports: counts.map((c) => ({ reason: c.reason, status: c.status, count: Number(c.n) })),
      };
    },
  );

  app.post(
    '/v1/admin/questions',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.questionsWrite } },
    async (request, reply) => {
      const body = parse(
        z.strictObject({ question: z.record(z.string(), z.unknown()) }),
        request.body,
        reply,
      );
      if (!body) return reply;
      const report = await importQuestions(db, [{ line: 1, raw: body.question }], {
        now: now(),
        actor: actorOf(request),
        source: 'admin',
        ...(engine.embeddings ? { embeddings: engine.embeddings } : {}),
      });
      const item = report.items[0]!;
      await audit.record(
        request,
        'question.create',
        { type: 'question', id: item.questionId ?? null },
        { outcome: item.outcome },
      );
      const status =
        item.outcome === 'CREATED'
          ? 201
          : ['DUPLICATE', 'CONFLICT', 'UNCHANGED', 'CHANGED'].includes(item.outcome)
            ? 409
            : 422;
      return reply.code(status).send({ item });
    },
  );

  app.post(
    '/v1/admin/questions/import',
    {
      bodyLimit: MAX_IMPORT_BYTES + 4096,
      config: { auth: 'admin', limit: 'adminHeavy', roles: CAN.questionsWrite },
    },
    async (request, reply) => {
      const body = parse(
        z.strictObject({
          format: z.enum(['jsonl', 'csv']),
          text: z.string().min(1).max(MAX_IMPORT_BYTES),
          dryRun: z.boolean().default(false),
          updateExisting: z.boolean().default(false),
        }),
        request.body,
        reply,
      );
      if (!body) return reply;
      const rows = readFile(reply, () => parseImportText(body.text, body.format));
      if (!rows) return reply;
      if (rows.length > MAX_IMPORT_ROWS)
        return adminError(reply, 413, 'TOO_MANY_ROWS', { max: MAX_IMPORT_ROWS });
      const report = await importQuestions(db, rows, {
        now: now(),
        actor: actorOf(request),
        dryRun: body.dryRun,
        updateExisting: body.updateExisting,
        source: 'admin-import',
        ...(engine.embeddings ? { embeddings: engine.embeddings } : {}),
      });
      await audit.record(
        request,
        body.dryRun ? 'question.import.dry-run' : 'question.import',
        { type: 'import' },
        { total: report.total, counts: report.counts },
      );
      const problems = report.items.filter(
        (i) => !['CREATED', 'UPDATED', 'UNCHANGED'].includes(i.outcome),
      );
      return {
        ...report,
        items: [
          ...problems.slice(0, MAX_REPORTED_ITEMS),
          ...report.items
            .filter((i) => ['CREATED', 'UPDATED'].includes(i.outcome))
            .slice(0, MAX_REPORTED_ITEMS - Math.min(problems.length, MAX_REPORTED_ITEMS)),
        ],
        itemsOmitted: Math.max(0, report.items.length - MAX_REPORTED_ITEMS),
      };
    },
  );

  app.patch(
    '/v1/admin/questions/:id',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.questionsWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params ? parse(PatchBody, request.body, reply) : null;
      if (!params || !body) return reply;
      try {
        const result = await editQuestion(
          db,
          params.id,
          toPatch(body),
          { actor: actorOf(request), expectedRevision: body.expectedRevision },
          {
            now: now(),
            ...(engine.embeddings ? { embeddings: engine.embeddings } : {}),
          },
        );
        await audit.record(
          request,
          'question.edit',
          { type: 'question', id: params.id },
          {
            fields: Object.keys(body).filter((k) => k !== 'expectedRevision'),
            revision: result.revision,
            demoted: result.demoted,
          },
        );
        return result;
      } catch (error) {
        return lifecycleReply(reply, error);
      }
    },
  );

  app.post(
    '/v1/admin/questions/:id/transition',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.questionsTransition } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(
            z.strictObject({
              to: z.enum(QUESTION_STATUSES),
              reason: z.string().trim().min(3).max(200),
            }),
            request.body,
            reply,
          )
        : null;
      if (!params || !body) return reply;
      try {
        const moved = await transitionQuestion(db, params.id, body.to, {
          actor: actorOf(request),
          reason: 'MANUAL_TRANSITION',
          note: body.reason,
        });
        await audit.record(
          request,
          'question.transition',
          { type: 'question', id: params.id },
          { from: moved.from, to: moved.to },
        );
        return moved;
      } catch (error) {
        return lifecycleReply(reply, error);
      }
    },
  );

  app.post(
    '/v1/admin/questions/:id/approve',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.questionsWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(
            z.strictObject({
              waive: z.union([z.literal('ALL'), z.array(z.string().max(80)).max(30)]),
              note: z.string().max(300).optional(),
            }),
            request.body,
            reply,
          )
        : null;
      if (!params || !body) return reply;
      try {
        const outcome = await approveQuestion(
          db,
          params.id,
          { actor: actorOf(request), waive: body.waive, ...(body.note ? { note: body.note } : {}) },
          { now: now(), ...(engine.embeddings ? { embeddings: engine.embeddings } : {}) },
        );
        await audit.record(
          request,
          'question.approve',
          { type: 'question', id: params.id },
          { waive: body.waive },
        );
        return { from: outcome.from, to: outcome.to, verdict: outcome.decision.status };
      } catch (error) {
        return lifecycleReply(reply, error);
      }
    },
  );

  app.post(
    '/v1/admin/questions/:id/reject',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.questionsWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(
            z.strictObject({
              reason: z.string().trim().min(3).max(120),
              note: z.string().max(300).optional(),
            }),
            request.body,
            reply,
          )
        : null;
      if (!params || !body) return reply;
      try {
        await rejectQuestion(db, params.id, {
          actor: actorOf(request),
          reason: body.reason,
          ...(body.note ? { note: body.note } : {}),
        });
        await audit.record(
          request,
          'question.reject',
          { type: 'question', id: params.id },
          { reason: body.reason },
        );
        return { ok: true };
      } catch (error) {
        return lifecycleReply(reply, error);
      }
    },
  );

  app.post(
    '/v1/admin/audit/run',
    { config: { auth: 'admin', limit: 'adminHeavy', roles: CAN.auditRun } },
    async (request, reply) => {
      const body = parse(
        z.strictObject({
          ids: z.array(z.uuid()).min(1).max(200).optional(),
          statuses: z.array(z.enum(QUESTION_STATUSES)).max(QUESTION_STATUSES.length).optional(),
          category: z
            .string()
            .regex(/^[a-z0-9-]{1,40}$/u)
            .optional(),
          language: LocaleSchema.optional(),
          unaudited: z.boolean().optional(),
          limit: z.int().min(1).max(200).default(100),
          dryRun: z.boolean().default(false),
          /** Operator policy: only an administrator may let a passing verdict publish by itself. */
          autoActivate: z.boolean().default(false),
        }),
        request.body,
        reply,
      );
      if (!body) return reply;
      if (body.autoActivate && !request.auth!.account.roles.includes('ADMIN'))
        return adminError(reply, 403, 'FORBIDDEN');
      const ids = await selectQuestionIds(db, {
        ...(body.ids ? { ids: body.ids } : { statuses: body.statuses ?? ['DRAFT', 'REVIEW'] }),
        ...(body.category ? { category: body.category } : {}),
        ...(body.language ? { language: body.language } : {}),
        ...(body.unaudited ? { unaudited: true } : {}),
        limit: body.limit,
      });
      const report = await runAudit(db, ids, {
        now: now(),
        providers: engine.providers,
        dryRun: body.dryRun,
        autoActivate: body.autoActivate,
        actor: actorOf(request),
        tokenBudget: 400_000,
        ...(engine.embeddings ? { embeddings: engine.embeddings } : {}),
      });
      await audit.record(
        request,
        body.dryRun ? 'audit.run.dry-run' : 'audit.run',
        { type: 'audit' },
        { total: report.total, changes: report.statusChanges, autoActivate: body.autoActivate },
      );
      return {
        ...report,
        items: report.items.slice(0, 200),
        modelsConfigured: engine.providers.length > 0,
      };
    },
  );

  app.post(
    '/v1/admin/audit/results',
    {
      bodyLimit: 2 * 1024 * 1024 + 4096,
      config: { auth: 'admin', limit: 'adminHeavy', roles: CAN.auditRun },
    },
    async (request, reply) => {
      const body = parse(
        z.strictObject({
          source: z
            .string()
            .trim()
            .regex(/^[\w .@-]{2,60}$/u),
          text: z
            .string()
            .min(1)
            .max(2 * 1024 * 1024),
        }),
        request.body,
        reply,
      );
      if (!body) return reply;
      const parsedResults = readFile(reply, () => parseResults(body.text));
      if (!parsedResults) return reply;
      const report = await importAuditResults(db, parsedResults, {
        now: now(),
        source: body.source,
        actor: actorOf(request),
        ...(engine.embeddings ? { embeddings: engine.embeddings } : {}),
      });
      await audit.record(
        request,
        'audit.results.import',
        { type: 'audit' },
        { source: body.source, applied: report.applied, skipped: report.skipped.length },
      );
      return { ...report, skipped: report.skipped.slice(0, 200) };
    },
  );

  app.get(
    '/v1/admin/export',
    { config: { auth: 'admin', limit: 'adminHeavy', roles: CAN.auditRun } },
    async (request, reply) => {
      const query = parse(
        z.strictObject({
          format: z.enum(['jsonl', 'csv']).default('jsonl'),
          status: StatusList.optional(),
          category: z
            .string()
            .regex(/^[a-z0-9-]{1,40}$/u)
            .optional(),
          limit: z.coerce.number().int().min(1).max(5000).default(1000),
        }),
        request.query,
        reply,
      );
      if (!query) return reply;
      const rows = await exportForAudit(db, {
        statuses: query.status && query.status.length > 0 ? query.status : ['DRAFT', 'REVIEW'],
        ...(query.category ? { category: query.category } : {}),
        limit: query.limit,
      });
      await audit.record(
        request,
        'audit.export',
        { type: 'audit' },
        { rows: rows.length, format: query.format },
      );
      void reply
        .header(
          'content-type',
          query.format === 'csv'
            ? 'text/csv; charset=utf-8'
            : 'application/x-ndjson; charset=utf-8',
        )
        .header('content-disposition', `attachment; filename="questions.${query.format}"`);
      return query.format === 'csv' ? renderCsv(rows) : renderJsonl(rows);
    },
  );

  // Verdict vocabulary the console shows next to a question (kept here so the API owns the list).
  app.get(
    '/v1/admin/vocabulary',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.questionsRead } },
    () => ({ statuses: QUESTION_STATUSES, verdicts: AUDIT_STATUSES, pools: POOLS }),
  );
}
