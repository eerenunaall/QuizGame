import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appleNotification, appleTransaction, createAppleChain } from '../helpers/apple-store';
import { GOOGLE_PRODUCT } from '../helpers/google-store';
import { closeParty, createParty } from '../helpers/party';
import { call, player, pubsub, startShop, type Shop } from '../helpers/payments';

/**
 * ATTACK 9 (fake purchase) and ATTACK 25 (abuse of the TV unlock link): every way a person with no
 * purchase can try to be treated as one who bought, against the real server with both stores
 * speaking their real wire formats. The only winning move is a purchase the store itself made for
 * the attacker's own account.
 */
let shop: Shop;
let strict: Shop;
beforeAll(async () => {
  shop = await startShop({ DEFAULT_ROOM_TIER: 'FREE' });
  strict = await startShop({ DEFAULT_ROOM_TIER: 'FREE', RATE_LIMIT_SCALE: '1' });
});
afterAll(async () => {
  await Promise.all([shop.dispose(), strict.dispose()]);
});

const server = () => shop.server;
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const tierOf = async (token: string) =>
  (await call<{ tier: string }>(server(), 'GET', '/v1/entitlements', { token })).body.tier;
const verifyIos = (token: string, signedTransaction: string, on = server()) =>
  call(on, 'POST', '/v1/purchases/verify', { token, body: { platform: 'IOS', signedTransaction } });
const dbCounts = async (accountId: string) => ({
  entitlements: (
    await server()
      .db.db.selectFrom('entitlements')
      .select('id')
      .where('account_id', '=', accountId)
      .execute()
  ).length,
  transactions: (
    await server()
      .db.db.selectFrom('purchase_transactions')
      .select('id')
      .where('account_id', '=', accountId)
      .execute()
  ).length,
});

