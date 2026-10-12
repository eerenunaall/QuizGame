import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@quizparty/db';
import { apiError } from '../http/routes';
import { hmacHex } from '../security/crypto';
import type { Clock } from '../util/clock';
import type { AccountSessionService } from './account-sessions';
import type { OtpService } from './otp';

export interface PrivacyDeps {
  db: Database;
  clock: Clock;
  secret: string;
  sessions: AccountSessionService;
  otp: OtpService | null;
  /** The account's purchase is gone: rooms it hosted fall back to FREE. */
  onEntitlementLost: (accountId: string) => void;
}

/**
 * The data-subject rights of ADR-0018: a person can take a copy of what we hold about their account
 * and can delete the account. Deleting removes the address and every sign-in, keeps the purchase
 * record the law asks us to keep with the account link cut and a keyed tombstone instead, and gives
 * the account a new store token so nothing bought before can ever be claimed against it again.
 */
export class AccountPrivacy {
  private readonly deps: PrivacyDeps;
  constructor(deps: PrivacyDeps) {
    this.deps = deps;
  }

  async exportData(accountId: string): Promise<Record<string, unknown> | null> {
    const { db } = this.deps;
    const account = await db
      .selectFrom('accounts')
      .select(['id', 'email', 'display_name', 'locale', 'status', 'created_at', 'last_login_at'])
      .where('id', '=', accountId)
      .where('status', '!=', 'DELETED')
      .executeTakeFirst();
    if (!account) return null;
    const [roles, sessions, purchases, entitlements] = await Promise.all([
      db
        .selectFrom('account_roles')
        .select(['role', 'granted_at'])
        .where('account_id', '=', accountId)
        .execute(),
      db
        .selectFrom('account_sessions')
        .select(['kind', 'created_at', 'last_seen_at', 'expires_at', 'revoked_at'])
        .where('account_id', '=', accountId)
        .orderBy('created_at', 'desc')
        .limit(200)
        .execute(),
      db
        .selectFrom('purchase_transactions')
        .select([
          'platform',
          'product_id',
          'external_transaction_id',
          'status',
          'environment',
          'created_at',
          'verified_at',
        ])
        .where('account_id', '=', accountId)
        .orderBy('created_at')
        .execute(),
      db
        .selectFrom('entitlements')
        .select(['product', 'platform', 'status', 'granted_at', 'revoked_at'])
        .where('account_id', '=', accountId)
        .orderBy('granted_at')
        .execute(),
    ]);
    const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
    return {
      exportedAt: new Date(this.deps.clock.now()).toISOString(),
      account: {
        id: account.id,
        email: account.email,
        displayName: account.display_name,
        locale: account.locale,
        createdAt: account.created_at.toISOString(),
        lastLoginAt: iso(account.last_login_at),
      },
      roles: roles.map((r) => ({ role: r.role, grantedAt: r.granted_at.toISOString() })),
      sessions: sessions.map((s) => ({
        kind: s.kind,
        createdAt: s.created_at.toISOString(),
        lastSeenAt: s.last_seen_at.toISOString(),
        expiresAt: s.expires_at.toISOString(),
        revokedAt: iso(s.revoked_at),
      })),
      purchases: purchases.map((p) => ({
        platform: p.platform,
        productId: p.product_id,
        transactionId: p.external_transaction_id,
        status: p.status,
        environment: p.environment,
        createdAt: p.created_at.toISOString(),
        verifiedAt: iso(p.verified_at),
      })),
      entitlements: entitlements.map((e) => ({
        product: e.product,
        platform: e.platform,
        status: e.status,
        grantedAt: e.granted_at.toISOString(),
        revokedAt: iso(e.revoked_at),
      })),
    };
  }

  /** 'OK', 'NOT_FOUND', or 'STAFF' (an account that holds roles is demoted by an administrator first). */
  async deleteAccount(accountId: string): Promise<'OK' | 'NOT_FOUND' | 'STAFF'> {
    const { db, clock, secret } = this.deps;
    const now = new Date(clock.now());
    const outcome = await db.transaction().execute(async (trx) => {
      const account = await trx
        .selectFrom('accounts')
        .select(['id', 'email', 'status'])
        .where('id', '=', accountId)
        .forUpdate()
        .executeTakeFirst();
      if (!account || account.status === 'DELETED') return { kind: 'NOT_FOUND' as const };
      const roles = await trx
        .selectFrom('account_roles')
        .select('role')
        .where('account_id', '=', accountId)
        .execute();
      if (roles.length > 0) return { kind: 'STAFF' as const };
      await trx
        .updateTable('purchase_transactions')
        .set({
          account_id: null,
          former_account_ref: hmacHex(secret, 'account-tombstone', accountId),
        })
        .where('account_id', '=', accountId)
        .execute();
      await trx.deleteFrom('entitlements').where('account_id', '=', accountId).execute();
      await trx
        .updateTable('rooms')
        .set({ host_account_id: null })
        .where('host_account_id', '=', accountId)
        .execute();
      await trx
        .updateTable('link_intents')
        .set({ claimed_by: null })
        .where('claimed_by', '=', accountId)
        .execute();
      await trx
        .updateTable('account_sessions')
        .set({ revoked_at: now })
        .where('account_id', '=', accountId)
        .where('revoked_at', 'is', null)
        .execute();
      await trx
        .updateTable('accounts')
        .set({
          email: null,
          email_verified_at: null,
          display_name: null,
          avatar_id: null,
          status: 'DELETED',
          deleted_at: now,
          // Nothing bought for the old token can bind to this row again.
          store_account_token: randomUUID(),
        })
        .where('id', '=', accountId)
        .execute();
      return { kind: 'OK' as const, email: account.email };
    });
    if (outcome.kind !== 'OK') return outcome.kind === 'STAFF' ? 'STAFF' : 'NOT_FOUND';
    if (outcome.email) await this.deps.otp?.forget(outcome.email);
    this.deps.onEntitlementLost(accountId);
    return 'OK';
  }
}

export function registerPrivacyRoutes(
  app: FastifyInstance,
  deps: { privacy: AccountPrivacy; sessions: AccountSessionService },
): void {
  app.get(
    '/v1/me/export',
    { config: { auth: 'session', limit: 'session' } },
    async (request, reply) => {
      const data = await deps.privacy.exportData(request.auth!.account.id);
      if (!data) return apiError(reply, 404, 'NOT_FOUND');
      void reply.header('content-disposition', 'attachment; filename="quizparty-account.json"');
      return data;
    },
  );

  app.delete(
    '/v1/me/sessions',
    { config: { auth: 'session', limit: 'session' } },
    async (request) => {
      await deps.sessions.revokeAll(request.auth!.account.id);
      return { ok: true };
    },
  );

  app.delete(
    '/v1/me',
    { config: { auth: 'session', limit: 'purchase' } },
    async (request, reply) => {
      const body = z.strictObject({ confirm: z.literal('DELETE') }).safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      const outcome = await deps.privacy.deleteAccount(request.auth!.account.id);
      if (outcome === 'STAFF') return apiError(reply, 409, 'FORBIDDEN');
      if (outcome === 'NOT_FOUND') return apiError(reply, 404, 'NOT_FOUND');
      return { ok: true };
    },
  );
}
