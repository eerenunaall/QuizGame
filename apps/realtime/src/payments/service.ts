import type { Database } from '@quizparty/db';
import type { ErrorCode } from '@quizparty/protocol';
import type { Clock } from '../util/clock';
import { hmacHex } from '../security/crypto';
import {
  FULL_GAME,
  PurchaseError,
  type Platform,
  type PurchaseClaim,
  type PurchaseVerifier,
  type VerifiedPurchase,
} from './types';

export type Tier = 'FREE' | 'FULL';
export type ChangeReason = 'GRANTED' | 'RESTORED' | 'REVOKED';

/** A purchase request that ends in a refusal the client is told about (never prose, always a code). */
export class EntitlementError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'EntitlementError';
    this.code = code;
  }
}

export interface EntitlementServiceDeps {
  db: Database;
  clock: Clock;
  secret: string;
  verifiers: Partial<Record<Platform, PurchaseVerifier>>;
  acceptSandbox: boolean;
  /** An account's tier changed: tell the rooms it hosts (and anyone else who cares). */
  onChanged: (accountId: string, tier: Tier, reason: ChangeReason) => void;
  onSecurity: (kind: string, detail: Record<string, string>) => void;
  onError: (error: unknown) => void;
}

export interface EntitlementView {
  tier: Tier;
  entitlements: { product: string; platform: Platform | null; grantedAt: string }[];
}

/**
 * Turns verified store purchases into account entitlements (ADR-0013). Everything that matters is
 * decided here, on data the store vouched for: the buyer is whoever the store says the purchase was
 * made for, a transaction can only ever belong to one account, and granting twice changes nothing.
 */
export class EntitlementService {
  private readonly deps: EntitlementServiceDeps;

  constructor(deps: EntitlementServiceDeps) {
    this.deps = deps;
  }

  platforms(): Platform[] {
    return Object.keys(this.deps.verifiers) as Platform[];
  }

  tokenHash(purchaseToken: string): string {
    return hmacHex(this.deps.secret, 'purchase-token', purchaseToken);
  }

  /** Webhooks only ever make us call a store about a purchase we ourselves recorded. */
  async knowsToken(purchaseToken: string): Promise<boolean> {
    const row = await this.deps.db
      .selectFrom('purchase_transactions')
      .select('id')
      .where('purchase_token_hash', '=', this.tokenHash(purchaseToken))
      .executeTakeFirst();
    return row !== undefined;
  }

