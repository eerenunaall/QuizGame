import { expect, test } from '@playwright/test';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import {
  appleTransaction,
  createAppleChain,
  APPLE_PRODUCT,
  BUNDLE_ID,
} from '../helpers/apple-store';
import { call } from '../helpers/payments';
import { enablePersonalQuizzes } from '../helpers/quizzes';
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
 * A Blind Quiz end to end in real browsers (ADR-0015 + addendum): the creator builds it and sees
 * status only, the target answers from a second browser (the first consent claims the invite), a
 * third browser holding the same link is refused, and the finished quiz is attached to a TV room
 * through the unlock page. One signed-in creator context for the whole test (OTP cooldown).
 */
const mailbox = new MemoryEmailSender();
const SENTINEL = ['Kaptan Zorba', 'Lahmacun', 'Kayak yapmak'];
const DECOYS = ['Pilot Ayse', 'Manti', 'Yuruyus'];
const EMAIL = 'creator@example.test';
const TITLE = 'Ece hakkinda';
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
  await enablePersonalQuizzes(env.server);
});
test.afterEach(async () => {
  await env.server.dispose();
});

/** The creator's account already owns the full game (personal quizzes need a FULL room). */
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

test('create, invite, answer in another browser, claim holds, status only, attach to the TV', async ({
  browser,
}) => {
  await owner(EMAIL);
  // ── creator signs in once and builds the quiz ──
  const creator = await phonePage(browser);
  const page = creator.page;
  await page.goto(`${env.url}/quizzes`);
  await page.getByTestId('unlock-email').fill(EMAIL);
  await page.getByTestId('unlock-send').click();
  await page.getByTestId('unlock-code').waitFor();
  await expect.poll(() => mailbox.lastCode(EMAIL)).not.toBeNull();
  await page.getByTestId('unlock-code').fill(mailbox.lastCode(EMAIL)!);
  await page.getByTestId('unlock-verify').click();
  await page.getByTestId('quiz-title').fill(TITLE);
  await page.getByTestId('quiz-create').click();
  await page.getByTestId('quiz-editor').waitFor();
  const quizId = page.url().split('/quizzes/')[1]!;

  for (const key of ['dreamJob', 'dislikedFood', 'surprisingHobby'])
    await page.getByTestId(`catalog-${key}`).click();
  await expect(page.getByTestId('prompt-list').locator('li')).toHaveCount(3);
  await page.getByTestId('target-name').fill('Ece');
  await page.getByTestId('target-add').click();
  const invite = await page.getByTestId('invite-link').locator('input').inputValue();
  expect(invite).toMatch(new RegExp(`^${env.url}/blind/respond/[A-Za-z0-9_-]{43}$`, 'u'));

  // ── the target, in a second browser, consents (claims the link), answers and approves ──
  const target = await phonePage(browser);
  const tp = target.page;
  await tp.goto(invite);
  await tp.getByTestId('respond-agree').click();
  await tp.getByTestId('prompt-2').waitFor();
  for (let i = 0; i < 3; i += 1) {
    await tp.getByTestId(`answer-${i}`).fill(SENTINEL[i]!);
    await tp.getByTestId(`decoy-${i}-0`).fill(DECOYS[i]!);
    await tp.getByTestId(`save-${i}`).click();
    await tp.getByTestId(`approve-${i}`).click();
    await expect(tp.getByTestId(`prompt-${i}`).getByText(/Onaylandı/u)).toBeVisible();
  }
  // the suggest button only exists when the server says the feature is on (it is off here)
  await expect(tp.getByTestId('suggest-0')).toHaveCount(0);
  await shot(tp, 'respond-approved');

  // ── a third browser with the same link is refused, at the page and at the API ──
  const third = await phonePage(browser);
  const response = await third.context.request.get(
    invite.replace('/blind/respond/', '/v1/blind/respond/'),
  );
  expect(response.status()).toBe(403);
  await third.page.goto(invite);
  await expect(third.page.getByTestId('respond-claimed')).toBeVisible();
  await expect(third.page.getByTestId('respond-agree')).toHaveCount(0);
  await shot(third.page, 'respond-claimed');

  // ── the creator sees status only; a claimed invite cannot be rotated ──
  await page.reload();
  await expect(page.getByTestId('target-list')).toContainText(/Onaylandı|APPROVED/iu);
  const text = await page.content();
  for (const secret of [...SENTINEL, ...DECOYS]) expect(text).not.toContain(secret);
  await page.getByRole('button', { name: 'Yeni bağlantı' }).click();
  await expect(page.getByTestId('quiz-error')).toContainText(/Ece/u);
  await expect(page.getByTestId('invite-link')).toHaveCount(0);
  await shot(page, 'editor-rotate-refused');

  // ── attach the quiz to a room through the unlock page; the TV shows BLIND ──
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const friend = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  await expect(tv.page.getByTestId('lobby-unlock')).toBeVisible();
  await tv.page.getByTestId('lobby-unlock').click();
  await expect(tv.page.getByTestId('unlock-qr').locator('svg')).toBeVisible();
  const link = decodeQr(await tv.page.getByTestId('unlock-qr').screenshot());
  expect(link).toMatch(/\/unlock\//u);
  await page.goto(link!);
  await page.getByTestId(`attach-${quizId}`).click();
  await expect(page.getByTestId('unlock-attached')).toBeVisible();
  await expect(tv.page.getByTestId('lobby-mode')).toContainText(TITLE);
  expect(env.server.built.manager.getByCode(code)!.state.settings.mode).toBe('BLIND');

  for (const screen of [tv, friend, target, third, creator]) await screen.context.close();
});
