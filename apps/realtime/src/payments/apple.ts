import {
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import type { PaymentsConfig } from '../config';
import {
  PurchaseError,
  type PurchaseClaim,
  type PurchaseVerifier,
  type StoreEnvironment,
  type VerifiedPurchase,
} from './types';

type AppleConfig = NonNullable<PaymentsConfig['apple']>;

interface Checker {
  environment: StoreEnvironment;
  verifier: SignedDataVerifier;
}

/** The store says "not mine" for the other environment; anything else is a real failure. */
const wrongEnvironment = (error: unknown): boolean =>
  error instanceof VerificationException && error.status === VerificationStatus.INVALID_ENVIRONMENT;

function asPurchaseError(error: unknown): PurchaseError {
  if (error instanceof PurchaseError) return error;
  if (
    error instanceof VerificationException &&
    error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
  )
    return new PurchaseError('STORE_UNAVAILABLE', 'certificate status could not be checked');
  const status =
    error instanceof VerificationException ? VerificationStatus[error.status] : 'error';
  return new PurchaseError('PURCHASE_INVALID', `apple verification: ${status}`);
}

/**
 * StoreKit 2 signed transactions, checked with Apple's own library: certificate chain to the roots
 * we were given (never fetched at run time), signature, bundle id, environment. Only the two real
 * App Store environments are ever configured; the library's "Xcode" and "local testing"
 * environments skip signature checks and must never be reachable here.
 */
export class AppleVerifier implements PurchaseVerifier {
  readonly platform = 'IOS' as const;
  private readonly checkers: Checker[] = [];
  private readonly config: AppleConfig;

  constructor(config: AppleConfig, acceptSandbox: boolean) {
    this.config = config;
    const make = (environment: Environment): SignedDataVerifier =>
      new SignedDataVerifier(
        config.rootCertificates,
        config.onlineChecks,
        environment,
        config.bundleId,
        config.appAppleId ?? undefined,
      );
    // Production needs the app's numeric id; without it only sandbox purchases can be accepted.
    if (config.appAppleId !== null)
      this.checkers.push({ environment: 'PRODUCTION', verifier: make(Environment.PRODUCTION) });
    if (acceptSandbox)
      this.checkers.push({ environment: 'SANDBOX', verifier: make(Environment.SANDBOX) });
  }

  private async decode(
    signed: string,
  ): Promise<{ environment: StoreEnvironment; transaction: JWSTransactionDecodedPayload }> {
    let last: unknown = new PurchaseError('PURCHASE_INVALID', 'no store environment is enabled');
    for (const { environment, verifier } of this.checkers) {
      try {
        return { environment, transaction: await verifier.verifyAndDecodeTransaction(signed) };
      } catch (error) {
        last = error;
        if (!wrongEnvironment(error)) break;
      }
    }
    throw asPurchaseError(last);
  }

  async verify(claim: PurchaseClaim): Promise<VerifiedPurchase> {
    if (claim.platform !== 'IOS') throw new PurchaseError('PURCHASE_INVALID', 'wrong platform');
    const { environment, transaction } = await this.decode(claim.signedTransaction);
    return this.toPurchase(environment, transaction);
  }

  private toPurchase(
    environment: StoreEnvironment,
    transaction: JWSTransactionDecodedPayload,
  ): VerifiedPurchase {
    if (transaction.productId !== this.config.productId)
      throw new PurchaseError('PURCHASE_INVALID', 'another product');
    // Only a one-time unlock is for sale; a subscription or consumable id is never our product.
    if (transaction.type !== 'Non-Consumable')
      throw new PurchaseError('PURCHASE_INVALID', 'not a non-consumable');
    const id = transaction.originalTransactionId ?? transaction.transactionId;
    if (!id) throw new PurchaseError('PURCHASE_INVALID', 'no transaction id');
    return {
      platform: 'IOS',
      productId: transaction.productId,
      externalTransactionId: id,
      accountToken: transaction.appAccountToken?.toLowerCase() ?? null,
      environment,
      state: transaction.revocationDate === undefined ? 'PURCHASED' : 'REVOKED',
      summary: {
        environment,
        purchaseDate: transaction.purchaseDate ?? null,
        revocationReason: transaction.revocationReason ?? null,
      },
    };
  }

  /** A signed App Store Server Notification (V2): the signature and bundle are checked like any other. */
  async verifyNotification(
    signedPayload: string,
  ): Promise<{ notification: ResponseBodyV2DecodedPayload; purchase: VerifiedPurchase | null }> {
    let last: unknown = new PurchaseError('PURCHASE_INVALID', 'no store environment is enabled');
    for (const { environment, verifier } of this.checkers) {
      try {
        const notification = await verifier.verifyAndDecodeNotification(signedPayload);
        const signed = notification.data?.signedTransactionInfo;
        const purchase = signed
          ? this.toPurchase(environment, await verifier.verifyAndDecodeTransaction(signed))
          : null;
        return { notification, purchase };
      } catch (error) {
        last = error;
        if (!wrongEnvironment(error)) break;
      }
    }
    throw asPurchaseError(last);
  }
}
