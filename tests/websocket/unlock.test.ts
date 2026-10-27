import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appleNotification, appleTransaction } from '../helpers/apple-store';
import { staff } from '../helpers/admin';
import { closeParty, createParty } from '../helpers/party';
import { call, player, startShop, type Player, type Shop } from '../helpers/payments';
import { waitUntil } from '../helpers/wait';

/**
 * Unlocking a TV room from a phone owner's purchase (ADR-0013 flows A and B), over real sockets:
 * the display asks for a link, an account claims it, and every screen learns the new tier without
 * reloading. Rooms start FREE, as in production.
 */
let shop: Shop;
beforeAll(async () => {
  shop = await startShop({ DEFAULT_ROOM_TIER: 'FREE' });
});
afterAll(async () => {
  await shop.dispose();
});
const server = () => shop.server;

const tokenOf = (url: string): string => url.split('/unlock/')[1]!;
const claim = (who: { token: string } | null, token: string) =>
  call<{ tier?: string; roomCode?: string; error?: { code: string } }>(
    server(),
    'POST',
    `/v1/link-intents/${token}/claim`,
    { ...(who ? { token: who.token } : {}), body: {} },
  );

async function buy(buyer: Player): Promise<string> {
  const tx = appleTransaction(buyer.storeToken);
  const result = await call(server(), 'POST', '/v1/purchases/verify', {
    token: buyer.token,
    body: { platform: 'IOS', signedTransaction: shop.apple.sign(tx) },
  });
  expect(result.status).toBe(200);
  return JSON.stringify(tx);
}

