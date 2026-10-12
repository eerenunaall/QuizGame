import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@quizparty/db';
import { REPORT_REASONS, reviewQueue, resolveReport } from '@quizparty/question-bank';
import { QUESTION_STATUSES } from '@quizparty/question-schema';
import type { AppConfig } from '../config';
import { hmacHex } from '../security/crypto';
import type { RoomManager } from '../rooms/manager';
import type { AdminAudit } from './audit';
import {
  IdParams,
  Page,
  actorOf,
  adminError,
  clip,
  isoOrNull,
  lifecycleReply,
  parse,
} from './common';
import { CAN } from './permissions';

export interface ModerationRouteDeps {
  config: AppConfig;
  db: Database;
  manager: RoomManager;
  audit: AdminAudit;
}

const StatusList = z
  .string()
  .max(120)
  .transform((value) => value.split(',').filter(Boolean))
  .pipe(z.array(z.enum(QUESTION_STATUSES)).max(QUESTION_STATUSES.length));

/** Reports, the review queue, live rooms, bans and incidents: what staff do when players run into trouble. */
export function registerModerationRoutes(app: FastifyInstance, deps: ModerationRouteDeps): void {
  const { db, manager, audit, config } = deps;

  // ───────────── review queue ─────────────
  app.get(
    '/v1/admin/queue',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.queueRead } },
    async (request, reply) => {
      const query = parse(
        Page.extend({
          status: StatusList.optional(),
          category: z
            .string()
            .regex(/^[a-z0-9-]{1,40}$/u)
            .optional(),
          reason: z
            .string()
            .regex(/^[A-Z0-9_:]{1,80}$/u)
            .optional(),
        }).strict(),
        request.query,
        reply,
      );
      if (!query) return reply;
      const page = await reviewQueue(db, {
        statuses: query.status && query.status.length > 0 ? query.status : ['REVIEW'],
        ...(query.category ? { category: query.category } : {}),
        ...(query.reason ? { reason: query.reason } : {}),
        limit: query.limit,
        offset: query.offset,
      });
      return {
        total: page.total,
        items: page.entries.map((entry) => ({
          ...entry,
          updatedAt: entry.updatedAt.toISOString(),
          expiresAt: isoOrNull(entry.expiresAt),
        })),
      };
    },
  );

  // ───────────── player reports ─────────────
  app.get(
    '/v1/admin/reports',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.reportsRead } },
    async (request, reply) => {
      const query = parse(
        Page.extend({
          status: z.enum(['OPEN', 'ACTIONED', 'DISMISSED']).default('OPEN'),
          reason: z.enum(REPORT_REASONS).optional(),
          questionId: z.uuid().optional(),
        }).strict(),
        request.query,
        reply,
      );
      if (!query) return reply;
      let base = db
        .selectFrom('question_reports')
        .innerJoin('questions', 'questions.id', 'question_reports.question_id')
        .where('question_reports.status', '=', query.status);
      if (query.reason) base = base.where('question_reports.reason', '=', query.reason);
      if (query.questionId)
        base = base.where('question_reports.question_id', '=', query.questionId);
      const total = await base
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      const rows = await base
        .select([
          'question_reports.id as id',
          'question_reports.question_id as question_id',
          'question_reports.question_revision as report_revision',
          'question_reports.reason as reason',
          'question_reports.note as note',
          'question_reports.status as status',
          'question_reports.created_at as created_at',
          'question_reports.resolved_at as resolved_at',
          'question_reports.resolution as resolution',
          'questions.text as question_text',
          'questions.status as question_status',
          'questions.revision as question_revision',
          'questions.category_id as category',
        ])
        .orderBy('question_reports.created_at', 'desc')
        .orderBy('question_reports.id')
        .limit(query.limit)
        .offset(query.offset)
        .execute();
      // The reporter's pseudonym is deliberately not in the answer: moderators judge the report, not the person.
      return {
        total: Number(total.n),
        items: rows.map((row) => ({
          id: row.id,
          questionId: row.question_id,
          reportRevision: row.report_revision,
          reason: row.reason,
          note: row.note,
          status: row.status,
          createdAt: row.created_at.toISOString(),
          resolvedAt: isoOrNull(row.resolved_at),
          resolution: row.resolution,
          question: {
            text: row.question_text,
            status: row.question_status,
            revision: row.question_revision,
            category: row.category,
          },
        })),
      };
    },
  );

  app.post(
    '/v1/admin/reports/:id/resolve',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.reportsResolve } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(
            z.strictObject({
              action: z.enum(['DISMISS', 'SEND_TO_REVIEW', 'RETIRE', 'MARK_FIXED']),
              note: z.string().trim().max(300).optional(),
            }),
            request.body,
            reply,
          )
        : null;
      if (!params || !body) return reply;
      try {
        const outcome = await resolveReport(db, params.id, {
          actor: actorOf(request),
          action: body.action,
          ...(body.note ? { note: body.note } : {}),
        });
        await audit.record(
          request,
          'report.resolve',
          { type: 'report', id: params.id },
          { action: body.action, ...outcome },
        );
        return outcome;
      } catch (error) {
        return lifecycleReply(reply, error);
      }
    },
  );

  // ───────────── live rooms ─────────────
  app.get(
    '/v1/admin/rooms',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.roomsRead } },
    () => ({
      note: 'rooms held by this instance',
      items: manager.all().map((room) => {
        const view = room.adminView();
        return {
          id: view.id,
          code: view.code,
          phase: view.phase,
          tier: view.tier,
          language: view.language,
          players: view.players.filter((p) => p.status === 'ACTIVE').length,
          connections: view.connections,
          createdAt: new Date(view.createdAt).toISOString(),
        };
      }),
    }),
  );

  app.get(
    '/v1/admin/rooms/:id',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.roomsRead } },
    (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      if (!params) return reply;
      const room = manager.get(params.id);
      if (!room) return adminError(reply, 404, 'NOT_FOUND');
      const { players, ...rest } = room.adminView();
      // Session ids stay on the server: a moderator acts on a player, not on a credential.
      return { ...rest, players: players.map(({ sessionId: _sessionId, ...player }) => player) };
    },
  );

  app.post(
    '/v1/admin/rooms/:id/close',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.roomsAct } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      if (!params) return reply;
      const room = manager.get(params.id);
      if (room) await room.closeByAdmin();
      else {
        const exists = await db
          .selectFrom('rooms')
          .select('id')
          .where('id', '=', params.id)
          .where('status', '=', 'ACTIVE')
          .executeTakeFirst();
        if (!exists) return adminError(reply, 404, 'NOT_FOUND');
        await manager.closeRemote(params.id, 'ADMIN');
      }
      await audit.record(request, 'room.close', { type: 'room', id: params.id });
      return { ok: true };
    },
  );

  // ───────────── bans ─────────────
  const BanKind = z.enum(['IP', 'DEVICE', 'ACCOUNT']);
  app.get(
    '/v1/admin/bans',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.bansRead } },
    async (request, reply) => {
      const query = parse(
        Page.extend({ open: z.enum(['1', '0']).default('1') }).strict(),
        request.query,
        reply,
      );
      if (!query) return reply;
      let base = db.selectFrom('bans');
      base =
        query.open === '1'
          ? base.where('lifted_at', 'is', null)
          : base.where('lifted_at', 'is not', null);
      const total = await base
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      const rows = await base
        .select([
          'id',
          'kind',
          'reason',
          'created_by',
          'created_at',
          'expires_at',
          'lifted_at',
          'lifted_by',
        ])
        .orderBy('created_at', 'desc')
        .limit(query.limit)
        .offset(query.offset)
        .execute();
      // The subject hash is never shown: staff see that a ban exists and why, not whom by address.
      return {
        total: Number(total.n),
        items: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          reason: row.reason,
          createdBy: row.created_by,
          createdAt: row.created_at.toISOString(),
          expiresAt: isoOrNull(row.expires_at),
          liftedAt: isoOrNull(row.lifted_at),
          liftedBy: row.lifted_by,
        })),
      };
    },
  );

  app.post(
    '/v1/admin/rooms/:id/players/:playerId/ban',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.bansWrite } },
    async (request, reply) => {
      const params = parse(
        z.strictObject({ id: z.uuid(), playerId: z.string().min(1).max(64) }),
        request.params,
        reply,
      );
      const body = params
        ? parse(
            z.strictObject({
              kind: BanKind.exclude(['ACCOUNT']),
              reason: z.string().trim().min(3).max(300),
              hours: z
                .int()
                .min(1)
                .max(24 * 365)
                .nullable()
                .default(null),
            }),
            request.body,
            reply,
          )
        : null;
      if (!params || !body) return reply;
      const room = manager.get(params.id);
      const player = room?.adminView().players.find((p) => p.playerId === params.playerId);
      if (!room || !player) return adminError(reply, 404, 'NOT_FOUND');
      const session = await db
        .selectFrom('room_sessions')
        .select(['ip_hash', 'device_hash'])
        .where('id', '=', player.sessionId)
        .executeTakeFirst();
      const subject = body.kind === 'IP' ? session?.ip_hash : session?.device_hash;
      if (!subject) return adminError(reply, 409, 'NO_SUBJECT');
      const created = await db
        .insertInto('bans')
        .values({
          kind: body.kind,
          subject_hash: subject,
          reason: body.reason,
          created_by: request.auth!.account.id,
          expires_at: body.hours === null ? null : new Date(Date.now() + body.hours * 3_600_000),
        })
        .onConflict((conflict) => conflict.doNothing())
        .returning('id')
        .executeTakeFirst();
      // Cut the live connection now; the ban keeps the person out afterwards.
      room.expelSession(player.sessionId);
      await deps.db
        .updateTable('room_sessions')
        .set({ status: 'REVOKED' })
        .where('id', '=', player.sessionId)
        .execute();
      await audit.record(
        request,
        'ban.create',
        { type: 'ban', id: created?.id ?? null },
        { kind: body.kind, hours: body.hours, via: 'room' },
      );
      return reply
        .code(created ? 201 : 200)
        .send({ ok: true, id: created?.id ?? null, alreadyBanned: !created });
    },
  );

  app.post(
    '/v1/admin/accounts/:id/ban',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.bansWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(
            z.strictObject({
              reason: z.string().trim().min(3).max(300),
              hours: z
                .int()
                .min(1)
                .max(24 * 365)
                .nullable()
                .default(null),
            }),
            request.body,
            reply,
          )
        : null;
      if (!params || !body) return reply;
      const account = await db
        .selectFrom('accounts')
        .select('id')
        .where('id', '=', params.id)
        .executeTakeFirst();
      if (!account) return adminError(reply, 404, 'NOT_FOUND');
      const created = await db
        .insertInto('bans')
        .values({
          kind: 'ACCOUNT',
          subject_hash: params.id,
          reason: body.reason,
          created_by: request.auth!.account.id,
          expires_at: body.hours === null ? null : new Date(Date.now() + body.hours * 3_600_000),
        })
        .onConflict((conflict) => conflict.doNothing())
        .returning('id')
        .executeTakeFirst();
      await db
        .updateTable('account_sessions')
        .set({ revoked_at: new Date() })
        .where('account_id', '=', params.id)
        .where('revoked_at', 'is', null)
        .execute();
      await audit.record(
        request,
        'ban.create',
        { type: 'ban', id: created?.id ?? null },
        { kind: 'ACCOUNT', hours: body.hours, via: 'account' },
      );
      return reply
        .code(created ? 201 : 200)
        .send({ ok: true, id: created?.id ?? null, alreadyBanned: !created });
    },
  );

  app.post(
    '/v1/admin/bans/:id/lift',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.bansWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      if (!params) return reply;
      const lifted = await db
        .updateTable('bans')
        .set({ lifted_at: new Date(), lifted_by: request.auth!.account.id })
        .where('id', '=', params.id)
        .where('lifted_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (!lifted) return adminError(reply, 404, 'NOT_FOUND');
      await audit.record(request, 'ban.lift', { type: 'ban', id: params.id });
      return { ok: true };
    },
  );

  // ───────────── incidents ─────────────
  const Severity = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  app.get(
    '/v1/admin/incidents',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.incidentsRead } },
    async (request, reply) => {
      const query = parse(
        Page.extend({ status: z.enum(['OPEN', 'MITIGATED', 'RESOLVED']).optional() }).strict(),
        request.query,
        reply,
      );
      if (!query) return reply;
      let base = db.selectFrom('incidents');
      if (query.status) base = base.where('status', '=', query.status);
      const total = await base
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      const rows = await base
        .select([
          'id',
          'title',
          'severity',
          'status',
          'summary',
          'created_by',
          'created_at',
          'updated_at',
          'resolved_at',
        ])
        .orderBy('created_at', 'desc')
        .limit(query.limit)
        .offset(query.offset)
        .execute();
      return {
        total: Number(total.n),
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          severity: row.severity,
          status: row.status,
          summary: row.summary,
          createdBy: row.created_by,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          resolvedAt: isoOrNull(row.resolved_at),
        })),
      };
    },
  );

  app.get(
    '/v1/admin/incidents/:id',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.incidentsRead } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      if (!params) return reply;
      const incident = await db
        .selectFrom('incidents')
        .selectAll()
        .where('id', '=', params.id)
        .executeTakeFirst();
      if (!incident) return adminError(reply, 404, 'NOT_FOUND');
      const notes = await db
        .selectFrom('incident_notes')
        .select(['id', 'at', 'author_account_id', 'body'])
        .where('incident_id', '=', params.id)
        .orderBy('id')
        .execute();
      return {
        incident: {
          id: incident.id,
          title: incident.title,
          severity: incident.severity,
          status: incident.status,
          summary: incident.summary,
          createdAt: incident.created_at.toISOString(),
          updatedAt: incident.updated_at.toISOString(),
          resolvedAt: isoOrNull(incident.resolved_at),
        },
        notes: notes.map((n) => ({
          id: n.id,
          at: n.at.toISOString(),
          author: n.author_account_id,
          body: n.body,
        })),
      };
    },
  );

  app.post(
    '/v1/admin/incidents',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.incidentsWrite } },
    async (request, reply) => {
      const body = parse(
        z.strictObject({
          title: z.string().trim().min(3).max(160),
          severity: Severity,
          summary: z.string().max(4000).default(''),
        }),
        request.body,
        reply,
      );
      if (!body) return reply;
      const created = await db
        .insertInto('incidents')
        .values({
          title: body.title,
          severity: body.severity,
          summary: body.summary,
          created_by: request.auth!.account.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit.record(
        request,
        'incident.create',
        { type: 'incident', id: created.id },
        { severity: body.severity },
      );
      return reply.code(201).send({ id: created.id });
    },
  );

  app.patch(
    '/v1/admin/incidents/:id',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.incidentsWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(
            z.strictObject({
              status: z.enum(['OPEN', 'MITIGATED', 'RESOLVED']).optional(),
              severity: Severity.optional(),
              summary: z.string().max(4000).optional(),
            }),
            request.body,
            reply,
          )
        : null;
      if (!params || !body) return reply;
      const updated = await db
        .updateTable('incidents')
        .set({
          ...(body.status
            ? { status: body.status, resolved_at: body.status === 'RESOLVED' ? new Date() : null }
            : {}),
          ...(body.severity ? { severity: body.severity } : {}),
          ...(body.summary !== undefined ? { summary: body.summary } : {}),
        })
        .where('id', '=', params.id)
        .returning('id')
        .executeTakeFirst();
      if (!updated) return adminError(reply, 404, 'NOT_FOUND');
      await audit.record(
        request,
        'incident.update',
        { type: 'incident', id: params.id },
        {
          ...(body.status ? { status: body.status } : {}),
          ...(body.severity ? { severity: body.severity } : {}),
        },
      );
      return { ok: true };
    },
  );

  app.post(
    '/v1/admin/incidents/:id/notes',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.incidentsWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(z.strictObject({ body: z.string().trim().min(1).max(2000) }), request.body, reply)
        : null;
      if (!params || !body) return reply;
      const exists = await db
        .selectFrom('incidents')
        .select('id')
        .where('id', '=', params.id)
        .executeTakeFirst();
      if (!exists) return adminError(reply, 404, 'NOT_FOUND');
      const note = await db
        .insertInto('incident_notes')
        .values({
          incident_id: params.id,
          author_account_id: request.auth!.account.id,
          body: body.body,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit.record(
        request,
        'incident.note',
        { type: 'incident', id: params.id },
        { note: Number(note.id), length: body.body.length },
      );
      return reply.code(201).send({ id: Number(note.id) });
    },
  );

  // ───────────── security events ─────────────
  app.get(
    '/v1/admin/security-events',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.securityRead } },
    async (request, reply) => {
      const query = parse(
        Page.extend({
          kind: z
            .string()
            .regex(/^[A-Z0-9_]{1,60}$/u)
            .optional(),
        }).strict(),
        request.query,
        reply,
      );
      if (!query) return reply;
      let base = db.selectFrom('security_events');
      if (query.kind) base = base.where('kind', '=', query.kind);
      const total = await base
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      const rows = await base
        .select(['id', 'at', 'kind', 'room_id', 'session_id', 'ip_hash', 'detail'])
        .orderBy('id', 'desc')
        .limit(query.limit)
        .offset(query.offset)
        .execute();
      // Addresses appear only as a short, keyed fingerprint so repeats can be seen without exposing anyone.
      return {
        total: Number(total.n),
        items: rows.map((row) => ({
          id: Number(row.id),
          at: row.at.toISOString(),
          kind: row.kind,
          roomId: row.room_id,
          sessionId: row.session_id,
          source: row.ip_hash
            ? hmacHex(config.serverSecret, 'admin-view', row.ip_hash).slice(0, 8)
            : null,
          detail: clip(JSON.stringify(row.detail), 300),
        })),
      };
    },
  );
}
