import type { FetchLike, KeyValueStorage } from '@quizparty/controller-client';
import { ApiClient, type PurchaseClaim } from '../core/api';
import {
  PurchaseCancelledError,
  PurchasePendingError,
  type PurchaseProvider,
  type StorePurchase,
} from '../core/purchases';

export function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  authorization: string | undefined;
}

type Handler = (call: RecordedCall) => { status?: number; body?: unknown } | undefined;

/**
 * A `FetchLike` that speaks the server's HTTP contract (PROTOCOL.md) for the endpoints the app
 * uses. It is a double for a *remote* system only: the unit under test is the app's own client.
 */
export function scriptedFetch(handlers: Record<string, Handler>): {
  fetch: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchLike: FetchLike = (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/u, '');
    const call: RecordedCall = {
      method: init.method,
      path,
      body: init.body ? JSON.parse(init.body) : undefined,
      authorization: init.headers.authorization,
    };
    calls.push(call);
    const handler = handlers[`${init.method} ${path}`];
    const result = handler?.(call) ?? { status: 404, body: { error: { code: 'NOT_FOUND' } } };
    const status = result.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(result.body ?? {}),
    });
  };
  return { fetch: fetchLike, calls };
}

export function apiWith(
  handlers: Record<string, Handler>,
  token: string | null = 'tok',
): { api: ApiClient; calls: RecordedCall[]; unauthorized: number } {
  const { fetch, calls } = scriptedFetch(handlers);
  const out = { unauthorized: 0 } as {
    api: ApiClient;
    calls: RecordedCall[];
    unauthorized: number;
  };
  out.api = new ApiClient({
    baseUrl: 'https://api.example',
    fetch,
    token: () => token,
    onUnauthorized: () => {
      out.unauthorized += 1;
    },
  });
  out.calls = calls;
  return out;
}

/** A scripted store: each `purchase` call pops the next outcome. */
export function scriptedProvider(options: {
  platform?: 'IOS' | 'ANDROID';
  available?: boolean;
  outcomes?: ('OK' | 'CANCEL' | 'PENDING')[];
  held?: PurchaseClaim[];
}): PurchaseProvider & { finished: PurchaseClaim[]; accountTokens: string[] } {
  const finished: PurchaseClaim[] = [];
  const accountTokens: string[] = [];
  const outcomes = [...(options.outcomes ?? ['OK'])];
  const platform = options.platform ?? 'ANDROID';
  const claimFor = (n: number): PurchaseClaim =>
    platform === 'IOS'
      ? { platform: 'IOS', signedTransaction: `jws-token-${n}-xxxxxxxxxxxxxxxxxxxxxxxx` }
      : {
          platform: 'ANDROID',
          productId: 'quizparty_full_game',
          purchaseToken: `play-token-${n}-xxxxxxxx`,
        };
  const wrap = (claim: PurchaseClaim): StorePurchase => ({
    claim,
    finish: () => {
      finished.push(claim);
      return Promise.resolve();
    },
  });
  return {
    platform,
    finished,
    accountTokens,
    isAvailable: () => Promise.resolve(options.available ?? true),
    getProduct: (id) => Promise.resolve({ id, displayPrice: '₺149,99', title: 'Full game' }),
    purchase(_productId, accountToken) {
      accountTokens.push(accountToken);
      const next = outcomes.shift() ?? 'OK';
      if (next === 'CANCEL') return Promise.reject(new PurchaseCancelledError());
      if (next === 'PENDING') return Promise.reject(new PurchasePendingError());
      return Promise.resolve(wrap(claimFor(accountTokens.length)));
    },
    restore: () => Promise.resolve((options.held ?? []).map(wrap)),
  };
}
