import { expect, test } from '@playwright/test';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import {
  appleTransaction,
  createAppleChain,
  APPLE_PRODUCT,
  BUNDLE_ID,
} from '../helpers/apple-store';
import { call } from '../helpers/payments';
import {
  PLAY_GAME_CONFIG,
  decodeQr,
  joinPhone,
  openLobby,
  phonePage,
  shot,
  startE2eServer,
  tvPage,
  type E2eServer,
} from './helpers';

/**
 * Unlocking a TV room from a phone, in real browsers: the TV (FREE) shows a QR code, the owner of the
 * full game scans it, signs in with an emailed code and the TV unlocks by itself. The purchase itself
 * is the store's job (verified in the integration tests); here the account already owns the game.
 */
const mailbox = new MemoryEmailSender();
const apple = createAppleChain('E2E');
let env: E2eServer;
test.beforeEach(async () => {
  env = await startE2eServer(
    PLAY_GAME_CONFIG,
    {
      DEFAULT_ROOM_TIER: 'FREE',
      PAYMENTS_ENABLED: '1',
      APPLE_BUNDLE_ID: BUNDLE_ID,
      APPLE_PRODUCT_ID: APPLE_PRODUCT,
      APPLE_ROOT_CERTS_PEM: apple.rootPem,
      APPLE_ONLINE_CHECKS: '0',
    },
    mailbox,
  );
});
test.afterEach(async () => {
  await env.server.dispose();
});

async function owner(email: string): Promise<void> {
  const account = (await env.server.built.accounts.signIn(email, 'tr'))!;
  const session = await env.server.built.accountSessions.create(account.id, 'MOBILE', {
    ipHash: 'e2e',
    userAgentHash: null,
  });
  const storeToken = (await env.server.built.entitlements.storeAccountToken(account.id))!;
  const bought = await call(env.server, 'POST', '/v1/purchases/verify', {
    token: session.token,
    body: { platform: 'IOS', signedTransaction: apple.sign(appleTransaction(storeToken)) },
  });
  expect(bought.status).toBe(200);
}

test('the TV shows a QR code, the owner scans it and signs in, and the room unlocks by itself', async ({
  browser,
}) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const friend = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  await expect(tv.page.getByTestId('lobby-unlock')).toBeVisible();

  await tv.page.getByTestId('lobby-unlock').click();
  await expect(tv.page.getByTestId('unlock-qr').locator('svg')).toBeVisible();
  await shot(tv.page, 'tv-unlock');
  const link = decodeQr(await tv.page.getByTestId('unlock-qr').screenshot());
  expect(link).toMatch(new RegExp(`^${env.url}/unlock/[A-Za-z0-9_-]{22}$`, 'u'));

  await owner('owner@example.test');
  const phone = await phonePage(browser);
  await phone.page.goto(link!);
  await phone.page.getByTestId('unlock-email').fill('owner@example.test');
  await phone.page.getByTestId('unlock-send').click();
  await phone.page.getByTestId('unlock-code').waitFor();
  await expect.poll(() => mailbox.lastCode('owner@example.test')).not.toBeNull();
  await phone.page.getByTestId('unlock-code').fill(mailbox.lastCode('owner@example.test')!);
  await phone.page.getByTestId('unlock-verify').click();
  await phone.page.getByTestId('unlock-claim').waitFor();
  await shot(phone.page, 'phone-unlock');
  await phone.page.getByTestId('unlock-claim').click();
  await expect(phone.page.getByTestId('unlock-result')).toHaveAttribute('data-tier', 'FULL');

  // The TV and the other phone learned it without reloading; the unlock button is gone.
  await expect(tv.page.getByTestId('tv-unlock')).toContainText(/açıldı/u);
  await expect(tv.page.getByTestId('tv-unlock')).toHaveCount(0, { timeout: 8000 });
  await expect(tv.page.getByTestId('lobby-unlock')).toHaveCount(0);
  expect(env.server.built.manager.getByCode(code)!.state.tier).toBe('FULL');
  await expect(friend.page.getByTestId('ctl-lobby')).toBeVisible();

  // The link now belongs to this account: another tab of the signed-in phone can still use it, and
  // the integration tests prove nobody else can.
  const again = await phone.context.newPage();
  await again.goto(link!);
  await expect(again.getByTestId('unlock-claim')).toBeVisible();
  await expect(again.getByTestId('unlock-dead')).toHaveCount(0);

  for (const screen of [tv, friend, phone]) await screen.context.close();
});
