import type { Database } from '@quizparty/db';
import { randomToken } from '@quizparty/shared';
import { hmacHex } from '../security/crypto';
import type { Clock } from '../util/clock';
import type { Account, AccountService } from './accounts';

export type SessionKind = 'WEB' | 'MOBILE' | 'ADMIN';

/** Staff sessions are short on purpose (ADR-0012, ADR-0018): an hour idle, twelve hours at most. */
export const ADMIN_IDLE_MS = 60 * 60_000;
export const ADMIN_ABSOLUTE_MS = 12 * 3_600_000;
/** Ordinary sessions slide: thirty days from the last use. */
export const WEB_SLIDING_MS = 30 * 86_400_000;
/** `last_seen_at` is refreshed at most this often, so reads do not become writes. */
const TOUCH_EVERY_MS = 60_000;

export interface AuthContext {
  account: Account;
  sessionId: string;
  kind: SessionKind;
}

/**
 * Opaque bearer sessions for accounts (ADR-0012). The token is 256 random bits and only a keyed
 * hash of it is stored, so a database leak yields nothing that can be replayed.
 */
export class AccountSessionService {
  constructor(
    private readonly db: Database,
    private readonly accounts: AccountService,
    private readonly secret: string,
    private readonly clock: Clock,
  ) {}

  private hash(token: string): string {
    return hmacHex(this.secret, 'account-session', token);
  }

  async create(
    accountId: string,
    kind: SessionKind,
    context: { ipHash: string; userAgentHash: string | null },
  ): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
    const now = this.clock.now();
    const token = randomToken();
    const expiresAt = new Date(now + (kind === 'ADMIN' ? ADMIN_ABSOLUTE_MS : WEB_SLIDING_MS));
    const row = await this.db
      .insertInto('account_sessions')
      .values({
        account_id: accountId,
        token_hash: this.hash(token),
        kind,
        expires_at: expiresAt,
        last_seen_at: new Date(now),
        ip_hash: context.ipHash,
        user_agent_hash: context.userAgentHash,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { token, expiresAt, sessionId: row.id };
  }

  /** The session behind a presented token, or null for anything unknown, expired, idle or revoked. */
  async resolve(token: string): Promise<AuthContext | null> {
    if (token.length < 20 || token.length > 128) return null;
    const row = await this.db
      .selectFrom('account_sessions')
      .select(['id', 'account_id', 'kind', 'expires_at', 'last_seen_at', 'revoked_at'])
      .where('token_hash', '=', this.hash(token))
      .executeTakeFirst();
    if (!row || row.revoked_at) return null;
    const now = this.clock.now();
    if (row.expires_at.getTime() <= now) return null;
    const kind = row.kind as SessionKind;
    if (kind === 'ADMIN' && now - row.last_seen_at.getTime() > ADMIN_IDLE_MS) return null;
    const account = await this.accounts.get(row.account_id);
    if (!account || account.status !== 'ACTIVE') return null;
    if (now - row.last_seen_at.getTime() > TOUCH_EVERY_MS) {
      await this.db
        .updateTable('account_sessions')
        .set({
          last_seen_at: new Date(now),
          ...(kind === 'ADMIN' ? {} : { expires_at: new Date(now + WEB_SLIDING_MS) }),
        })
        .where('id', '=', row.id)
        .execute();
    }
    return { account, sessionId: row.id, kind };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db
      .updateTable('account_sessions')
      .set({ revoked_at: new Date(this.clock.now()) })
      .where('id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revokeAll(accountId: string): Promise<void> {
    await this.db
      .updateTable('account_sessions')
      .set({ revoked_at: new Date(this.clock.now()) })
      .where('account_id', '=', accountId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async purge(): Promise<number> {
    const cutoff = new Date(this.clock.now() - 7 * 86_400_000);
    const result = await this.db
      .deleteFrom('account_sessions')
      .where((eb) => eb.or([eb('expires_at', '<', cutoff), eb('revoked_at', '<', cutoff)]))
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}