describe('asking for the unlock link', () => {
  it('gives the display a one-time link, stores only a hash, and tells nobody else', async () => {
    const party = await createParty(server(), 2);
    const id = party.display.send('REQUEST_UNLOCK_LINK', {});
    const link = await party.display.nextOfType('UNLOCK_LINK');
    expect(link.payload.url).toMatch(/^http:\/\/localhost:5173\/unlock\/[A-Za-z0-9_-]{22}$/u);
    expect(link.payload.expiresAt).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(link.payload.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000);
    await party.display.next((m) => m.type === 'ACK' && m.payload.messageId === id);

    const stored = JSON.stringify(
      await server().db.db.selectFrom('link_intents').selectAll().execute(),
    );
    expect(stored).not.toContain(tokenOf(link.payload.url));
    await party.leader.idle(150);
    for (const client of party.players)
      expect(client.drain().some((m) => m.type === 'UNLOCK_LINK')).toBe(false);
    await closeParty(party);
  });

  it('is for the display only, only in the lobby or results, only while the room is FREE, and capped', async () => {
    const party = await createParty(server(), 2);
    const asked = party.leader.send('REQUEST_UNLOCK_LINK', {});
    const refused = await party.leader.next(
      (m) => m.type === 'ERROR' && m.payload.messageId === asked,
    );
    expect(refused.type === 'ERROR' && refused.payload.code).toBe('FORBIDDEN');

    for (let i = 0; i < 5; i += 1) {
      party.display.send('REQUEST_UNLOCK_LINK', {});
      await party.display.nextOfType('UNLOCK_LINK');
    }
    const sixth = party.display.send('REQUEST_UNLOCK_LINK', {});
    const capped = await party.display.next(
      (m) => m.type === 'ERROR' && m.payload.messageId === sixth,
    );
    expect(capped.type === 'ERROR' && capped.payload.code).toBe('RATE_LIMITED');
    await closeParty(party);
  });

  it('is still available once the room is FULL (the same link attaches a personal quiz)', async () => {
    const party = await createParty(server(), 2);
    party.display.send('REQUEST_UNLOCK_LINK', {});
    const link = await party.display.nextOfType('UNLOCK_LINK');
    const buyer = await player(server());
    await buy(buyer);
    expect((await claim(buyer, tokenOf(link.payload.url))).body.tier).toBe('FULL');
    party.display.send('REQUEST_UNLOCK_LINK', {});
    expect((await party.display.nextOfType('UNLOCK_LINK')).payload.url).toMatch(/\/unlock\//u);
    await closeParty(party);
  });
});

describe('claiming a link', () => {
  it('unlocks the room for every screen at once when the account owns the game, and only once', async () => {
    const party = await createParty(server(), 2);
    expect(party.created.tier).toBe('FREE');
    party.display.send('REQUEST_UNLOCK_LINK', {});
    const { url } = (await party.display.nextOfType('UNLOCK_LINK')).payload;
    const buyer = await player(server());
    await buy(buyer);

    expect(await claim(buyer, tokenOf(url))).toMatchObject({
      status: 200,
      body: { tier: 'FULL', roomCode: party.created.code },
    });
    for (const client of [party.display, ...party.players]) {
      const changed = await client.nextOfType('ENTITLEMENT_CHANGED');
      expect(changed.payload).toEqual({ tier: 'FULL', reason: 'LINKED' });
    }
    expect(server().built.manager.getByCode(party.created.code)!.state.tier).toBe('FULL');
    await waitUntil(
      async () => {
        const row = await server()
          .db.db.selectFrom('rooms')
          .select(['tier', 'host_account_id'])
          .where('id', '=', party.created.roomId)
          .executeTakeFirstOrThrow();
        return row.tier === 'FULL' && row.host_account_id === buyer.accountId;
      },
      5000,
      'room row follows',
    );

    // the link now belongs to the account that used it: that account may use it again (a second action
    // at the same TV), nobody else may, and the answer for everyone else says nothing about why
    const other = await player(server());
    await buy(other);
    expect(await claim(buyer, tokenOf(url))).toMatchObject({ status: 200, body: { tier: 'FULL' } });
    expect(await claim(other, tokenOf(url))).toMatchObject({ status: 404 });
    await closeParty(party);
  });

  it('answers the same 404 for unknown, malformed, expired and closed-room links', async () => {
    const buyer = await player(server());
    await buy(buyer);
    const party = await createParty(server(), 1);
    party.display.send('REQUEST_UNLOCK_LINK', {});
    const expired = tokenOf((await party.display.nextOfType('UNLOCK_LINK')).payload.url);
    await server()
      .db.db.updateTable('link_intents')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('room_id', '=', party.created.roomId)
      .execute();
    // the expired link is still a row (nothing asked for a new one yet): expiry itself is what refuses it
    expect(
      (
        await server()
          .db.db.selectFrom('link_intents')
          .select('id')
          .where('room_id', '=', party.created.roomId)
          .execute()
      ).length,
    ).toBe(1);

    const gone = await createParty(server(), 1);
    gone.display.send('REQUEST_UNLOCK_LINK', {});
    const closedLink = tokenOf((await gone.display.nextOfType('UNLOCK_LINK')).payload.url);
    gone.display.send('END_ROOM', {});
    await waitUntil(
      () => server().built.manager.getByCode(gone.created.code) === undefined,
      5000,
      'room gone',
    );

    const bodies = new Set<string>();
    for (const token of [
      expired,
      closedLink,
      'A'.repeat(22),
      'short',
      '../../etc/passwd',
      "x'; DROP TABLE link_intents; --",
    ]) {
      const result = await call(
        server(),
        'POST',
        `/v1/link-intents/${encodeURIComponent(token)}/claim`,
        {
          token: buyer.token,
          body: {},
        },
      );
      expect(result.status, token).toBe(404);
      bodies.add(JSON.stringify(result.body));
    }
    expect(bodies.size).toBe(1);
    expect(
      (await server().db.db.selectFrom('link_intents').select('id').execute()).length,
    ).toBeGreaterThan(0);
    await closeParty(party);
    await closeParty(gone);
  });

  it('needs a player sign-in', async () => {
    expect((await claim(null, 'A'.repeat(22))).status).toBe(401);
    const admin = await staff(server(), ['ADMIN']);
    expect((await claim(admin, 'A'.repeat(22))).status).toBe(403);
  });

  it('links an account that does not own the game yet, and unlocks the same room when it buys', async () => {
    const party = await createParty(server(), 2);
    party.display.send('REQUEST_UNLOCK_LINK', {});
    const { url } = (await party.display.nextOfType('UNLOCK_LINK')).payload;
    const hopeful = await player(server());
    expect(await claim(hopeful, tokenOf(url))).toMatchObject({
      status: 200,
      body: { tier: 'FREE' },
    });
    await waitUntil(
      () =>
        server().built.manager.getByCode(party.created.code)!.hostAccountId() === hopeful.accountId,
      5000,
      'account linked',
    );
    expect(server().built.manager.getByCode(party.created.code)!.state.tier).toBe('FREE');

    // somebody else who also lacks the game cannot take the link over
    party.display.send('REQUEST_UNLOCK_LINK', {});
    const second = (await party.display.nextOfType('UNLOCK_LINK')).payload.url;
    const stranger = await player(server());
    await claim(stranger, tokenOf(second));
    expect(server().built.manager.getByCode(party.created.code)!.hostAccountId()).toBe(
      hopeful.accountId,
    );

    // the purchase completes on the phone: the TV unlocks without scanning again
    await buy(hopeful);
    for (const client of [party.display, ...party.players]) {
      const changed = await client.next(
        (m) => m.type === 'ENTITLEMENT_CHANGED' && m.payload.tier === 'FULL',
      );
      expect(changed.type === 'ENTITLEMENT_CHANGED' && changed.payload.reason).toBe('GRANTED');
    }
    await closeParty(party);
  });

  it('tells every screen when the purchase is refunded, without interrupting the running game', async () => {
    const party = await createParty(server(), 2);
    party.display.send('REQUEST_UNLOCK_LINK', {});
    const { url } = (await party.display.nextOfType('UNLOCK_LINK')).payload;
    const buyer = await player(server());
    const tx = appleTransaction(buyer.storeToken);
    await call(server(), 'POST', '/v1/purchases/verify', {
      token: buyer.token,
      body: { platform: 'IOS', signedTransaction: shop.apple.sign(tx) },
    });
    await claim(buyer, tokenOf(url));
    await party.leader.nextOfType('ENTITLEMENT_CHANGED');

    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    await party.leader.waitForPhase('ROUND_INTRO', 10_000);

    const refund = appleNotification(shop.apple, 'REFUND', tx);
    const hook = await call(server(), 'POST', '/v1/webhooks/apple', {
      body: { signedPayload: refund.signedPayload },
    });
    expect(hook.status).toBe(200);
    for (const client of [party.display, ...party.players]) {
      const changed = await client.next(
        (m) => m.type === 'ENTITLEMENT_CHANGED' && m.payload.tier === 'FREE',
      );
      expect(changed.type === 'ENTITLEMENT_CHANGED' && changed.payload.reason).toBe('REVOKED');
    }
    // the game goes on: the next phase still arrives
    await party.leader.next(
      (m) =>
        m.type === 'PHASE_ENTERED' &&
        (m.payload.data.phase === 'RISK_PICK' || m.payload.data.phase === 'QUESTION'),
      15_000,
      'the game carrying on after the refund',
    );
    await closeParty(party);
  });
});
