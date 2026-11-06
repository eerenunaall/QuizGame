import type { FetchLike } from '@quizparty/controller-client';
import type { ErrorCode, Locale } from '@quizparty/protocol';

/** A failed API call: the server's error code (never its prose) or NETWORK when unreachable. */
export class ApiError extends Error {
  readonly code: ErrorCode | 'NOT_FOUND' | 'NETWORK';
  readonly status: number;
  readonly params: Record<string, string | number> | undefined;

  constructor(
    code: ErrorCode | 'NOT_FOUND' | 'NETWORK',
    status: number,
    params?: Record<string, string | number>,
  ) {
    super(code);
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

export interface AccountView {
  id: string;
  email: string | null;
  displayName: string | null;
  locale: string;
  roles: string[];
  sessionKind: string;
}

export interface EntitlementsView {
  tier: 'FREE' | 'FULL';
  entitlements: { product: string; platform: string | null; grantedAt: string }[];
  /** Handed to the store at purchase time so the purchase is bound to this account (ADR-0013). */
  storeAccountToken: string;
  platforms: string[];
}

export type PurchaseClaim =
  | { platform: 'IOS'; signedTransaction: string }
  | { platform: 'ANDROID'; productId: string; purchaseToken: string };

export interface RestoreResult {
  results: { ok: boolean; code?: string }[];
  tier: 'FREE' | 'FULL';
}

export interface ApiOptions {
  baseUrl: string;
  fetch: FetchLike;
  /** The bearer token of the signed-in account, if any. */
  token: () => string | null;
  /** Called when the server says the token is no longer valid, so the app can sign out. */
  onUnauthorized?: () => void;
}

/**
 * The few authenticated HTTP calls the app makes (ADR-0012/0013). The mobile session kind is
 * requested at sign-in; a bearer token has no ambient authority, so no CSRF header is needed.
 */
export class ApiClient {
  private readonly options: ApiOptions;

  constructor(options: ApiOptions) {
    this.options = options;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = this.options.token();
    let response;
    try {
      response = await this.options.fetch(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError('NETWORK', 0);
    }
    const parsed = (await response.json().catch(() => ({}))) as {
      error?: { code?: ErrorCode | 'NOT_FOUND'; params?: Record<string, string | number> };
    };
    if (!response.ok) {
      if (response.status === 401 && token) this.options.onUnauthorized?.();
      throw new ApiError(parsed.error?.code ?? 'INTERNAL', response.status, parsed.error?.params);
    }
    return parsed as T;
  }

  /** Always answers the same, whatever the address (no account enumeration). */
  async requestEmailCode(email: string, locale: Locale): Promise<void> {
    await this.call('POST', '/v1/auth/email/request', { email, locale });
  }

  async verifyEmailCode(
    email: string,
    code: string,
  ): Promise<{ account: AccountView; token: string }> {
    const result = await this.call<{ account: AccountView; token?: string }>(
      'POST',
      '/v1/auth/email/verify',
      { email, code, client: 'MOBILE' },
    );
    if (!result.token) throw new ApiError('INTERNAL', 200);
    return { account: result.account, token: result.token };
  }

  async me(): Promise<AccountView> {
    return (await this.call<{ account: AccountView }>('GET', '/v1/me')).account;
  }

  async logout(): Promise<void> {
    await this.call('POST', '/v1/auth/logout', {});
  }

  entitlements(): Promise<EntitlementsView> {
    return this.call('GET', '/v1/entitlements');
  }

  /** The server verifies with Apple / Google; nothing the app says about price or owner is trusted. */
  verifyPurchase(claim: PurchaseClaim): Promise<{ tier: 'FREE' | 'FULL'; granted: boolean }> {
    return this.call('POST', '/v1/purchases/verify', claim);
  }

  restorePurchases(purchases: PurchaseClaim[]): Promise<RestoreResult> {
    return this.call('POST', '/v1/purchases/restore', { purchases });
  }

  /** Attaches this account's full game to the TV room behind a link (ADR-0013 flow A). */
  claimLink(intentId: string): Promise<{ tier: 'FREE' | 'FULL'; roomCode: string }> {
    return this.call('POST', `/v1/link-intents/${encodeURIComponent(intentId)}/claim`, {});
  }

  peekLink(intentId: string): Promise<{ roomCode: string; tier: 'FREE' | 'FULL' }> {
    return this.call('GET', `/v1/link-intents/${encodeURIComponent(intentId)}`);
  }

  exportData(): Promise<Record<string, unknown>> {
    return this.call('GET', '/v1/me/export');
  }

  async deleteAccount(): Promise<void> {
    await this.call('DELETE', '/v1/me', { confirm: 'DELETE' });
  }
}
