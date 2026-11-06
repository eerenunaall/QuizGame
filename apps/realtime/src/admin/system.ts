import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '@quizparty/db';
import { ROLES, type AccountService } from '../auth/accounts';
import type { AccountSessionService } from '../auth/account-sessions';
import type { FeatureFlags } from '../flags/service';
import type { RoomManager } from '../rooms/manager';
import type { AdminAudit } from './audit';
import { IdParams, Page, adminError, isoOrNull, parse } from './common';
import { CAN } from './permissions';

export interface SystemRouteDeps {
  db: Database;
  accounts: AccountService;
  accountSessions: AccountSessionService;
  flags: FeatureFlags;
  manager: RoomManager;
  audit: AdminAudit;
}

/** Settings and oversight: feature flags, categories, people and their roles, the audit log, numbers. */
export function registerSystemRoutes(app: FastifyInstance, deps: SystemRouteDeps): void {
  const { db, accounts, accountSessions, flags, audit } = deps;

  // ───────────── feature flags ─────────────
  app.get(
    '/v1/admin/flags',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.flagsRead } },
    async () => {
      const rows = await db
        .selectFrom('feature_flags')
        .select(['key', 'enabled', 'description', 'public', 'updated_at', 'updated_by'])
        .orderBy('key')
        .execute();
      return {
        items: rows.map((row) => ({
          key: row.key,
          enabled: row.enabled,
          description: row.description,
          public: row.public,
          updatedAt: row.updated_at.toISOString(),
          updatedBy: row.updated_by,
        })),
      };
    },
  );

  app.put(
    '/v1/admin/flags/:key',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.flagsWrite } },
    async (request, reply) => {
      const params = parse(
        z.strictObject({ key: z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/u) }),
        request.params,
        reply,
      );
      const body = params
        ? parse(z.strictObject({ enabled: z.boolean() }), request.body, reply)
        : null;
      if (!params || !body) return reply;
      // Switching a flag on or off is the only change: new flags and their visibility are a migration.
      const updated = await db
        .updateTable('feature_flags')
        .set({
          enabled: body.enabled,
          updated_at: new Date(),
          updated_by: request.auth!.account.id,
        })
        .where('key', '=', params.key)
        .returning(['key', 'enabled'])
        .executeTakeFirst();
      if (!updated) return adminError(reply, 404, 'NOT_FOUND');
      flags.invalidate();
      await audit.record(
        request,
        'flag.set',
        { type: 'flag', id: params.key },
        { enabled: body.enabled },
      );
      return updated;
    },
  );

  // ───────────── categories ─────────────
  app.get(
    '/v1/admin/categories',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.categoriesRead } },
    async () => {
      const rows = await db
        .selectFrom('categories')
        .leftJoin('questions', (join) => join.onRef('questions.category_id', '=', 'categories.id'))
        .select([
          'categories.id as id',
          'categories.label_tr as label_tr',
          'categories.label_en as label_en',
          'categories.enabled as enabled',
          'categories.free_rotation as free_rotation',
          'categories.source_required as source_required',
          'categories.sort_order as sort_order',
          sql<number>`count(questions.id)::int`.as('total'),
          sql<number>`count(questions.id) FILTER (WHERE questions.status = 'ACTIVE')::int`.as(
            'active',
          ),
          sql<number>`count(questions.id) FILTER (WHERE questions.status = 'REVIEW')::int`.as(
            'review',
          ),
        ])
        .groupBy('categories.id')
        .orderBy('categories.sort_order')
        .orderBy('categories.id')
        .execute();
      return {
        items: rows.map((row) => ({
          id: row.id,
          labelTr: row.label_tr,
          labelEn: row.label_en,
          enabled: row.enabled,
          freeRotation: row.free_rotation,
          sourceRequired: row.source_required,
          sortOrder: row.sort_order,
          questions: { total: row.total, active: row.active, review: row.review },
        })),
      };
    },
  );

  app.patch(
    '/v1/admin/categories/:id',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.categoriesWrite } },
    async (request, reply) => {
      const params = parse(
        z.strictObject({ id: z.string().regex(/^[a-z0-9-]{1,40}$/u) }),
        request.params,
        reply,
      );
      const body = params
        ? parse(
            z.strictObject({
              enabled: z.boolean().optional(),
              freeRotation: z.boolean().optional(),
              sourceRequired: z.boolean().optional(),
              sortOrder: z.int().min(0).max(1000).optional(),
              labelTr: z.string().trim().min(1).max(60).optional(),
              labelEn: z.string().trim().min(1).max(60).optional(),
            }),
            request.body,
            reply,
          )
        : null;
      if (!params || !body) return reply;
      if (Object.keys(body).length === 0)
        return adminError(reply, 400, 'INVALID_REQUEST', { fields: ['(body)'] });
      const updated = await db
        .updateTable('categories')
        .set({
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.freeRotation !== undefined ? { free_rotation: body.freeRotation } : {}),
          ...(body.sourceRequired !== undefined ? { source_required: body.sourceRequired } : {}),
          ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
          ...(body.labelTr !== undefined ? { label_tr: body.labelTr } : {}),
          ...(body.labelEn !== undefined ? { label_en: body.labelEn } : {}),
        })
        .where('id', '=', params.id)
        .returning('id')
        .executeTakeFirst();
      if (!updated) return adminError(reply, 404, 'NOT_FOUND');
      await audit.record(request, 'category.update', { type: 'category', id: params.id }, body);
      return { ok: true };
    },
  );

  // ───────────── people and roles ─────────────
  const viewOf = (account: Awaited<ReturnType<AccountService['get']>> & object) => ({
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    status: account.status,
    roles: account.roles,
    createdAt: account.createdAt.toISOString(),
    lastLoginAt: isoOrNull(account.lastLoginAt),
  });

  app.get(
    '/v1/admin/users',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.usersRead } },
    async (request, reply) => {
      const query = parse(
        Page.extend({
          search: z.string().trim().min(1).max(100).optional(),
          role: z.enum(ROLES).optional(),
        }).strict(),
        request.query,
        reply,
      );
      if (!query) return reply;
      const result = await accounts.list({
        limit: query.limit,
        offset: query.offset,
        ...(query.search ? { search: query.search } : {}),
        ...(query.role ? { role: query.role } : {}),
      });
      return { total: result.total, items: result.accounts.map(viewOf) };
    },
  );

  app.put(
    '/v1/admin/users/:id/roles',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.usersWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(
            z.strictObject({ roles: z.array(z.enum(ROLES)).max(ROLES.length) }),
            request.body,
            reply,
          )
        : null;
      if (!params || !body) return reply;
      const roles = [...new Set(body.roles)];
      const outcome = await accounts.setRoles(params.id, roles, request.auth!.account.id);
      if (outcome === 'NOT_FOUND') return adminError(reply, 404, 'NOT_FOUND');
      if (outcome === 'LAST_ADMIN') return adminError(reply, 409, 'LAST_ADMIN');
      await audit.record(request, 'user.roles', { type: 'account', id: params.id }, { roles });
      return { ok: true, roles };
    },
  );

  app.post(
    '/v1/admin/users/:id/status',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.usersWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      const body = params
        ? parse(z.strictObject({ status: z.enum(['ACTIVE', 'SUSPENDED']) }), request.body, reply)
        : null;
      if (!params || !body) return reply;
      const outcome = await accounts.setStatus(params.id, body.status);
      if (outcome === 'NOT_FOUND') return adminError(reply, 404, 'NOT_FOUND');
      if (outcome === 'LAST_ADMIN') return adminError(reply, 409, 'LAST_ADMIN');
      await audit.record(
        request,
        'user.status',
        { type: 'account', id: params.id },
        { status: body.status },
      );
      return { ok: true };
    },
  );

  app.post(
    '/v1/admin/users/:id/sign-out',
    { config: { auth: 'admin', limit: 'adminWrite', roles: CAN.usersWrite } },
    async (request, reply) => {
      const params = parse(IdParams, request.params, reply);
      if (!params) return reply;
      if (!(await accounts.get(params.id))) return adminError(reply, 404, 'NOT_FOUND');
      await accountSessions.revokeAll(params.id);
      await audit.record(request, 'user.sign-out', { type: 'account', id: params.id });
      return { ok: true };
    },
  );

  // ───────────── audit log ─────────────
  app.get(
    '/v1/admin/audit-log',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.auditLogRead } },
    async (request, reply) => {
      const query = parse(
        Page.extend({
          actor: z.uuid().optional(),
          action: z
            .string()
            .regex(/^[a-z0-9.-]{1,80}$/u)
            .optional(),
          targetType: z
            .string()
            .regex(/^[a-z0-9-]{1,40}$/u)
            .optional(),
          targetId: z.string().max(80).optional(),
        }).strict(),
        request.query,
        reply,
      );
      if (!query) return reply;
      let base = db.selectFrom('admin_audit');
      if (query.actor) base = base.where('actor_account_id', '=', query.actor);
      if (query.action) base = base.where('action', '=', query.action);
      if (query.targetType) base = base.where('target_type', '=', query.targetType);
      if (query.targetId) base = base.where('target_id', '=', query.targetId);
      const total = await base
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      const rows = await base
        .select([
          'id',
          'at',
          'actor_account_id',
          'actor_roles',
          'action',
          'target_type',
          'target_id',
          'detail',
          'request_id',
        ])
        .orderBy('id', 'desc')
        .limit(query.limit)
        .offset(query.offset)
        .execute();
      return {
        total: Number(total.n),
        items: rows.map((row) => ({
          id: Number(row.id),
          at: row.at.toISOString(),
          actor: row.actor_account_id,
          roles: row.actor_roles,
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          detail: row.detail,
          requestId: row.request_id,
        })),
      };
    },
  );

  // ───────────── numbers ─────────────
  app.get(
    '/v1/admin/stats',
    { config: { auth: 'admin', limit: 'adminRead', roles: CAN.statsRead } },
    async () => {
      const [byStatus, openReports, categories, rooms] = await Promise.all([
        db
          .selectFrom('questions')
          .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
          .groupBy('status')
          .execute(),
        db
          .selectFrom('question_reports')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('status', '=', 'OPEN')
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('questions')
          .select(['category_id', (eb) => eb.fn.countAll<number>().as('n')])
          .where('status', '=', 'ACTIVE')
          .groupBy('category_id')
          .orderBy('category_id')
          .execute(),
        db
          .selectFrom('rooms')
          .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
          .groupBy('status')
          .execute(),
      ]);
      const live = deps.manager.all();
      return {
        questions: Object.fromEntries(byStatus.map((row) => [row.status, Number(row.n)])),
        activeByCategory: Object.fromEntries(
          categories.map((row) => [row.category_id, Number(row.n)]),
        ),
        openReports: Number(openReports.n),
        rooms: {
          held: live.length,
          players: live.reduce(
            (sum, room) =>
              sum + room.adminView().players.filter((p) => p.status === 'ACTIVE').length,
            0,
          ),
          byStatus: Object.fromEntries(rooms.map((row) => [row.status, Number(row.n)])),
        },
      };
    },
  );
}
