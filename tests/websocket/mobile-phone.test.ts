import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClientState, SocketLike } from '@quizparty/controller-client';
import { defaultStake } from '@quizparty/controller-client';
import { parseServerMessage } from '@quizparty/protocol';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import { resolveAppConfig } from '../../apps/mobile/src/core/config';
import { parseAppLink } from '../../apps/mobile/src/core/links';
import {
  PurchaseFlow,
  type PurchaseProvider,
  type StorePurchase,
} from '../../apps/mobile/src/core/purchases';
import { createAppRuntime, type AppRuntime } from '../../apps/mobile/src/core/runtime';
import { bannerKind } from '../../apps/mobile/src/core/banner';
import { GOOGLE_PRODUCT } from '../helpers/google-store';
import { makeGameClient, memoryStorage, type MemoryStorage } from '../helpers/game-client';
import { startShop, type Shop } from '../helpers/payments';
import { FAST_GAME_CONFIG } from '../helpers/server';
import { waitUntil } from '../helpers/wait';

/**
 * The phone app without a phone: the app's own runtime (`createAppRuntime`, the same object the
 * Expo app builds) driven against the real realtime server over real sockets. React Native's
 * WebSocket sends no Origin header, so these sockets don't either. What cannot be shown here
 * (haptics, store sheets, deep-link association, push) is listed in docs/MOBILE.md.
 */
let shop: Shop;
const mailbox = new MemoryEmailSender();
const GAME = {
  ...FAST_GAME_CONFIG,
  defaultRounds: 3,
  timings: {
    ...FAST_GAME_CONFIG.timings,
    riskPickMs: 1500,
    sabotagePickMs: 1500,
    riskPickDecisionMs: 1500,
    answerMs: { STANDARD: 3000, SPEED: 3000, RISK: 3000, CROWD: 3000, FINAL: 3000 },
  },
};

beforeAll(async () => {
  shop = await startShop(
    { DEFAULT_ROOM_TIER: 'FREE', GAME_CONFIG_OVERRIDE: JSON.stringify(GAME) },
    { emailSender: mailbox },
  );
});
afterAll(async () => {
  await shop.dispose();
});

interface Phone {
  runtime: AppRuntime;
  storage: MemoryStorage;
  sockets: WebSocket[];
  violations: string[];
  /** Every state the screens would have been rendered from. */
  seen: ClientState[];
}

/** A Store double that behaves like Play Billing: it records a purchase bound to the account token. */
function playStore(): PurchaseProvider & { held: StorePurchase[]; finished: string[] } {
  const held: StorePurchase[] = [];
  const finished: string[] = [];
  return {
    platform: 'ANDROID',
    held,
    finished,
    isAvailable: () => Promise.resolve(true),
    getProduct: (id) => Promise.resolve({ id, displayPrice: '$4.99', title: 'Full game' }),
    purchase(productId, accountToken) {
      const purchaseToken = `play-token-${randomUUID()}`;
      shop.google.purchases.set(purchaseToken, {
        orderId: `GPA.${Math.floor(Math.random() * 1e9)}`,
        purchaseState: 0,
        acknowledgementState: 0,
        obfuscatedExternalAccountId: accountToken,
        purchaseType: 0,
      });
      const purchase: StorePurchase = {
        claim: { platform: 'ANDROID', productId, purchaseToken },
        finish: () => {
          finished.push(purchaseToken);
          return Promise.resolve();
        },
      };
      held.push(purchase);
      return Promise.resolve(purchase);
    },
    restore: () => Promise.resolve([...held]),
  };
}

function phone(storage: MemoryStorage = memoryStorage(), provider = playStore()): Phone {
  const sockets: WebSocket[] = [];
  const violations: string[] = [];
  const seen: ClientState[] = [];
  const server = shop.server;
  const runtime = createAppRuntime({
    config: resolveAppConfig(
      {
        apiUrl: server.httpUrl,
        wsUrl: server.wsUrl,
        webUrl: 'https://quiz.example.com',
        productId: GOOGLE_PRODUCT,
      },
      'test',
    ),
    platform: 'ANDROID',
    storage,
    socketFactory: (url) => {
      const socket = new WebSocket(url); // no Origin header, like React Native
      sockets.push(socket);
      return socket as unknown as SocketLike;
    },
    fetch: async (url, init) => {
      const response = await fetch(url, init);
      return { ok: response.ok, status: response.status, json: () => response.json() };
    },
    purchaseProvider: provider,
    backoffMs: [40, 80],
  });
  runtime.client.parse = (raw) => {
    const result = parseServerMessage(raw);
    if (result.ok) return result.value;
    violations.push(result.error);
    return null;
  };
  runtime.client.store.subscribe(() => seen.push(runtime.client.state));
  return { runtime, storage, sockets, violations, seen };
}

