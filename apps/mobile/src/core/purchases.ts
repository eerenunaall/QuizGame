import { Store } from '@quizparty/controller-client';
import { ApiError, type ApiClient, type PurchaseClaim } from './api';

/** What the store shows for the product; the price text always comes from the store. */
export interface StoreProduct {
  id: string;
  displayPrice: string;
  title: string;
}

/** One store transaction the app holds: its server claim and a way to finish it with the store. */
export interface StorePurchase {
  claim: PurchaseClaim;
  /** Finishes / acknowledges the transaction. Called only after the server has confirmed it. */
  finish(): Promise<void>;
}

export class PurchaseCancelledError extends Error {
  constructor() {
    super('PURCHASE_CANCELLED');
  }
}
/** Ask to buy / family approval: the store charges later, so nothing is granted yet. */
export class PurchasePendingError extends Error {
  constructor() {
    super('PURCHASE_PENDING');
  }
}
export class StoreUnavailableError extends Error {
  constructor() {
    super('STORE_UNAVAILABLE');
  }
}

/**
 * The app's only view of StoreKit 2 / Google Play Billing (ADR-0013, ADR-0017). The production
 * implementation is a thin wrapper around `expo-iap` (`native/expoIapProvider.ts`); tests script it.
 * A provider never decides anything about entitlement: it returns store data for the server.
 */
export interface PurchaseProvider {
  readonly platform: 'IOS' | 'ANDROID';
  isAvailable(): Promise<boolean>;
  getProduct(productId: string): Promise<StoreProduct | null>;
  /**
   * Opens the store's purchase sheet. `accountToken` is the server-issued `storeAccountToken`, passed
   * as Apple's `appAccountToken` / Google's `obfuscatedAccountId` so the purchase is bound to the
   * signed-in account. Rejects with PurchaseCancelledError / PurchasePendingError / StoreUnavailableError.
   */
  purchase(productId: string, accountToken: string): Promise<StorePurchase>;
  /** Transactions the store still lists for this user (unfinished ones included); drives Restore and crash recovery. */
  restore(): Promise<StorePurchase[]>;
}

export type PurchaseStatus =
  'IDLE' | 'LOADING' | 'BUYING' | 'RESTORING' | 'OWNED' | 'PENDING' | 'FAILED';

export interface PurchaseState {
  status: PurchaseStatus;
  tier: 'FREE' | 'FULL';
  product: StoreProduct | null;
  /** Server / store error code for the last failure (mapped to copy by the UI). */
  errorCode: string | null;
  /** Result of the last Restore press. */
  restored: 'NONE' | 'RESTORED' | 'NOTHING' | null;
  storeAvailable: boolean;
}

export const INITIAL_PURCHASE_STATE: PurchaseState = {
  status: 'IDLE',
  tier: 'FREE',
  product: null,
  errorCode: null,
  restored: null,
  storeAvailable: true,
};

/**
 * Orchestrates ADR-0013 flows A–C on the device. Order of operations is what makes it safe:
 *  1. the server issues the account token, 2. the store sheet runs bound to it, 3. the claim is
 *  verified by the server, 4. only then is the store transaction finished. A crash between 2 and 4
 *  leaves an unfinished transaction that `recover()` posts again (idempotent on the server).
 * The app never grants anything locally: the tier shown is the one the server returned.
 */
export class PurchaseFlow {
  readonly store = new Store<PurchaseState>(INITIAL_PURCHASE_STATE);

  private readonly deps: {
    provider: PurchaseProvider;
    api: ApiClient;
    productId: string;
    /** Whether an account is signed in right now. */
    signedIn: () => boolean;
  };

  constructor(deps: PurchaseFlow['deps']) {
    this.deps = deps;
  }

  private patch(change: Partial<PurchaseState>): void {
    this.store.update((s) => ({ ...s, ...change }));
  }

  private fail(error: unknown): never {
    const code =
      error instanceof ApiError
        ? error.code
        : error instanceof PurchaseCancelledError
          ? 'PURCHASE_CANCELLED'
          : error instanceof PurchasePendingError
            ? 'PURCHASE_PENDING'
            : error instanceof StoreUnavailableError
              ? 'STORE_UNAVAILABLE'
              : 'INTERNAL';
    this.patch({ status: code === 'PURCHASE_PENDING' ? 'PENDING' : 'FAILED', errorCode: code });
    throw error;
  }

  /** Reads the store price and (when signed in) the account's tier. */
  async load(): Promise<void> {
    this.patch({ status: 'LOADING', errorCode: null });
    const storeAvailable = await this.deps.provider.isAvailable().catch(() => false);
    const product = storeAvailable
      ? await this.deps.provider.getProduct(this.deps.productId).catch(() => null)
      : null;
    let tier: 'FREE' | 'FULL' = 'FREE';
    if (this.deps.signedIn()) {
      try {
        tier = (await this.deps.api.entitlements()).tier;
      } catch {
        // offline: show what we can; the tier is re-read on the next load
      }
    }
    this.patch({
      status: tier === 'FULL' ? 'OWNED' : 'IDLE',
      tier,
      product,
      storeAvailable,
    });
  }

  /** Flow A/B: buy now. Resolves with the tier the server reports. */
  async buy(): Promise<'FULL'> {
    if (!this.deps.signedIn()) throw new ApiError('UNAUTHORIZED', 401);
    this.patch({ status: 'BUYING', errorCode: null, restored: null });
    try {
      const { storeAccountToken, tier } = await this.deps.api.entitlements();
      if (tier === 'FULL') {
        this.patch({ status: 'OWNED', tier });
        return 'FULL';
      }
      const purchase = await this.deps.provider.purchase(this.deps.productId, storeAccountToken);
      const verified = await this.deps.api.verifyPurchase(purchase.claim);
      await purchase.finish();
      this.patch({ status: 'OWNED', tier: verified.tier });
      return 'FULL';
    } catch (error) {
      return this.fail(error);
    }
  }

  /** The Restore button and the crash-recovery path share this: post what the store lists, finish what the server accepted. */
  async restore(): Promise<'RESTORED' | 'NOTHING'> {
    if (!this.deps.signedIn()) throw new ApiError('UNAUTHORIZED', 401);
    this.patch({ status: 'RESTORING', errorCode: null, restored: null });
    try {
      const held = (await this.deps.provider.restore()).slice(0, 10);
      if (held.length === 0) {
        this.patch({
          status: this.store.get().tier === 'FULL' ? 'OWNED' : 'IDLE',
          restored: 'NOTHING',
        });
        return 'NOTHING';
      }
      const outcome = await this.deps.api.restorePurchases(held.map((p) => p.claim));
      for (const [index, purchase] of held.entries()) {
        // Finish only what the server accepted; a refused one stays for the next attempt.
        if (outcome.results[index]?.ok) await purchase.finish().catch(() => undefined);
      }
      const restored = outcome.results.some((r) => r.ok);
      this.patch({
        status: outcome.tier === 'FULL' ? 'OWNED' : 'IDLE',
        tier: outcome.tier,
        restored: restored ? 'RESTORED' : 'NOTHING',
        errorCode: restored ? null : (outcome.results.find((r) => !r.ok)?.code ?? null),
      });
      return restored ? 'RESTORED' : 'NOTHING';
    } catch (error) {
      return this.fail(error);
    }
  }

  /** Flow C: on launch (signed in), settle transactions a crash left unfinished. Never throws. */
  async recover(): Promise<void> {
    if (!this.deps.signedIn()) return;
    try {
      await this.restore();
    } catch {
      // surfaced on the next explicit action; recovery is silent
    }
  }
}