describe('ATTACK 9 — fake purchase', () => {
  it('forged receipts of every shape give nothing', async () => {
    const me = await player(server());
    const good = appleTransaction(me.storeToken);
    const real = shop.apple.sign(good);
    const [header, payload] = real.split('.') as [string, string, string];
    const x5c = (JSON.parse(Buffer.from(header, 'base64url').toString()) as { x5c: string[] }).x5c;
    const stranger = createAppleChain('Attacker');
    const forgeries: Record<string, string> = {
      'alg none, no signature': `${b64({ alg: 'none' })}.${payload}.`,
      'alg none with the real chain': `${b64({ alg: 'none', x5c })}.${payload}.`,
      'HS256 with a guessed secret': `${b64({ alg: 'HS256', x5c })}.${payload}.${Buffer.from('x'.repeat(32)).toString('base64url')}`,
      'real header, empty signature': `${header}.${payload}.`,
      'real header, garbage signature': `${header}.${payload}.${Buffer.from('garbage'.repeat(10)).toString('base64url')}`,
      'two-certificate chain': `${b64({ alg: 'ES256', x5c: x5c.slice(0, 2) })}.${payload}.${real.split('.')[2]}`,
      'leaf only': `${b64({ alg: 'ES256', x5c: x5c.slice(0, 1) })}.${payload}.${real.split('.')[2]}`,
      "attacker's own Apple-shaped chain": stranger.sign(good),
      'valid signature, payload swapped to another product': shop.apple.sign({
        ...good,
        productId: 'premium',
      }),
      'JWS in JSON serialisation': JSON.stringify({ protected: header, payload, signature: 'abc' }),
      'a JSON object': JSON.stringify(good),
      'the bare payload': payload,
      'dots only': '.'.repeat(40),
      'huge junk': 'A'.repeat(19_000),
    };
    for (const [name, jws] of Object.entries(forgeries)) {
      const result = await verifyIos(me.token, jws);
      expect([400, 413, 422], name).toContain(result.status);
    }
    expect(await tierOf(me.token)).toBe('FREE');
    expect(await dbCounts(me.accountId)).toEqual({ entitlements: 0, transactions: 0 });
  });

  it('the client cannot assert a price, product, tier, account or store environment', async () => {
    const me = await player(server());
    const base = { platform: 'IOS', signedTransaction: 'x'.repeat(30) };
    for (const extra of [
      { tier: 'FULL' },
      { price: 0 },
      { accountId: me.accountId },
      { environment: 'Production' },
      { entitlement: { active: true } },
    ])
      expect(
        (
          await call(server(), 'POST', '/v1/purchases/verify', {
            token: me.token,
            body: { ...base, ...extra },
          })
        ).status,
      ).toBe(400);
    for (const qs of ['?tier=FULL', '?force=1&account=other'])
      expect(
        (
          await call<{ tier: string }>(server(), 'GET', `/v1/entitlements${qs}`, {
            token: me.token,
            headers: { 'x-tier': 'FULL', 'x-forwarded-for': '1.2.3.4' },
          })
        ).body.tier,
      ).toBe('FREE');
  });

  it("replaying someone else's genuine receipt, before or after they use it, never entitles the replayer", async () => {
    const victim = await player(server());
    const attacker = await player(server());
    const jws = shop.apple.sign(appleTransaction(victim.storeToken));
    expect((await verifyIos(attacker.token, jws)).status).toBe(403); // before the victim used it
    expect((await verifyIos(victim.token, jws)).status).toBe(200);
    expect((await verifyIos(attacker.token, jws)).status).toBe(403); // after
    expect(await tierOf(attacker.token)).toBe('FREE');
    expect(await tierOf(victim.token)).toBe('FULL');
    expect(await dbCounts(attacker.accountId)).toEqual({ entitlements: 0, transactions: 0 });
  });

  it('races on one receipt end in exactly one transaction and one entitlement', async () => {
    const me = await player(server());
    const jws = shop.apple.sign(appleTransaction(me.storeToken));
    const results = await Promise.all(Array.from({ length: 25 }, () => verifyIos(me.token, jws)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await dbCounts(me.accountId)).toEqual({ entitlements: 1, transactions: 1 });

    // two accounts racing for one transaction id: one wins, the other is told it is taken
    const a = await player(server());
    const b = await player(server());
    const tx = appleTransaction(a.storeToken);
    const forA = shop.apple.sign(tx);
    const forB = shop.apple.sign({ ...tx, appAccountToken: b.storeToken });
    const raced = await Promise.all([
      ...Array.from({ length: 6 }, () => verifyIos(a.token, forA)),
      ...Array.from({ length: 6 }, () => verifyIos(b.token, forB)),
    ]);
    const winners = new Set(raced.filter((r) => r.status === 200).map((r) => r.status));
    expect(winners.size).toBe(1);
    const bound = await server()
      .db.db.selectFrom('purchase_transactions')
      .select('account_id')
      .where('external_transaction_id', '=', String(tx.originalTransactionId))
      .execute();
    expect(bound).toHaveLength(1);
    const losers = raced.filter((r) => r.status !== 200);
    expect(losers.every((r) => r.status === 409)).toBe(true);
    const entitled = (await Promise.all([tierOf(a.token), tierOf(b.token)])).filter(
      (t) => t === 'FULL',
    );
    expect(entitled).toHaveLength(1);
  });

  it('a Google purchase made for another account, for another app or product, or one the store calls pending, gives nothing', async () => {
    const victim = await player(server());
    const attacker = await player(server());
    const add = (patch: object = {}) => {
      const token = `play-${randomUUID()}`;
      shop.google.purchases.set(token, {
        orderId: `GPA.${randomUUID().slice(0, 8)}`,
        purchaseState: 0,
        acknowledgementState: 0,
        obfuscatedExternalAccountId: victim.storeToken,
        ...patch,
      });
      return token;
    };
    const attempts = [
      { token: add(), productId: GOOGLE_PRODUCT },
      { token: add({ purchaseState: 2 }), productId: GOOGLE_PRODUCT },
      { token: add(), productId: 'premium_pack' },
      { token: add({ obfuscatedExternalAccountId: undefined }), productId: GOOGLE_PRODUCT },
      { token: `invented-${randomUUID()}`, productId: GOOGLE_PRODUCT },
    ];
    for (const attempt of attempts) {
      const result = await call(server(), 'POST', '/v1/purchases/verify', {
        token: attacker.token,
        body: { platform: 'ANDROID', productId: attempt.productId, purchaseToken: attempt.token },
      });
      expect([403, 409, 422], attempt.token).toContain(result.status);
    }
    expect(await tierOf(attacker.token)).toBe('FREE');
    expect(shop.google.acknowledged).toHaveLength(0);
  });

  it('forged or replayed refund notices neither revoke a genuine purchase nor reach a stranger', async () => {
    const me = await player(server());
    const tx = appleTransaction(me.storeToken);
    expect((await verifyIos(me.token, shop.apple.sign(tx))).status).toBe(200);
    const forger = createAppleChain('Forger');
    for (const payload of [
      appleNotification(forger, 'REFUND', tx).signedPayload,
      appleNotification(shop.apple, 'REFUND', { ...tx, bundleId: 'com.other.app' }).signedPayload,
      'x'.repeat(40),
    ])
      expect(
        (await call(server(), 'POST', '/v1/webhooks/apple', { body: { signedPayload: payload } }))
          .status,
      ).toBe(400);
    expect(await tierOf(me.token)).toBe('FULL');

    // Google: wrong secret (404), right secret but the purchase is still valid at Google (a hint only)
    const token = `play-${randomUUID()}`;
    shop.google.purchases.set(token, {
      orderId: 'GPA.hint',
      purchaseState: 0,
      acknowledgementState: 0,
      obfuscatedExternalAccountId: me.storeToken,
    });
    const gp = await player(server());
    shop.google.purchases.get(token)!.obfuscatedExternalAccountId = gp.storeToken;
    await call(server(), 'POST', '/v1/purchases/verify', {
      token: gp.token,
      body: { platform: 'ANDROID', productId: GOOGLE_PRODUCT, purchaseToken: token },
    });
    const event = {
      packageName: 'app.quizparty.test',
      voidedPurchaseNotification: { purchaseToken: token },
    };
    expect(
      (
        await call(server(), 'POST', '/v1/webhooks/google/not-the-secret-not-the-secret', {
          body: pubsub(event),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(server(), 'POST', `/v1/webhooks/google/${shop.webhookSecret}`, {
          body: pubsub(event),
        })
      ).status,
    ).toBe(200);
    expect(await tierOf(gp.token)).toBe('FULL');
  });

  it('guessing is rate limited per account and per address under production limits', async () => {
    const me = await player(strict.server);
    let limited = 0;
    for (let i = 0; i < 14; i += 1) {
      const result = await verifyIos(me.token, 'x'.repeat(30) + i, strict.server);
      if (result.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    const hooks = [];
    for (let i = 0; i < 160; i += 1)
      hooks.push(
        (
          await call(strict.server, 'POST', '/v1/webhooks/apple', {
            body: { signedPayload: 'x'.repeat(30) },
          })
        ).status,
      );
    expect(hooks).toContain(429);
    expect(hooks.every((s) => s === 400 || s === 429)).toBe(true);
  });
});

describe('ATTACK 25 — abuse of the TV unlock link', () => {
  it('seeing the QR code gives nothing: a stranger who claims it without owning the game unlocks nothing', async () => {
    const party = await createParty(server(), 2);
    party.display.send('REQUEST_UNLOCK_LINK', {});
    const { url } = (await party.display.nextOfType('UNLOCK_LINK')).payload;
    const token = url.split('/unlock/')[1]!;
    const shoulderSurfer = await player(server());
    const claimed = await call<{ tier: string }>(
      server(),
      'POST',
      `/v1/link-intents/${token}/claim`,
      { token: shoulderSurfer.token, body: {} },
    );
    expect(claimed.body.tier).toBe('FREE');
    expect(server().built.manager.getByCode(party.created.code)!.state.tier).toBe('FREE');
    await closeParty(party);
  });

  it('guessing tokens is hopeless and rate limited; every miss looks alike', async () => {
    const me = await player(strict.server);
    const statuses: number[] = [];
    const bodies = new Set<string>();
    for (let i = 0; i < 14; i += 1) {
      const guess = Buffer.from(randomUUID() + i)
        .toString('base64url')
        .slice(0, 22);
      const result = await call(strict.server, 'POST', `/v1/link-intents/${guess}/claim`, {
        token: me.token,
        body: {},
      });
      statuses.push(result.status);
      if (result.status === 404) bodies.add(JSON.stringify(result.body));
    }
    expect(statuses).toContain(429);
    expect(statuses.every((s) => s === 404 || s === 429)).toBe(true);
    expect(bodies.size).toBe(1);
  });

  it('a token is not an identity: it cannot be claimed without a sign-in, and a stolen session cookie header trick does not help', async () => {
    const party = await createParty(server(), 1);
    party.display.send('REQUEST_UNLOCK_LINK', {});
    const token = (await party.display.nextOfType('UNLOCK_LINK')).payload.url.split('/unlock/')[1]!;
    expect(
      (await call(server(), 'POST', `/v1/link-intents/${token}/claim`, { body: {} })).status,
    ).toBe(401);
    expect(
      (
        await call(server(), 'POST', `/v1/link-intents/${token}/claim`, {
          body: {},
          headers: { cookie: 'qp_session=invented', origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(401);
    expect(server().built.manager.getByCode(party.created.code)!.state.tier).toBe('FREE');
    await closeParty(party);
  });
});
