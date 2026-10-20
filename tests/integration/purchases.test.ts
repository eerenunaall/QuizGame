import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appleNotification,
  appleTransaction,
  createAppleChain,
  APPLE_PRODUCT,
  BUNDLE_ID,
} from '../helpers/apple-store';
import { GOOGLE_PACKAGE, GOOGLE_PRODUCT } from '../helpers/google-store';
import { call, player, pubsub, startShop, type Shop } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';
import { staff } from '../helpers/admin';

/**
 * Acceptance U-X (server side): a purchase is only believed when the store itself vouches for it, it
 * belongs to exactly one account, and granting twice changes nothing. Both stores are real HTTP/JWS
 * speakers; the verification code under test is the production code.
 */
let shop: Shop;
let server: TestServer;
beforeAll(async () => {
  shop = await startShop();
  server = shop.server;
});
afterAll(async () => {
  await shop.dispose();
});

const verifyIos = (token: string, signedTransaction: string) =>
  call(server, 'POST', '/v1/purchases/verify', {
    token,
    body: { platform: 'IOS', signedTransaction },
  });
const verifyAndroid = (token: string, purchaseToken: string, productId = GOOGLE_PRODUCT) =>
  call(server, 'POST', '/v1/purchases/verify', {
    token,
    body: { platform: 'ANDROID', productId, purchaseToken },
  });
const entitlementsOf = (token: string) =>
  call<{ tier: string; storeAccountToken: string; platforms: string[] }>(
    server,
    'GET',
    '/v1/entitlements',
    { token },
  );
const rows = async (accountId: string) => ({
  transactions: await server.db.db
    .selectFrom('purchase_transactions')
    .select(['platform', 'status', 'external_transaction_id'])
    .where('account_id', '=', accountId)
    .execute(),
  entitlements: await server.db.db
    .selectFrom('entitlements')
    .select(['status', 'platform'])
    .where('account_id', '=', accountId)
    .execute(),
});
let nextOrder = 0;
const playPurchase = (
  storeToken: string | undefined,
  patch: Partial<Parameters<typeof shop.google.purchases.set>[1]> = {},
): string => {
  const token = `play-token-${randomUUID()}`;
  shop.google.purchases.set(token, {
    orderId: `GPA.${1000 + nextOrder++}`,
    purchaseState: 0,
    acknowledgementState: 0,
    ...(storeToken ? { obfuscatedExternalAccountId: storeToken } : {}),
    ...patch,
  });
  return token;
};

describe('the store session of a player', () => {
  it('starts as FREE and hands the app the id the stores must bind a purchase to', async () => {
    const me = await player(server);
    const view = await entitlementsOf(me.token);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      tier: 'FREE',
      storeAccountToken: me.storeToken,
      platforms: expect.arrayContaining(['IOS', 'ANDROID']) as string[],
    });
    expect(me.storeToken).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('needs a sign-in, refuses a staff console session, and is closed when payments are off', async () => {
    expect((await call(server, 'GET', '/v1/entitlements')).status).toBe(401);
    const admin = await staff(server, ['ADMIN']);
    expect((await call(server, 'GET', '/v1/entitlements', { token: admin.token })).status).toBe(
      403,
    );
    expect(
      (
        await call(server, 'POST', '/v1/purchases/verify', {
          token: admin.token,
          body: { platform: 'IOS', signedTransaction: 'x'.repeat(30) },
        })
      ).status,
    ).toBe(403);

    const off = await startServer({});
    try {
      const me = await player(off);
      const result = await call(off, 'POST', '/v1/purchases/verify', {
        token: me.token,
        body: { platform: 'IOS', signedTransaction: 'x'.repeat(30) },
      });
      expect(result).toMatchObject({ status: 404, body: { error: { code: 'FEATURE_DISABLED' } } });
      expect(
        (await call<{ platforms: string[] }>(off, 'GET', '/v1/entitlements', { token: me.token }))
          .body.platforms,
      ).toEqual([]);
    } finally {
      await off.dispose();
    }
  });
});

