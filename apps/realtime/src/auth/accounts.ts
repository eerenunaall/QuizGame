import { sql } from 'kysely';
import type { Database } from '@quizparty/db';
import type { Locale } from '@quizparty/protocol';
import type { Clock } from '../util/clock';

export const ROLES = ['ADMIN', 'EDITOR', 'MODERATOR', 'SUPPORT'] as const;
export type Role = (typeof ROLES)[number];

export interface Account {
  id: string;
  email: string | null;
  displayName: string | null;
  locale: Locale;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  roles: Role[];
  createdAt: Date;
  lastLoginAt: Date | null;
}

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

/** Accounts and their roles (ADR-0012). Roles are read on every request, so a change bites at once. */
export class AccountService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly bootstrapAdmins: readonly string[],
  ) {}

  private async rolesOf(accountId: string): Promise<Role[]> {
    const rows = await this.db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', accountId)
      .execute();
    return rows.map((row) => row.role).filter(isRole);
  }

  async get(accountId: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom('accounts')
      .select(['id', 'email', 'display_name', 'locale', 'status', 'created_at', 'last_login_at'])
      .where('id', '=', accountId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      locale: row.locale as Locale,
      status: row.status as Account['status'],
      roles: await this.rolesOf(row.id),
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
    };
  }

  /**
   * First sign-in creates the account. Addresses listed in ADMIN_BOOTSTRAP_EMAILS become ADMIN
   * (how the very first administrator exists); nobody else gets a role by signing in.
   * Returns null when the account is suspended or deleted: the caller answers as for a wrong code.
   */
  async signIn(email: string, locale: Locale): Promise<Account | null> {
    const now = new Date(this.clock.now());
    const row = await this.db
      .insertInto('accounts')
      .values({ email, email_verified_at: now, locale, last_login_at: now })
      .onConflict((conflict) =>
        conflict.column('email').doUpdateSet({
          email_verified_at: sql`COALESCE(accounts.email_verified_at, ${now})`,
          last_login_at: now,
        }),
      )
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow();
    if (row.status !== 'ACTIVE') return null;
    if (this.bootstrapAdmins.includes(email))
      await this.db
        .insertInto('account_roles')
        .values({ account_id: row.id, role: 'ADMIN' })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    return this.get(row.id);
  }

  async list(options: { search?: string; role?: Role; limit: number; offset: number }): Promise<{
    total: number;
    accounts: Account[];
  }> {
    let query = this.db.selectFrom('accounts').select('id');
    if (options.search)
      query = query.where('email', 'ilike', `%${options.search.replace(/[%_\\]/gu, '\\$&')}%`);
    if (options.role) {
      const role = options.role;
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('account_roles')
            .select('account_roles.account_id')
            .whereRef('account_roles.account_id', '=', 'accounts.id')
            .where('account_roles.role', '=', role),
        ),
      );
    }
    const total = await query
      .clearSelect()
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    const ids = await query
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .limit(options.limit)
      .offset(options.offset)
      .execute();
    const accounts: Account[] = [];
    for (const { id } of ids) {
      const account = await this.get(id);
      if (account) accounts.push(account);
    }
    return { total: Number(total.n), accounts };
  }

  /**
   * Replaces the roles of an account. Refuses to leave the system without an administrator.
   * Returns false when the account does not exist.
   */
  async setRoles(
    accountId: string,
    roles: readonly Role[],
    grantedBy: string,
  ): Promise<'OK' | 'NOT_FOUND' | 'LAST_ADMIN'> {
    return this.db.transaction().execute(async (trx) => {
      const exists = await trx
        .selectFrom('accounts')
        .select('id')
        .where('id', '=', accountId)
        .forUpdate()
        .executeTakeFirst();
      if (!exists) return 'NOT_FOUND' as const;
      if (!roles.includes('ADMIN')) {
        // Serialise administrators leaving, or two of them could remove each other at once.
        await sql`SELECT pg_advisory_xact_lock(7340222)`.execute(trx);
        const others = await trx
          .selectFrom('account_roles')
          .innerJoin('accounts', 'accounts.id', 'account_roles.account_id')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('account_roles.role', '=', 'ADMIN')
          .where('accounts.status', '=', 'ACTIVE')
          .where('account_roles.account_id', '!=', accountId)
          .executeTakeFirstOrThrow();
        const wasAdmin = await trx
          .selectFrom('account_roles')
          .select('role')
          .where('account_id', '=', accountId)
          .where('role', '=', 'ADMIN')
          .executeTakeFirst();
        if (wasAdmin && Number(others.n) === 0) return 'LAST_ADMIN' as const;
      }
      await trx.deleteFrom('account_roles').where('account_id', '=', accountId).execute();
      if (roles.length > 0)
        await trx
          .insertInto('account_roles')
          .values(roles.map((role) => ({ account_id: accountId, role, granted_by: grantedBy })))
          .execute();
      return 'OK' as const;
    });
  }

  async setStatus(
    accountId: string,
    status: 'ACTIVE' | 'SUSPENDED',
  ): Promise<'OK' | 'NOT_FOUND' | 'LAST_ADMIN'> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('accounts')
        .select(['id', 'status'])
        .where('id', '=', accountId)
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.status === 'DELETED') return 'NOT_FOUND' as const;
      if (status === 'SUSPENDED') {
        await sql`SELECT pg_advisory_xact_lock(7340222)`.execute(trx);
        const isAdmin = await trx
          .selectFrom('account_roles')
          .select('role')
          .where('account_id', '=', accountId)
          .where('role', '=', 'ADMIN')
          .executeTakeFirst();
        if (isAdmin) {
          const others = await trx
            .selectFrom('account_roles')
            .innerJoin('accounts', 'accounts.id', 'account_roles.account_id')
            .select((eb) => eb.fn.countAll<number>().as('n'))
            .where('account_roles.role', '=', 'ADMIN')
            .where('accounts.status', '=', 'ACTIVE')
            .where('account_roles.account_id', '!=', accountId)
            .executeTakeFirstOrThrow();
          if (Number(others.n) === 0) return 'LAST_ADMIN' as const;
        }
      }
      await trx.updateTable('accounts').set({ status }).where('id', '=', accountId).execute();
      if (status === 'SUSPENDED')
        await trx
          .updateTable('account_sessions')
          .set({ revoked_at: new Date(this.clock.now()) })
          .where('account_id', '=', accountId)
          .where('revoked_at', 'is', null)
          .execute();
      return 'OK' as const;
    });
  }
}