  async storeAccountToken(accountId: string): Promise<string | null> {
    const row = await this.deps.db
      .selectFrom('accounts')
      .select('store_account_token')
      .where('id', '=', accountId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    return row?.store_account_token ?? null;
  }

  async tierOf(accountId: string): Promise<Tier> {
    const row = await this.deps.db
      .selectFrom('entitlements')
      .select('id')
      .where('account_id', '=', accountId)
      .where('product', '=', FULL_GAME)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    return row ? 'FULL' : 'FREE';
  }

  async view(accountId: string): Promise<EntitlementView> {
    const rows = await this.deps.db
      .selectFrom('entitlements')
      .select(['product', 'platform', 'granted_at'])
      .where('account_id', '=', accountId)
      .where('status', '=', 'ACTIVE')
      .orderBy('granted_at')
      .execute();
    return {
      tier: rows.some((row) => row.product === FULL_GAME) ? 'FULL' : 'FREE',
      entitlements: rows.map((row) => ({
        product: row.product,
        platform: row.platform as Platform | null,
        grantedAt: row.granted_at.toISOString(),
      })),
    };
  }

  /** Verifies what the client sent and, if it is a live purchase made for this account, grants. */
  async redeem(
    account: { id: string },
    claim: PurchaseClaim,
    mode: 'GRANTED' | 'RESTORED',
  ): Promise<{ tier: Tier; granted: boolean }> {
    const verifier = this.deps.verifiers[claim.platform];
    if (!verifier) throw new EntitlementError('FEATURE_DISABLED');
    const storeToken = await this.storeAccountToken(account.id);
    if (!storeToken) throw new EntitlementError('UNAUTHORIZED');

    let verified: VerifiedPurchase;
    try {
      verified = await verifier.verify(claim);
    } catch (error) {
      if (error instanceof PurchaseError) {
        if (error.code === 'PURCHASE_INVALID')
          this.deps.onSecurity('PURCHASE_REFUSED', { platform: claim.platform, why: error.reason });
        throw new EntitlementError(error.code, error.reason);
      }
      throw error;
    }
    if (verified.environment === 'SANDBOX' && !this.deps.acceptSandbox)
      throw new EntitlementError('PURCHASE_INVALID', 'sandbox purchases are not accepted');
    // The store recorded who this purchase was made for when the app started it; a receipt lifted
    // from someone else's phone carries their token, not ours.
    if (verified.accountToken !== storeToken) {
      this.deps.onSecurity('PURCHASE_ACCOUNT_MISMATCH', { platform: claim.platform });
      throw new EntitlementError('PURCHASE_ACCOUNT_MISMATCH');
    }

    const outcome = await this.record(account.id, verified);
    if (outcome.kind === 'BOUND_ELSEWHERE') {
      this.deps.onSecurity('PURCHASE_REPLAY', { platform: claim.platform });
      throw new EntitlementError('TRANSACTION_ALREADY_BOUND');
    }
    if (outcome.kind === 'REFUNDED') {
      if (outcome.revoked) this.deps.onChanged(account.id, 'FREE', 'REVOKED');
      throw new EntitlementError('PURCHASE_REFUNDED');
    }
    // Only now that the grant is committed may the store be told we have delivered the product.
    if (verified.acknowledge)
      await verified.acknowledge().catch((error: unknown) => this.deps.onError(error));
    if (outcome.granted) this.deps.onChanged(account.id, 'FULL', mode);
    return { tier: 'FULL', granted: outcome.granted };
  }

  private async record(
    accountId: string,
    purchase: VerifiedPurchase,
  ): Promise<
    | { kind: 'OK'; granted: boolean }
    | { kind: 'BOUND_ELSEWHERE' }
    | { kind: 'REFUNDED'; revoked: boolean }
  > {
    const now = new Date(this.deps.clock.now());
    const tokenHash = purchase.purchaseToken ? this.tokenHash(purchase.purchaseToken) : null;
    return this.deps.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('purchase_transactions')
        .values({
          platform: purchase.platform,
          product_id: purchase.productId,
          external_transaction_id: purchase.externalTransactionId,
          purchase_token_hash: tokenHash,
          account_id: accountId,
          status: purchase.state === 'PURCHASED' ? 'VERIFIED' : 'REFUNDED',
          environment: purchase.environment,
          verified_at: now,
          raw_summary: JSON.stringify(purchase.summary),
        })
        .onConflict((conflict) =>
          conflict.columns(['platform', 'external_transaction_id']).doNothing(),
        )
        .returning(['id', 'status'])
        .executeTakeFirst();
      let row: { id: string; status: string };
      if (inserted) row = inserted;
      else {
        const existing = await trx
          .selectFrom('purchase_transactions')
          .select(['id', 'status', 'account_id'])
          .where('platform', '=', purchase.platform)
          .where('external_transaction_id', '=', purchase.externalTransactionId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (existing.account_id !== accountId) return { kind: 'BOUND_ELSEWHERE' as const };
        row = existing;
      }

      if (purchase.state === 'REVOKED' || row.status === 'REFUNDED') {
        const revoked = await this.revokeIn(trx, row.id, now);
        if (row.status !== 'REFUNDED')
          await trx
            .updateTable('purchase_transactions')
            .set({ status: 'REFUNDED' })
            .where('id', '=', row.id)
            .execute();
        return { kind: 'REFUNDED' as const, revoked };
      }

      const existing = await trx
        .selectFrom('entitlements')
        .select('status')
        .where('source_transaction_id', '=', row.id)
        .execute();
      // A revoked entitlement stays revoked: a restore must not undo a refund or a moderator.
      if (
        existing.some((e) => e.status === 'REVOKED') &&
        !existing.some((e) => e.status === 'ACTIVE')
      )
        return { kind: 'REFUNDED' as const, revoked: false };
      if (existing.length > 0) return { kind: 'OK' as const, granted: false };

      const grant = await trx
        .insertInto('entitlements')
        .values({
          account_id: accountId,
          product: FULL_GAME,
          platform: purchase.platform,
          source_transaction_id: row.id,
          granted_at: now,
          metadata: JSON.stringify({ environment: purchase.environment }),
        })
        .onConflict((conflict) =>
          conflict.columns(['account_id', 'product']).where('status', '=', 'ACTIVE').doNothing(),
        )
        .returning('id')
        .executeTakeFirst();
      // Already entitled through another purchase: nothing new, but the account is entitled.
      return { kind: 'OK' as const, granted: grant !== undefined };
    });
  }

  private async revokeIn(
    trx: Pick<Database, 'updateTable'>,
    transactionId: string,
    now: Date,
  ): Promise<boolean> {
    const revoked = await trx
      .updateTable('entitlements')
      .set({ status: 'REVOKED', revoked_at: now })
      .where('source_transaction_id', '=', transactionId)
      .where('status', '=', 'ACTIVE')
      .returning('id')
      .execute();
    return revoked.length > 0;
  }

  /**
   * The store says a purchase was refunded or revoked (server notification). Idempotent; only a
   * transaction we know is touched. Returns whether an entitlement was actually taken away.
   */
  async revoke(
    platform: Platform,
    lookup: { externalTransactionId: string } | { purchaseTokenHash: string },
    notificationId: string,
  ): Promise<boolean> {
    const now = new Date(this.deps.clock.now());
    const result = await this.deps.db.transaction().execute(async (trx) => {
      const fresh = await trx
        .insertInto('store_notifications')
        .values({ platform, notification_id: notificationId })
        .onConflict((conflict) => conflict.doNothing())
        .returning('notification_id')
        .executeTakeFirst();
      if (!fresh) return null; // delivered before: already handled
      let query = trx
        .selectFrom('purchase_transactions')
        .select(['id', 'account_id'])
        .where('platform', '=', platform)
        .forUpdate();
      query =
        'externalTransactionId' in lookup
          ? query.where('external_transaction_id', '=', lookup.externalTransactionId)
          : query.where('purchase_token_hash', '=', lookup.purchaseTokenHash);
      const row = await query.executeTakeFirst();
      if (!row) return null;
      await trx
        .updateTable('purchase_transactions')
        .set({ status: 'REFUNDED' })
        .where('id', '=', row.id)
        .where('status', '!=', 'REFUNDED')
        .execute();
      const revoked = await this.revokeIn(trx, row.id, now);
      return revoked ? row.account_id : null;
    });
    if (result) this.deps.onChanged(result, 'FREE', 'REVOKED');
    return result !== null;
  }
}