describe('Apple purchases (StoreKit 2)', () => {
  it('grants the full game for a purchase signed by the store for this account, and only once', async () => {
    const me = await player(server);
    const jws = shop.apple.sign(appleTransaction(me.storeToken));
    const first = await verifyIos(me.token, jws);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ tier: 'FULL', granted: true });
    expect((await entitlementsOf(me.token)).body.tier).toBe('FULL');

    const again = await verifyIos(me.token, jws);
    expect(again.body).toMatchObject({ tier: 'FULL', granted: false });
    const stored = await rows(me.accountId);
    expect(stored.transactions).toEqual([
      expect.objectContaining({ platform: 'IOS', status: 'VERIFIED' }),
    ]);
    expect(stored.entitlements).toEqual([{ status: 'ACTIVE', platform: 'IOS' }]);
  });

  it('refuses anything the store did not sign: junk, tampering, another root, wrong app, wrong product, wrong kind', async () => {
    const me = await player(server);
    const good = appleTransaction(me.storeToken);
    const signed = shop.apple.sign(good);
    const [header, , signature] = signed.split('.') as [string, string, string];
    const tamperedBody = Buffer.from(JSON.stringify({ ...good, productId: 'other' })).toString(
      'base64url',
    );
    const strangers = createAppleChain('Stranger');
    const attempts = [
      'not-a-jws-at-all-but-long-enough',
      `${header}.${tamperedBody}.${signature}`,
      strangers.sign(good),
      shop.apple.sign({ ...good, bundleId: 'com.someone.else' }),
      shop.apple.sign({ ...good, productId: 'premium_pack' }),
      shop.apple.sign({ ...good, type: 'Consumable' }),
      shop.apple.sign({ ...good, type: 'Auto-Renewable Subscription' }),
      shop.apple.sign({ ...good, environment: 'Production' }), // no production verifier without an app id
    ];
    for (const jws of attempts) {
      const result = await verifyIos(me.token, jws);
      expect(result, jws.slice(0, 24)).toMatchObject({
        status: 422,
        body: { error: { code: 'PURCHASE_INVALID' } },
      });
    }
    expect(await rows(me.accountId)).toEqual({ transactions: [], entitlements: [] });
    expect((await entitlementsOf(me.token)).body.tier).toBe('FREE');
  });

  it("binds a purchase to the account it was made for: someone else's receipt, or one without an account, gives nothing", async () => {
    const buyer = await player(server);
    const thief = await player(server);
    const jws = shop.apple.sign(appleTransaction(buyer.storeToken));
    expect(await verifyIos(thief.token, jws)).toMatchObject({
      status: 403,
      body: { error: { code: 'PURCHASE_ACCOUNT_MISMATCH' } },
    });
    expect(await verifyIos(thief.token, shop.apple.sign(appleTransaction(null)))).toMatchObject({
      status: 403,
    });
    expect(await rows(thief.accountId)).toEqual({ transactions: [], entitlements: [] });
    expect((await entitlementsOf(thief.token)).body.tier).toBe('FREE');
    // the buyer is unaffected and can still claim it
    expect((await verifyIos(buyer.token, jws)).body).toMatchObject({ tier: 'FULL' });
  });

  it('never moves a transaction to another account, even if the store data names that account', async () => {
    const first = await player(server);
    const second = await player(server);
    const tx = appleTransaction(first.storeToken);
    expect((await verifyIos(first.token, shop.apple.sign(tx))).status).toBe(200);
    // same store transaction id, but carrying the second account's token (only possible by a fault or forgery)
    const reissued = shop.apple.sign({ ...tx, appAccountToken: second.storeToken });
    expect(await verifyIos(second.token, reissued)).toMatchObject({
      status: 409,
      body: { error: { code: 'TRANSACTION_ALREADY_BOUND' } },
    });
    expect(await rows(second.accountId)).toEqual({ transactions: [], entitlements: [] });
  });

  it('restores on another device for the same account, item by item', async () => {
    const me = await player(server);
    const jws = shop.apple.sign(appleTransaction(me.storeToken));
    expect((await verifyIos(me.token, jws)).status).toBe(200);
    const restored = await call<{ results: { ok: boolean; code?: string }[]; tier: string }>(
      server,
      'POST',
      '/v1/purchases/restore',
      {
        token: me.token,
        body: {
          purchases: [
            { platform: 'IOS', signedTransaction: 'x'.repeat(40) },
            { platform: 'IOS', signedTransaction: jws },
          ],
        },
      },
    );
    expect(restored.body.tier).toBe('FULL');
    expect(restored.body.results).toEqual([{ ok: false, code: 'PURCHASE_INVALID' }, { ok: true }]);

    // a brand-new sign-in of the same account (another device) restores from nothing but the store data
    const other = await server.built.accountSessions.create(me.accountId, 'MOBILE', {
      ipHash: 'x',
      userAgentHash: null,
    });
    const fresh = await call<{ tier: string }>(server, 'POST', '/v1/purchases/restore', {
      token: other.token,
      body: { purchases: [{ platform: 'IOS', signedTransaction: jws }] },
    });
    expect(fresh.body.tier).toBe('FULL');
    expect((await rows(me.accountId)).entitlements).toHaveLength(1);
  });

  it('a purchase the store already revoked is recorded and gives nothing', async () => {
    const me = await player(server);
    const jws = shop.apple.sign(
      appleTransaction(me.storeToken, { revocationDate: Date.now(), revocationReason: 0 }),
    );
    expect(await verifyIos(me.token, jws)).toMatchObject({
      status: 410,
      body: { error: { code: 'PURCHASE_REFUNDED' } },
    });
    expect((await entitlementsOf(me.token)).body.tier).toBe('FREE');
  });

  it('takes the entitlement away on a signed refund notification, once, and a refund cannot be undone by a restore', async () => {
    const me = await player(server);
    const tx = appleTransaction(me.storeToken);
    const jws = shop.apple.sign(tx);
    expect((await verifyIos(me.token, jws)).status).toBe(200);

    const refund = appleNotification(shop.apple, 'REFUND', tx);
    const forged = createAppleChain('Forger');
    const fake = appleNotification(forged, 'REFUND', tx);
    expect(
      (
        await call(server, 'POST', '/v1/webhooks/apple', {
          body: { signedPayload: fake.signedPayload },
        })
      ).status,
    ).toBe(400);
    expect((await entitlementsOf(me.token)).body.tier).toBe('FULL');

    expect(
      (
        await call(server, 'POST', '/v1/webhooks/apple', {
          body: { signedPayload: refund.signedPayload },
        })
      ).status,
    ).toBe(200);
    expect((await entitlementsOf(me.token)).body.tier).toBe('FREE');
    // delivered again (Apple retries): nothing more happens, and it still says OK
    expect(
      (
        await call(server, 'POST', '/v1/webhooks/apple', {
          body: { signedPayload: refund.signedPayload },
        })
      ).status,
    ).toBe(200);
    const stored = await rows(me.accountId);
    expect(stored.transactions).toEqual([expect.objectContaining({ status: 'REFUNDED' })]);
    expect(stored.entitlements).toEqual([{ status: 'REVOKED', platform: 'IOS' }]);

    expect(await verifyIos(me.token, jws)).toMatchObject({ status: 410 });
    expect((await entitlementsOf(me.token)).body.tier).toBe('FREE');
  });

  it('ignores notifications that are not refunds and notifications for purchases it never saw', async () => {
    const me = await player(server);
    const tx = appleTransaction(me.storeToken);
    expect((await verifyIos(me.token, shop.apple.sign(tx))).status).toBe(200);
    const other = appleNotification(shop.apple, 'DID_CHANGE_RENEWAL_STATUS', tx);
    expect(
      (
        await call(server, 'POST', '/v1/webhooks/apple', {
          body: { signedPayload: other.signedPayload },
        })
      ).status,
    ).toBe(200);
    const unknown = appleNotification(shop.apple, 'REFUND', appleTransaction(randomUUID()));
    expect(
      (
        await call(server, 'POST', '/v1/webhooks/apple', {
          body: { signedPayload: unknown.signedPayload },
        })
      ).status,
    ).toBe(200);
    expect((await entitlementsOf(me.token)).body.tier).toBe('FULL');
  });

  it('refuses malformed requests before anything else happens', async () => {
    const me = await player(server);
    for (const body of [
      {},
      { platform: 'IOS' },
      { platform: 'IOS', signedTransaction: 'short' },
      { platform: 'IOS', signedTransaction: 'x'.repeat(30), price: 0 },
      { platform: 'WINDOWS', signedTransaction: 'x'.repeat(30) },
    ]) {
      expect(
        (await call(server, 'POST', '/v1/purchases/verify', { token: me.token, body })).status,
      ).toBe(400);
    }
    expect(
      (
        await call(server, 'POST', '/v1/purchases/restore', {
          token: me.token,
          body: { purchases: [] },
        })
      ).status,
    ).toBe(400);
  });
});