/** What the screens do on their own: commit a safe prep, tap the first option. */
function play(p: Phone, pick = 0): () => void {
  const { client } = p.runtime;
  let answered: string | null = null;
  let prepped = -1;
  let passed = -1;
  return client.store.subscribe(() => {
    const room = client.state.room;
    const data = room?.phaseData;
    if (!room || !data) return;
    if (data.phase === 'RISK_PICK' && !room.you?.commitment && prepped !== data.round.index) {
      prepped = data.round.index;
      void client
        .commitRisk({ stake: defaultStake(data), doubleDown: false })
        .catch(() => undefined);
    }
    if (
      data.phase === 'SABOTAGE_PICK' &&
      !room.you?.sabotage?.decided &&
      passed !== data.round.index
    ) {
      passed = data.round.index;
      void client.commitSabotage({ sabotage: null }).catch(() => undefined);
    }
    if (data.phase === 'ANSWERING' && !room.you?.answer && answered !== data.questionId) {
      answered = data.questionId;
      const option = data.options[pick % data.options.length];
      if (option) void client.submitAnswer(option.optionId).catch(() => undefined);
    }
  });
}

async function tv() {
  const display = makeGameClient(shop.server, { kind: 'DISPLAY' });
  const created = await display.client.createRoom('tr');
  await display.waitFor((s) => s.transport === 'ONLINE' && s.room !== null, 5_000, 'TV online');
  return { display, code: created.code };
}

