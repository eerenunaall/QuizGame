import { describe, expect, it } from '@jest/globals';
import { apiWith, scriptedProvider } from '../testing/fakes';
import { PurchaseFlow } from './purchases';

const PRODUCT = 'quizparty_full_game';
const ENT = (tier: 'FREE' | 'FULL') => ({
  status: 200,
  body: { tier, entitlements: [], storeAccountToken: 'acct-token-1', platforms: ['ANDROID'] },
});

function flow(
  provider: ReturnType<typeof scriptedProvider>,
  handlers: Parameters<typeof apiWith>[0],
  signedIn = true,
) {
  const harness = apiWith(handlers);
  const purchases = new PurchaseFlow({
    provider,
    api: harness.api,
    productId: PRODUCT,
    signedIn: () => signedIn,
  });
  return { purchases, ...harness };
}

describe('PurchaseFlow.buy (ADR-0013 flow A/B)', () => {
  it('binds the purchase to the server account token, verifies on the server, then finishes', async () => {
    const provider = scriptedProvider({});
    const { purchases, calls } = flow(provider, {
      'GET /v1/entitlements': () => ENT('FREE'),
      'POST /v1/purchases/verify': () => ({ body: { tier: 'FULL', granted: true } }),
    });
    await expect(purchases.buy()).resolves.toBe('FULL');
    expect(provider.accountTokens).toEqual(['acct-token-1']);
    expect(calls.map((c) => c.path)).toEqual(['/v1/entitlements', '/v1/purchases/verify']);
    expect(calls[1]?.body).toEqual({
      platform: 'ANDROID',
      productId: PRODUCT,
      purchaseToken: 'play-token-1-xxxxxxxx',
    });
    expect(calls.every((c) => c.authorization === 'Bearer tok')).toBe(true);
    expect(provider.finished).toHaveLength(1);
    expect(purchases.store.get()).toMatchObject({ status: 'OWNED', tier: 'FULL' });
  });

  it('sends only the two accepted claim shapes (iOS posts the signed transaction, nothing else)', async () => {
    const provider = scriptedProvider({ platform: 'IOS' });
    const { purchases, calls } = flow(provider, {
      'GET /v1/entitlements': () => ENT('FREE'),
      'POST /v1/purchases/verify': () => ({ body: { tier: 'FULL', granted: true } }),
    });
    await purchases.buy();
    expect(Object.keys(calls[1]?.body as object).sort()).toEqual(['platform', 'signedTransaction']);
  });

  it('does NOT finish the store transaction when the server refuses it', async () => {
    const provider = scriptedProvider({});
    const { purchases } = flow(provider, {
      'GET /v1/entitlements': () => ENT('FREE'),
      'POST /v1/purchases/verify': () => ({
        status: 422,
        body: { error: { code: 'PURCHASE_INVALID' } },
      }),
    });
    await expect(purchases.buy()).rejects.toMatchObject({ code: 'PURCHASE_INVALID' });
    expect(provider.finished).toEqual([]); // stays unfinished so recovery can retry
    expect(purchases.store.get()).toMatchObject({
      status: 'FAILED',
      errorCode: 'PURCHASE_INVALID',
      tier: 'FREE',
    });
  });

  it('keeps a cancel quiet and a pending payment pending', async () => {
    const cancelled = flow(scriptedProvider({ outcomes: ['CANCEL'] }), {
      'GET /v1/entitlements': () => ENT('FREE'),
    });
    await expect(cancelled.purchases.buy()).rejects.toThrow('PURCHASE_CANCELLED');
    expect(cancelled.purchases.store.get().errorCode).toBe('PURCHASE_CANCELLED');

    const pending = flow(scriptedProvider({ outcomes: ['PENDING'] }), {
      'GET /v1/entitlements': () => ENT('FREE'),
    });
    await expect(pending.purchases.buy()).rejects.toThrow('PURCHASE_PENDING');
    expect(pending.purchases.store.get().status).toBe('PENDING');
  });

  it('does not open the store sheet when the account already owns the game', async () => {
    const provider = scriptedProvider({});
    const { purchases } = flow(provider, { 'GET /v1/entitlements': () => ENT('FULL') });
    await purchases.buy();
    expect(provider.accountTokens).toEqual([]);
    expect(purchases.store.get().tier).toBe('FULL');
  });

  it('refuses to buy without an account (the purchase must be bound to one)', async () => {
    const provider = scriptedProvider({});
    const { purchases, calls } = flow(provider, {}, false);
    await expect(purchases.buy()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(calls).toEqual([]);
    expect(provider.accountTokens).toEqual([]);
  });

  it("shows another account's transaction as refused and grants nothing locally", async () => {
    const { purchases } = flow(scriptedProvider({}), {
      'GET /v1/entitlements': () => ENT('FREE'),
      'POST /v1/purchases/verify': () => ({
        status: 409,
        body: { error: { code: 'TRANSACTION_ALREADY_BOUND' } },
      }),
    });
    await expect(purchases.buy()).rejects.toMatchObject({ code: 'TRANSACTION_ALREADY_BOUND' });
    expect(purchases.store.get().tier).toBe('FREE');
  });
});

describe('PurchaseFlow.restore / recover (flow B and C)', () => {
  const held = [
    { platform: 'ANDROID', productId: PRODUCT, purchaseToken: 'held-token-0000' } as const,
    { platform: 'ANDROID', productId: PRODUCT, purchaseToken: 'held-token-1111' } as const,
  ];

  it('posts what the store holds and finishes only what the server accepted', async () => {
    const provider = scriptedProvider({ held: [...held] });
    const { purchases, calls } = flow(provider, {
      'POST /v1/purchases/restore': () => ({
        body: { results: [{ ok: true }, { ok: false, code: 'PURCHASE_INVALID' }], tier: 'FULL' },
      }),
    });
    await expect(purchases.restore()).resolves.toBe('RESTORED');
    expect(calls[0]?.body).toEqual({ purchases: held });
    expect(provider.finished).toEqual([held[0]]);
    expect(purchases.store.get()).toMatchObject({
      status: 'OWNED',
      tier: 'FULL',
      restored: 'RESTORED',
    });
  });

  it('says so when the store holds nothing', async () => {
    const { purchases, calls } = flow(scriptedProvider({ held: [] }), {});
    await expect(purchases.restore()).resolves.toBe('NOTHING');
    expect(calls).toEqual([]);
    expect(purchases.store.get().restored).toBe('NOTHING');
  });

  it('recover() after a crash settles the unfinished transaction and never throws', async () => {
    const provider = scriptedProvider({ held: [held[0]!] });
    const { purchases } = flow(provider, {
      'POST /v1/purchases/restore': () => ({ body: { results: [{ ok: true }], tier: 'FULL' } }),
    });
    await purchases.recover();
    expect(provider.finished).toEqual([held[0]]);

    const failing = flow(scriptedProvider({ held: [held[0]!] }), {
      'POST /v1/purchases/restore': () => ({
        status: 503,
        body: { error: { code: 'STORE_UNAVAILABLE' } },
      }),
    });
    await expect(failing.purchases.recover()).resolves.toBeUndefined();
    expect(failing.purchases.store.get().status).toBe('FAILED');
  });

  it('recover() does nothing while signed out', async () => {
    const provider = scriptedProvider({ held: [held[0]!] });
    const { purchases, calls } = flow(provider, {}, false);
    await purchases.recover();
    expect(calls).toEqual([]);
  });
});

describe('PurchaseFlow.load', () => {
  it('shows the store price and the server tier', async () => {
    const { purchases } = flow(scriptedProvider({}), { 'GET /v1/entitlements': () => ENT('FREE') });
    await purchases.load();
    expect(purchases.store.get()).toMatchObject({
      status: 'IDLE',
      tier: 'FREE',
      storeAvailable: true,
    });
    expect(purchases.store.get().product?.displayPrice).toBe('₺149,99');
  });

  it('degrades when the store is unavailable (simulator, no Play Services)', async () => {
    const { purchases } = flow(scriptedProvider({ available: false }), {
      'GET /v1/entitlements': () => ENT('FULL'),
    });
    await purchases.load();
    expect(purchases.store.get()).toMatchObject({
      storeAvailable: false,
      product: null,
      tier: 'FULL',
      status: 'OWNED',
    });
  });
});
