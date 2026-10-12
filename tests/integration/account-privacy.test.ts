import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appleTransaction } from '../helpers/apple-store';
import { staff } from '../helpers/admin';
import { call, player, startShop, type Player, type Shop } from '../helpers/payments';
import { createRoom } from '../helpers/server';

/** ADR-0018 data-subject rights: a copy of what we hold, and deletion that really lets go. */
let shop: Shop;
beforeAll(async () => {
  shop = await startShop({ DEFAULT_ROOM_TIER: 'FREE' });
});
afterAll(async () => {
  await shop.dispose();
});
const server = () => shop.server;

async function buyer(): Promise<{ who: Player; jws: string }> {
  const who = await player(server());
  const jws = shop.apple.sign(appleTransaction(who.storeToken));
  const bought = await call(server(), 'POST', '/v1/purchases/verify', {
    token: who.token,
    body: { platform: 'IOS', signedTransaction: jws },
  });
  expect(bought.status).toBe(200);
  return { who, jws };
}
const remove = (token: string | undefined, ...rest: [body?: unknown]) =>
  call(server(), 'DELETE', '/v1/me', {
    ...(token ? { token } : {}),
    ...(rest.length === 0
      ? { body: { confirm: 'DELETE' } }
      : rest[0] === undefined
        ? {}
        : { body: rest[0] }),
  });

describe('exporting an account', () => {
  it('hands the person what we hold about them, and none of our secrets', async () => {
    const { who } = await buyer();
    const result = await call<{
      account: unknown;
      purchases: unknown[];
      entitlements: unknown[];
      sessions: unknown[];
    }>(server(), 'GET', '/v1/me/export', {
      token: who.token,
    });
    expect(result.status).toBe(200);
    const text = JSON.stringify(result.body);
    expect(result.body.account).toMatchObject({ id: who.accountId, email: who.email });
    expect(result.body.purchases).toEqual([
      expect.objectContaining({ platform: 'IOS', status: 'VERIFIED', environment: 'SANDBOX' }),
    ]);
    expect(result.body.entitlements).toEqual([expect.objectContaining({ status: 'ACTIVE' })]);
    expect(result.body.sessions).toHaveLength(1);
    for (const secret of [
      who.token,
      who.storeToken,
      'token_hash',
      'ip_hash',
      'user_agent',
      'store_account_token',
    ])
      expect(text, secret).not.toContain(secret);
  });

  it('needs a sign-in', async () => {
    expect((await call(server(), 'GET', '/v1/me/export')).status).toBe(401);
  });
});

describe('deleting an account', () => {
  it('asks for an explicit confirmation and for nothing else', async () => {
    const { who } = await buyer();
    for (const body of [undefined, {}, { confirm: 'yes' }, { confirm: 'DELETE', also: 1 }])
      expect((await remove(who.token, body)).status).toBe(400);
    expect((await call(server(), 'GET', '/v1/me', { token: who.token })).status).toBe(200);
    expect((await remove(undefined)).status).toBe(401);
  });

  it('lets go of the address, every sign-in and the entitlement, but keeps the purchase record without the person', async () => {
    const { who, jws } = await buyer();
    const created = await createRoom(server());
    const room = server().built.manager.get(created.roomId)!;
    await room.applyEntitlement('FULL', who.accountId, 'LINKED');
    expect(room.tier()).toBe('FULL');

    expect((await remove(who.token)).status).toBe(200);

    expect((await call(server(), 'GET', '/v1/me', { token: who.token })).status).toBe(401);
    const row = await server()
      .db.db.selectFrom('accounts')
      .selectAll()
      .where('id', '=', who.accountId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      email: null,
      display_name: null,
      status: 'DELETED',
    });
    expect(row.deleted_at).not.toBeNull();
    expect(row.store_account_token).not.toBe(who.storeToken);
    expect(
      await server()
        .db.db.selectFrom('entitlements')
        .select('id')
        .where('account_id', '=', who.accountId)
        .execute(),
    ).toEqual([]);
    const kept = await server()
      .db.db.selectFrom('purchase_transactions')
      .select(['account_id', 'former_account_ref', 'status'])
      .where('former_account_ref', 'is not', null)
      .execute();
    expect(kept.some((p) => p.account_id === null && p.status === 'VERIFIED')).toBe(true);
    expect(JSON.stringify(kept)).not.toContain(who.accountId);
    expect(
      await server()
        .db.db.selectFrom('account_sessions')
        .select('revoked_at')
        .where('account_id', '=', who.accountId)
        .execute(),
    ).toEqual([{ revoked_at: expect.any(Date) as Date }]);

    // the TV room that this purchase had unlocked falls back to FREE and forgets the account
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(room.tier()).toBe('FREE');
    expect(room.hostAccountId()).toBeNull();

    // signing in with the same address starts a fresh account that owns nothing, and the old receipt cannot be claimed
    const again = await player(server());
    expect(again.accountId).not.toBe(who.accountId);
    expect(
      (
        await call(server(), 'POST', '/v1/purchases/verify', {
          token: again.token,
          body: { platform: 'IOS', signedTransaction: jws },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call<{ tier: string }>(server(), 'GET', '/v1/entitlements', { token: again.token }))
        .body.tier,
    ).toBe('FREE');
  });

  it('forgets the sign-in codes issued for the address, so the address can start over at once', async () => {
    const mail = `forget-${Date.now()}@example.com`;
    const account = (await server().built.accounts.signIn(mail, 'tr'))!;
    const session = await server().built.accountSessions.create(account.id, 'WEB', {
      ipHash: 'x',
      userAgentHash: null,
    });
    const requested = await call(server(), 'POST', '/v1/auth/email/request', {
      body: { email: mail },
    });
    expect(requested.status).toBe(202);
    expect(
      (await server().db.db.selectFrom('email_otps').select('id').execute()).length,
    ).toBeGreaterThan(0);
    const before = (await server().db.db.selectFrom('email_otps').select('id').execute()).length;
    expect((await remove(session.token)).status).toBe(200);
    const after = (await server().db.db.selectFrom('email_otps').select('id').execute()).length;
    expect(after).toBeLessThan(before);
  });

  it('refuses to delete a member of staff (an administrator demotes them first) and keeps working for them', async () => {
    const admin = await staff(server(), ['ADMIN'], 'WEB');
    expect((await remove(admin.token)).status).toBe(409);
    expect((await call(server(), 'GET', '/v1/me', { token: admin.token })).status).toBe(200);
  });

  it('cannot be done by anyone else: only the signed-in account is ever touched', async () => {
    const mine = await player(server());
    const theirs = await player(server());
    expect((await remove(mine.token)).status).toBe(200);
    expect((await call(server(), 'GET', '/v1/me', { token: theirs.token })).status).toBe(200);
    expect((await remove(mine.token)).status).toBe(401); // already gone
  });
});

describe('signing out everywhere', () => {
  it('ends every session of the account, this one included', async () => {
    const me = await player(server());
    const other = await server().built.accountSessions.create(me.accountId, 'WEB', {
      ipHash: 'x',
      userAgentHash: null,
    });
    expect((await call(server(), 'DELETE', '/v1/me/sessions', { token: me.token })).status).toBe(
      200,
    );
    expect((await call(server(), 'GET', '/v1/me', { token: me.token })).status).toBe(401);
    expect((await call(server(), 'GET', '/v1/me', { token: other.token })).status).toBe(401);
  });
});