describe('phone flow: join, prep, answer, results', () => {
  it('plays a whole game through the app runtime and ends with consistent results', async () => {
    const { display, code } = await tv();
    const a = phone();
    const b = phone();
    await a.runtime.client.join(code, 'Ece', 'fox');
    await b.runtime.client.join(code, 'Deniz', 'panda');
    expect(a.runtime.client.state.room?.players.map((p) => p.nickname)).toEqual(['Ece', 'Deniz']);
    expect(a.runtime.client.state.room?.you?.isLeader).toBe(true);
    expect(bannerKind(a.runtime.client.state, false)).toBeNull();

    const stops = [play(a, 0), play(b, 1)];
    await a.runtime.client.startGame();
    await Promise.all(
      [a, b].map((p) =>
        p.runtime.client.store.get().room?.phase === 'RESULTS'
          ? Promise.resolve()
          : waitUntil(() => p.runtime.client.state.room?.phase === 'RESULTS', 25_000, 'RESULTS'),
      ),
    );

    const rankings = [a, b].map((p) => {
      const data = p.runtime.client.state.room?.phaseData;
      if (data?.phase !== 'RESULTS') throw new Error('not in RESULTS');
      return data.ranking;
    });
    expect(rankings[0]).toEqual(rankings[1]);
    expect(rankings[0]).toHaveLength(2);

    // Every phone answered every question exactly like the screens would have.
    for (const p of [a, b]) {
      const answered = p.seen.filter((s) => s.room?.you?.answer).length;
      expect(answered).toBeGreaterThan(0);
      expect(p.violations).toEqual([]);
    }

    // Privacy: before REVEAL a phone never holds the correct option (ADR-0008).
    for (const p of [a, b])
      for (const state of p.seen) {
        const phase = state.room?.phase;
        if (
          phase === 'ANSWERING' ||
          phase === 'QUESTION' ||
          phase === 'LOCKED' ||
          phase === 'RISK_PICK' ||
          phase === 'SABOTAGE_PICK'
        )
          expect(JSON.stringify(state.room?.phaseData)).not.toContain('correctOptionId');
      }

    stops.forEach((stop) => stop());
    a.runtime.client.suspend();
    b.runtime.client.suspend();
    display.client.suspend();
  });

  it('shows the reconnect banner on a dropped socket and restores the seat with a rotated token', async () => {
    const { display, code } = await tv();
    const a = phone();
    const b = phone();
    await a.runtime.client.join(code, 'Ece', 'fox');
    await b.runtime.client.join(code, 'Deniz', 'panda');
    const before = (
      JSON.parse(a.storage.data.get(`qp.player.${code}`) ?? '{}') as { token: string }
    ).token;
    const stops = [play(a), play(b)];
    await a.runtime.client.startGame();
    await waitUntil(() => a.runtime.client.state.room?.phase === 'ANSWERING', 10_000, 'ANSWERING');

    a.sockets.at(-1)?.terminate();
    await waitUntil(
      () => a.seen.some((s) => bannerKind(s, false) === 'RECONNECTING'),
      5_000,
      'reconnect banner state',
    );
    await waitUntil(() => a.runtime.client.state.restoredAt !== null, 8_000, 'restored');
    expect(bannerKind(a.runtime.client.state, true)).toBe('RESTORED');
    const after = (JSON.parse(a.storage.data.get(`qp.player.${code}`) ?? '{}') as { token: string })
      .token;
    expect(after).not.toBe(before);

    await waitUntil(() => a.runtime.client.state.room?.phase === 'RESULTS', 25_000, 'RESULTS');
    expect(a.violations).toEqual([]);
    stops.forEach((stop) => stop());
    for (const p of [a, b]) p.runtime.client.suspend();
    display.client.suspend();
  });

  it('resumes the same seat after an app restart (new runtime, same secure storage)', async () => {
    const { display, code } = await tv();
    const a = phone();
    await a.runtime.client.join(code, 'Ece', 'fox');
    const playerId = a.runtime.client.state.session?.playerId;
    a.runtime.client.suspend();

    const restarted = phone(a.storage);
    await expect(restarted.runtime.client.resume('PLAYER', code)).resolves.toBe(true);
    await waitUntil(
      () => restarted.runtime.client.state.room !== null,
      5_000,
      'room after restart',
    );
    expect(restarted.runtime.client.state.session?.playerId).toBe(playerId);
    expect(restarted.runtime.client.state.room?.players).toHaveLength(1);
    restarted.runtime.client.suspend();
    display.client.suspend();
  });

  it('refuses a duplicate nickname and an unknown room with codes the screens map to copy', async () => {
    const { display, code } = await tv();
    const a = phone();
    const b = phone();
    await a.runtime.client.join(code, 'Ece', 'fox');
    await expect(b.runtime.client.join(code, 'ece', 'cat')).rejects.toMatchObject({
      code: 'NICKNAME_TAKEN',
    });
    await expect(b.runtime.client.preview('ZZZZZZ')).resolves.toBeNull();
    const preview = await b.runtime.client.preview(code);
    expect(preview).toMatchObject({ joinable: true, playerCount: 1 });
    a.runtime.client.suspend();
    display.client.suspend();
  });
});

describe('deep links open the same join path', () => {
  it('a code from quiznight:// and an https /j/ link both name a room the app can join', async () => {
    const { display, code } = await tv();
    const hosts = ['quiz.example.com'];
    for (const url of [
      `quiznight://join/${code}`,
      `https://quiz.example.com/j/${code.toLowerCase()}`,
    ]) {
      const link = parseAppLink(url, hosts);
      expect(link).toEqual({ kind: 'JOIN', roomCode: code });
    }
    const p = phone();
    await p.runtime.client.join(code, 'Link', 'owl');
    expect(p.runtime.client.state.room?.code).toBe(code);
    p.runtime.client.suspend();
    display.client.suspend();
  });
});

