import type { PurchaseClaim } from './api';

/** The fields of an `expo-iap` purchase the server needs (kept structural so tests need no native module). */
export interface StoreTransactionLike {
  productId: string;
  /** iOS: the signed transaction (JWS). Android: the purchase token. */
  purchaseToken?: string | null;
  store?: string | null;
  platform?: string;
}

/**
 * Maps a store transaction to the only two claim shapes the server accepts. Price, name and owner
 * are deliberately absent: the server ignores them (ADR-0013).
 */
export function purchaseToClaim(
  purchase: StoreTransactionLike,
  platform: 'IOS' | 'ANDROID' = purchase.platform === 'ios' || purchase.store === 'apple'
    ? 'IOS'
    : 'ANDROID',
): PurchaseClaim | null {
  const token = purchase.purchaseToken;
  if (!token) return null;
  return platform === 'IOS'
    ? { platform: 'IOS', signedTransaction: token }
    : { platform: 'ANDROID', productId: purchase.productId, purchaseToken: token };
}
