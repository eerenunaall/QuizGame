import { createSign } from 'node:crypto';
import type { PaymentsConfig } from '../config';
import type { Clock } from '../util/clock';
import {
  PurchaseError,
  type PurchaseClaim,
  type PurchaseVerifier,
  type VerifiedPurchase,
} from './types';

type GoogleConfig = NonNullable<PaymentsConfig['google']>;

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const TIMEOUT_MS = 8_000;

const b64url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

/** The Google Play Developer API's one-time product purchase, the few fields we rely on. */
interface ProductPurchase {
  purchaseState?: number; // 0 purchased, 1 canceled (refunded), 2 pending
  acknowledgementState?: number; // 0 not yet, 1 acknowledged
  orderId?: string;
  productId?: string;
  purchaseType?: number; // 0 test purchase; absent for real ones
  obfuscatedExternalAccountId?: string;
}

/**
 * Google Play one-time purchases over the Developer API with a service account (RS256 JWT built with
 * node:crypto, access token cached). The client only ever sends a purchase token; the purchase's
 * state, product, order and owner all come from Google.
 */
export class GoogleVerifier implements PurchaseVerifier {
  readonly platform = 'ANDROID' as const;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly config: GoogleConfig;
  private readonly clock: Clock;
  private readonly fetcher: typeof fetch;

  constructor(config: GoogleConfig, clock: Clock, fetcher: typeof fetch = fetch) {
    this.config = config;
    this.clock = clock;
    this.fetcher = fetcher;
  }

  private async accessToken(): Promise<string> {
    const now = this.clock.now();
    if (this.token && this.token.expiresAt - 60_000 > now) return this.token.value;
    const issued = Math.floor(now / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
      JSON.stringify({
        iss: this.config.clientEmail,
        scope: SCOPE,
        aud: this.config.tokenUri,
        iat: issued,
        exp: issued + 3600,
      }),
    )}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.config.privateKey);
    const response = await this.call(this.config.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${b64url(signature)}`,
      }),
    });
    if (!response.ok)
      throw new PurchaseError('STORE_UNAVAILABLE', `google token ${response.status}`);
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new PurchaseError('STORE_UNAVAILABLE', 'google token missing');
    this.token = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new PurchaseError('STORE_UNAVAILABLE', 'google unreachable');
    }
  }

  private url(token: string, suffix = ''): string {
    const { apiBase, packageName, productId } = this.config;
    return `${apiBase}/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}${suffix}`;
  }

  private async authorised(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.call(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${await this.accessToken()}` },
    });
    // A rejected service-account token is ours to fix, not the buyer's: say "try later", grant nothing.
    if (response.status === 401 || response.status === 403) this.token = null;
    return response;
  }

  async verify(claim: PurchaseClaim): Promise<VerifiedPurchase> {
    if (claim.platform !== 'ANDROID') throw new PurchaseError('PURCHASE_INVALID', 'wrong platform');
    // Never query Google for a product we do not sell: the client does not choose what we look up.
    if (claim.productId !== this.config.productId)
      throw new PurchaseError('PURCHASE_INVALID', 'another product');
    const { purchaseToken } = claim;
    const response = await this.authorised(this.url(purchaseToken));
    if (response.status === 400 || response.status === 404 || response.status === 410)
      throw new PurchaseError('PURCHASE_INVALID', `google says ${response.status}`);
    if (!response.ok) throw new PurchaseError('STORE_UNAVAILABLE', `google ${response.status}`);
    const purchase = (await response.json()) as ProductPurchase;

    if (purchase.productId !== undefined && purchase.productId !== this.config.productId)
      throw new PurchaseError('PURCHASE_INVALID', 'another product');
    if (!purchase.orderId) throw new PurchaseError('PURCHASE_INVALID', 'no order id');
    if (purchase.purchaseState === 2)
      throw new PurchaseError('PURCHASE_PENDING', 'payment pending');
    if (purchase.purchaseState !== 0 && purchase.purchaseState !== 1)
      throw new PurchaseError('PURCHASE_INVALID', 'unknown purchase state');

    return {
      platform: 'ANDROID',
      productId: this.config.productId,
      externalTransactionId: purchase.orderId,
      purchaseToken,
      accountToken: purchase.obfuscatedExternalAccountId?.toLowerCase() ?? null,
      environment: purchase.purchaseType === 0 ? 'SANDBOX' : 'PRODUCTION',
      state: purchase.purchaseState === 0 ? 'PURCHASED' : 'REVOKED',
      summary: { purchaseType: purchase.purchaseType ?? null, state: purchase.purchaseState },
      ...(purchase.acknowledgementState === 0 && purchase.purchaseState === 0
        ? { acknowledge: () => this.acknowledge(purchaseToken) }
        : {}),
    };
  }

  private async acknowledge(purchaseToken: string): Promise<void> {
    const response = await this.authorised(this.url(purchaseToken, ':acknowledge'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!response.ok)
      throw new PurchaseError('STORE_UNAVAILABLE', `acknowledge ${response.status}`);
  }
}