describe('account, purchase and TV unlock through the app runtime', () => {
  async function signIn(p: Phone, email: string): Promise<void> {
    await p.runtime.auth.requestCode(email, 'tr');
    await waitUntil(() => mailbox.lastCode(email) !== null, 3_000, 'sign-in mail');
    await p.runtime.auth.verifyCode(email, mailbox.lastCode(email)!);
  }

  it('signs in by email code as a MOBILE session, buys, and the TV room unlocks without a refresh', async () => {
    const { display, code } = await tv();
    expect(display.client.state.room?.tier).toBe('FREE');
    const owner = phone();
    await owner.runtime.client.join(code, 'Owner', 'owl'); // the TV leaves WAITING once someone is in
    await signIn(owner, 'owner@example.com');
    expect(owner.runtime.auth.state.account?.sessionKind).toBe('MOBILE');
    expect(owner.storage.data.get('qp.account.token')).toBeTruthy();

    // Flow A: the TV shows a QR; the phone opens it, buys, claims.
    const link = await display.client.requestUnlockLink();
    const target = parseAppLink(`quiznight://unlock/${link.url.split('/unlock/')[1]}`, []);
    expect(target?.kind).toBe('UNLOCK');
    await owner.runtime.purchases.load();
    expect(owner.runtime.purchases.store.get()).toMatchObject({
      tier: 'FREE',
      storeAvailable: true,
    });
    await owner.runtime.purchases.buy();
    expect(owner.runtime.purchases.store.get()).toMatchObject({ status: 'OWNED', tier: 'FULL' });
    expect(shop.google.acknowledged.length).toBeGreaterThan(0); // the server acknowledged it
    const claimed = await owner.runtime.api.claimLink((target as { intentId: string }).intentId);
    expect(claimed).toMatchObject({ tier: 'FULL', roomCode: code });
    await display.waitFor((s) => s.room?.tier === 'FULL', 5_000, 'TV unlocked');
    expect(display.client.state.entitlement?.tier).toBe('FULL');
    display.client.suspend();
  });

  it('restores on a second device and refuses a purchase bound to someone else', async () => {
    const store = playStore();
    const first = phone(memoryStorage(), store);
    await signIn(first, 'first@example.com');
    await first.runtime.purchases.buy();

    // Same account, new device: the store still lists the purchase, restore re-verifies it.
    // (a second sign-in code would hit the 30 s resend cooldown, so the session is issued directly)
    const second = phone(memoryStorage(), store);
    const accountId = first.runtime.auth.state.account!.id;
    const session = await shop.server.built.accountSessions.create(accountId, 'MOBILE', {
      ipHash: 'test',
      userAgentHash: null,
    });
    second.storage.data.set('qp.account.token', session.token);
    await second.runtime.auth.restore();
    expect(second.runtime.auth.state.status).toBe('SIGNED_IN');
    await expect(second.runtime.purchases.restore()).resolves.toBe('RESTORED');
    expect(second.runtime.purchases.store.get().tier).toBe('FULL');

    // Another account presenting that same store transaction gets nothing (ADR-0013 binding).
    const thief = phone(memoryStorage(), store);
    await signIn(thief, 'thief@example.com');
    await expect(thief.runtime.purchases.restore()).resolves.toBe('NOTHING');
    expect(thief.runtime.purchases.store.get().tier).toBe('FREE');
  });

  it('crash recovery: an unfinished transaction is settled on the next launch', async () => {
    const store = playStore();
    const p = phone(memoryStorage(), store);
    await signIn(p, 'crash@example.com');
    const { storeAccountToken } = await p.runtime.api.entitlements();
    await store.purchase(shop.google ? GOOGLE_PRODUCT : '', storeAccountToken); // the app dies right after paying
    expect(store.finished).toEqual([]);
    const relaunched = new PurchaseFlow({
      provider: store,
      api: p.runtime.api,
      productId: GOOGLE_PRODUCT,
      signedIn: () => true,
    });
    await relaunched.recover();
    expect(relaunched.store.get().tier).toBe('FULL');
    expect(store.finished).toHaveLength(1);
  });

  it('exports and deletes the account; the token stops working', async () => {
    const p = phone();
    await signIn(p, 'bye@example.com');
    const exported = await p.runtime.api.exportData();
    expect(JSON.stringify(exported)).toContain('bye@example.com');
    await p.runtime.api.deleteAccount();
    await expect(p.runtime.api.me()).rejects.toMatchObject({ status: 401 });
    // The 401 made the store forget the session.
    await waitUntil(() => p.runtime.auth.state.status === 'SIGNED_OUT', 2_000, 'signed out');
  });

  it('rejects a wrong sign-in code without revealing anything', async () => {
    const p = phone();
    await p.runtime.auth.requestCode('wrong@example.com', 'tr');
    await expect(p.runtime.auth.verifyCode('wrong@example.com', '000000')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(p.storage.data.has('qp.account.token')).toBe(false);
  });
});
