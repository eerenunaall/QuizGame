import * as IAP from 'expo-iap';
import { Platform } from 'react-native';
import {
  PurchaseCancelledError,
  PurchasePendingError,
  StoreUnavailableError,
  type PurchaseProvider,
  type StorePurchase,
  type StoreProduct,
} from '../core/purchases';
import { purchaseToClaim } from '../core/storeClaims';

/**
 * The thin production binding of `PurchaseProvider` to `expo-iap` (StoreKit 2 / Play Billing).
 * It holds no secrets and makes no entitlement decision: it returns the store's signed transaction
 * (iOS JWS) or purchase token (Android) for the server to verify. NOT exercised in the sandbox:
 * needs a development build on a device with a store sandbox account (docs/MOBILE.md).
 */
export function createExpoIapProvider(): PurchaseProvider {
  const platform = Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
  let connected: Promise<boolean> | null = null;
  const connect = (): Promise<boolean> => {
    connected ??= IAP.initConnection().catch(() => false);
    return connected;
  };

  const wrap = (purchase: IAP.Purchase): StorePurchase => {
    const claim = purchaseToClaim(purchase, platform);
    if (!claim) throw new StoreUnavailableError();
    return {
      claim,
      // Non-consumable: finishing acknowledges it (Play) / ends the transaction (StoreKit).
      finish: () => IAP.finishTransaction({ purchase, isConsumable: false }).then(() => undefined),
    };
  };

  const restore = async (productId?: string): Promise<StorePurchase[]> => {
    if (!(await connect())) throw new StoreUnavailableError();
    try {
      await IAP.restorePurchases();
    } catch {
      // the list below is still what the store holds locally
    }
    const owned = await IAP.getAvailablePurchases();
    return owned
      .filter((purchase) => purchase.purchaseState !== 'pending')
      .filter((purchase) => productId === undefined || purchase.productId === productId)
      .map(wrap);
  };

  return {
    platform,
    isAvailable: connect,
    async getProduct(productId): Promise<StoreProduct | null> {
      if (!(await connect())) return null;
      const products = await IAP.fetchProducts({ skus: [productId], type: 'in-app' });
      const found = (products ?? []).find((product) => product.id === productId);
      return found ? { id: found.id, displayPrice: found.displayPrice, title: found.title } : null;
    },
    async purchase(productId, accountToken): Promise<StorePurchase> {
      if (!(await connect())) throw new StoreUnavailableError();
      return new Promise<StorePurchase>((resolve, reject) => {
        const subscriptions: { remove(): void }[] = [];
        const done = (settle: () => void): void => {
          for (const subscription of subscriptions) subscription.remove();
          settle();
        };
        subscriptions.push(
          IAP.purchaseUpdatedListener((purchase) => {
            if (purchase.productId !== productId) return;
            if (purchase.purchaseState === 'pending')
              return done(() => reject(new PurchasePendingError()));
            done(() => {
              try {
                resolve(wrap(purchase));
              } catch (error) {
                reject(error instanceof Error ? error : new StoreUnavailableError());
              }
            });
          }),
          IAP.purchaseErrorListener((error) => {
            if (error.code === IAP.ErrorCode.UserCancelled)
              return done(() => reject(new PurchaseCancelledError()));
            if (
              error.code === IAP.ErrorCode.DeferredPayment ||
              error.code === IAP.ErrorCode.Pending
            )
              return done(() => reject(new PurchasePendingError()));
            if (error.code === IAP.ErrorCode.AlreadyOwned) {
              // Bought before (maybe on another device): hand the store's record to the server.
              return void restore(productId).then(
                (found) =>
                  done(() => {
                    const first = found[0];
                    if (first) resolve(first);
                    else reject(new StoreUnavailableError());
                  }),
                () => done(() => reject(new StoreUnavailableError())),
              );
            }
            return done(() => reject(new StoreUnavailableError()));
          }),
        );
        IAP.requestPurchase({
          type: 'in-app',
          request: {
            apple: { sku: productId, appAccountToken: accountToken },
            google: { skus: [productId], obfuscatedAccountId: accountToken },
          },
        }).catch(() => done(() => reject(new StoreUnavailableError())));
      });
    },
    restore: () => restore(),
  };
}
