export type Platform = 'IOS' | 'ANDROID';
export type StoreEnvironment = 'PRODUCTION' | 'SANDBOX';

/** The one product we sell (GDD §6). Stores know it by their own ids; the catalogue maps them. */
export const FULL_GAME = 'QUIZPARTY_FULL_GAME';

export type PurchaseErrorCode = 'PURCHASE_INVALID' | 'PURCHASE_PENDING' | 'STORE_UNAVAILABLE';

/** A purchase that cannot be accepted (or not yet). The code is what the client is told; `reason` is for logs. */
export class PurchaseError extends Error {
  readonly code: PurchaseErrorCode;
  readonly reason: string;
  constructor(code: PurchaseErrorCode, reason: string) {
    super(`${code}: ${reason}`);
    this.name = 'PurchaseError';
    this.code = code;
    this.reason = reason;
  }
}

/** What a client sends: raw store data, never a claim about price, product name or account. */
export type PurchaseClaim =
  | { platform: 'IOS'; signedTransaction: string }
  | { platform: 'ANDROID'; productId: string; purchaseToken: string };

/** A purchase as the store itself describes it, after the store's own signature or API vouched for it. */
export interface VerifiedPurchase {
  platform: Platform;
  productId: string;
  externalTransactionId: string;
  /** Google only. Kept in memory for webhooks and acknowledgement; only a keyed hash is stored. */
  purchaseToken?: string;
  /** The store-side account id we gave the app at purchase time (Apple appAccountToken, Google obfuscated id). */
  accountToken: string | null;
  environment: StoreEnvironment;
  state: 'PURCHASED' | 'REVOKED';
  summary: Record<string, string | number | boolean | null>;
  /** Present while the store still expects an acknowledgement (Google refunds unacknowledged purchases). */
  acknowledge?: () => Promise<void>;
}

export interface PurchaseVerifier {
  readonly platform: Platform;
  verify(claim: PurchaseClaim): Promise<VerifiedPurchase>;
}