describe('Google Play purchases', () => {
  it('grants after reading the purchase from Google, then acknowledges it, once', async () => {
    const me = await player(server);
    const token = playPurchase(me.storeToken);
    const first = await verifyAndroid(me.token, token);
    expect(first.body).toMatchObject({ tier: 'FULL', granted: true });
    expect(shop.google.acknowledged).toEqual(expect.arrayContaining([token]));
    expect(shop.google.acknowledged.filter((t) => t === token)).toHaveLength(1);
    // restored again: no second acknowledgement (Google already has it), still entitled
    const again = await verifyAndroid(me.token, token);
    expect(again.body).toMatchObject({ tier: 'FULL', granted: false });
    expect(shop.google.acknowledged.filter((t) => t === token)).toHaveLength(1);
    const stored = await rows(me.accountId);
    expect(stored.entitlements).toEqual([{ status: 'ACTIVE', platform: 'ANDROID' }]);
    // the purchase token itself is not stored, only a keyed hash
    const dump = JSON.stringify(
      await server.db.db
        .selectFrom('purchase_transactions')
        .selectAll()
        .where('account_id', '=', me.accountId)
        .execute(),
    );
    expect(dump).not.toContain(token);
  });

  it('refuses what Google does not vouch for: unknown token, another product, another account, pending, store down', async () => {
    const me = await player(server);
    const other = await player(server);
    const calls = () => shop.google.calls.length;

    expect(await verifyAndroid(me.token, `unknown-${randomUUID()}`)).toMatchObject({
      status: 422,
      body: { error: { code: 'PURCHASE_INVALID' } },
    });
    const before = calls();
    expect(
      await verifyAndroid(me.token, playPurchase(me.storeToken), 'premium_pack'),
    ).toMatchObject({ status: 422 });
    expect(calls()).toBe(before); // the client does not choose what we ask Google about

    expect(await verifyAndroid(me.token, playPurchase(other.storeToken))).toMatchObject({
      status: 403,
      body: { error: { code: 'PURCHASE_ACCOUNT_MISMATCH' } },
    });
    expect(await verifyAndroid(me.token, playPurchase(undefined))).toMatchObject({ status: 403 });
    expect(
      await verifyAndroid(me.token, playPurchase(me.storeToken, { purchaseState: 2 })),
    ).toMatchObject({ status: 409, body: { error: { code: 'PURCHASE_PENDING' } } });
    expect(
      await verifyAndroid(me.token, playPurchase(me.storeToken, { purchaseState: 1 })),
    ).toMatchObject({ status: 410, body: { error: { code: 'PURCHASE_REFUNDED' } } });

    shop.google.failWith = 503;
    try {
      expect(await verifyAndroid(me.token, playPurchase(me.storeToken))).toMatchObject({
        status: 503,
        body: { error: { code: 'STORE_UNAVAILABLE' } },
      });
    } finally {
      shop.google.failWith = null;
    }
    expect((await rows(me.accountId)).entitlements).toEqual([]);
    expect((await entitlementsOf(me.token)).body.tier).toBe('FREE');
  });

  it('does not acknowledge a purchase it did not grant', async () => {
    const me = await player(server);
    const other = await player(server);
    const token = playPurchase(other.storeToken);
    await verifyAndroid(me.token, token);
    expect(shop.google.acknowledged).not.toContain(token);
  });

  it('lets a Play test purchase in as a sandbox entitlement only while sandbox purchases are accepted', async () => {
    const me = await player(server);
    const token = playPurchase(me.storeToken, { purchaseType: 0 });
    expect((await verifyAndroid(me.token, token)).body).toMatchObject({ tier: 'FULL' });
    const row = await server.db.db
      .selectFrom('purchase_transactions')
      .select('environment')
      .where('account_id', '=', me.accountId)
      .executeTakeFirstOrThrow();
    expect(row.environment).toBe('SANDBOX');

    const strict = await startShop({ PAYMENTS_ACCEPT_SANDBOX: '0' });
    try {
      const buyer = await player(strict.server);
      const t = `t-${randomUUID()}`;
      strict.google.purchases.set(t, {
        orderId: 'GPA.1',
        purchaseState: 0,
        acknowledgementState: 0,
        obfuscatedExternalAccountId: buyer.storeToken,
        purchaseType: 0,
      });
      expect(
        await call(strict.server, 'POST', '/v1/purchases/verify', {
          token: buyer.token,
          body: { platform: 'ANDROID', productId: GOOGLE_PRODUCT, purchaseToken: t },
        }),
      ).toMatchObject({ status: 422 });
      // and no Apple sandbox either
      expect(
        await call(strict.server, 'POST', '/v1/purchases/verify', {
          token: buyer.token,
          body: {
            platform: 'IOS',
            signedTransaction: strict.apple.sign(appleTransaction(buyer.storeToken)),
          },
        }),
      ).toMatchObject({ status: 422 });
    } finally {
      await strict.dispose();
    }
  });
});

describe('Google real-time notifications', () => {
  const hook = (secret: string, event: unknown, id?: string) =>
    call(server, 'POST', `/v1/webhooks/google/${secret}`, { body: pubsub(event, id) });

  it('takes the entitlement away when Google itself says the purchase was voided, and only then', async () => {
    const me = await player(server);
    const token = playPurchase(me.storeToken);
    expect((await verifyAndroid(me.token, token)).status).toBe(200);
    const event = {
      version: '1.0',
      packageName: GOOGLE_PACKAGE,
      voidedPurchaseNotification: { purchaseToken: token, orderId: 'x', productType: 1 },
    };

    // a notification is only a hint: while Google still says "purchased", nothing is taken away
    expect((await hook(shop.webhookSecret, event)).status).toBe(200);
    expect((await entitlementsOf(me.token)).body.tier).toBe('FULL');

    shop.google.purchases.get(token)!.purchaseState = 1;
    const id = randomUUID();
    expect((await hook(shop.webhookSecret, event, id)).status).toBe(200);
    expect((await entitlementsOf(me.token)).body.tier).toBe('FREE');
    expect((await hook(shop.webhookSecret, event, id)).status).toBe(200); // redelivery
    expect((await rows(me.accountId)).entitlements).toEqual([
      { status: 'REVOKED', platform: 'ANDROID' },
    ]);
    expect(await verifyAndroid(me.token, token)).toMatchObject({ status: 410 });
  });

  it('answers 404 to a wrong secret, ignores other apps and unknown tokens, and asks to be retried when Google is down', async () => {
    const me = await player(server);
    const token = playPurchase(me.storeToken);
    await verifyAndroid(me.token, token);
    const event = (packageName: string, purchaseToken: string) => ({
      packageName,
      voidedPurchaseNotification: { purchaseToken },
    });
    expect(
      (await hook('wrong-secret-wrong-secret-wrong', event(GOOGLE_PACKAGE, token))).status,
    ).toBe(404);
    expect((await hook(shop.webhookSecret, event('com.other.app', token))).status).toBe(200);
    const before = shop.google.calls.length;
    expect(
      (await hook(shop.webhookSecret, event(GOOGLE_PACKAGE, `never-seen-${randomUUID()}`))).status,
    ).toBe(200);
    expect(shop.google.calls.length).toBe(before); // an unknown token never makes us call Google
    shop.google.failWith = 500;
    try {
      expect((await hook(shop.webhookSecret, event(GOOGLE_PACKAGE, token))).status).toBe(503);
    } finally {
      shop.google.failWith = null;
    }
    expect(
      (
        await call(server, 'POST', `/v1/webhooks/google/${shop.webhookSecret}`, {
          body: { message: { data: 'not-base64-json', messageId: 'm' } },
        })
      ).status,
    ).toBe(400);
    expect((await entitlementsOf(me.token)).body.tier).toBe('FULL');
  });
});

describe('what a purchase is not', () => {
  it('can never be entered by naming a price, a product or a tier', async () => {
    const me = await player(server);
    for (const body of [
      { platform: 'IOS', signedTransaction: 'x'.repeat(30), tier: 'FULL' },
      {
        platform: 'ANDROID',
        productId: GOOGLE_PRODUCT,
        purchaseToken: 'y'.repeat(20),
        accountId: me.accountId,
      },
    ]) {
      expect(
        (await call(server, 'POST', '/v1/purchases/verify', { token: me.token, body })).status,
      ).toBe(400);
    }
    expect((await entitlementsOf(me.token)).body.tier).toBe('FREE');
    expect(APPLE_PRODUCT).toBe('quizparty_full_game');
    expect(BUNDLE_ID).toBe('app.quizparty.test');
  });
});
