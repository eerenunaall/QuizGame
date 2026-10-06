import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { catalogs } from '@quizparty/i18n';
import {
  PLAY_GAME_CONFIG,
  decodeQr,
  joinPhone,
  openLobby,
  phonePage,
  startE2eServer,
  tvPage,
  type E2eServer,
  type Screen,
} from './helpers';

/**
 * Behaviour that only shows in a real browser: the QR a phone camera would read, page reloads,
 * dropped connections, the lobby controls and the TV remote. Every test gets its own server.
 */
let env: E2eServer;
test.beforeEach(async () => {
  env = await startE2eServer(PLAY_GAME_CONFIG);
});
test.afterEach(async () => {
  await env.server.dispose();
});

const answerIndexOf = (code: string): { correct: number; wrong: number } => {
  const question = env.server.built.manager.getByCode(code)!.state.game!.round!.question!;
  const correct = question.options.findIndex((option) => option.correct);
  return { correct, wrong: (correct + 1) % question.options.length };
};

async function closeAll(...screens: Screen[]): Promise<void> {
  for (const screen of screens) await screen.context.close();
}

test("the lobby QR code decodes to this room's join link", async ({ browser }) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  await expect(tv.page.getByTestId('lobby-qr').locator('svg')).toBeVisible();
  const png = await tv.page.getByTestId('lobby-qr').screenshot();
  expect(decodeQr(png)).toBe(`${env.url}/join/${code}`);
  await closeAll(tv);
});

test('a phone that reloads mid-question keeps its seat and its locked answer', async ({
  browser,
}) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  const ahmet = await joinPhone(browser, env.url, code, 'Ahmet', 'cool');
  await ece.page.getByTestId('ctl-start').click();
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
  await expect(ahmet.page.getByTestId('ctl-answering')).toBeVisible();

  const { correct } = answerIndexOf(code);
  await ece.page.locator(`[data-answer-index="${correct}"]`).click();
  await expect(ece.page.getByTestId('ctl-confirmed')).toBeVisible();

  await ece.page.reload();
  // Same seat, same locked answer: no join form, no second player on the TV.
  await expect(ece.page.getByTestId('ctl-confirmed')).toBeVisible();
  await expect(ece.page.getByTestId('phone-name')).toHaveText('Ece');
  await expect(ece.page.getByTestId('join-nickname')).toHaveCount(0);
  expect(Object.keys(env.server.built.manager.getByCode(code)!.state.players)).toHaveLength(2);
  await expect(tv.page.getByTestId('tv-status')).toContainText('1 / 2');

  // The game carries on and the reloaded phone is scored like everyone else.
  await ahmet.page.locator(`[data-answer-index="${correct}"]`).click();
  await expect(ece.page.getByTestId('ctl-outcome')).toHaveAttribute('data-outcome', 'CORRECT');
  await closeAll(ece, ahmet, tv);
});

test('the TV reloads in the middle of a game and picks the room back up', async ({ browser }) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  const ahmet = await joinPhone(browser, env.url, code, 'Ahmet', 'cool');
  await ece.page.getByTestId('ctl-start').click();
  await expect(tv.page.getByTestId('tv-options')).toBeVisible();

  await tv.page.reload();
  await expect(tv.page.getByTestId('tv-start')).toHaveCount(0);
  await expect(tv.page.getByTestId('room-code')).toHaveText(code);
  await expect(tv.page.getByTestId('tv-options')).toBeVisible();

  const { correct } = answerIndexOf(code);
  await ece.page.locator(`[data-answer-index="${correct}"]`).click();
  await ahmet.page.locator(`[data-answer-index="${correct}"]`).click();
  // Everyone answered: the reloaded TV follows the game into round 2 (the score screen itself is
  // only on for a moment with these test timings).
  await expect(tv.page.getByText('TUR 2 / 3')).toBeVisible();
  await expect(tv.page.getByTestId('tv-options')).toBeVisible();
  await closeAll(ece, ahmet, tv);
});

test('a dropped connection shows a banner, then the phone restores its state by itself', async ({
  browser,
}) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  const ahmet = await joinPhone(browser, env.url, code, 'Ahmet', 'cool');

  // From now on Ece's page talks to the server through a proxy that can cut the line.
  const proxy: { line: WebSocketRoute | null; refuse: number } = { line: null, refuse: 0 };
  await ece.page.routeWebSocket(/\/ws/u, (route) => {
    if (proxy.refuse > 0) {
      proxy.refuse -= 1;
      void route.close({ code: 1013 });
      return;
    }
    route.connectToServer();
    proxy.line = route;
  });
  await ece.page.reload(); // reconnects through the proxy
  await expect(ece.page.getByTestId('ctl-lobby')).toBeVisible();
  await expect.poll(() => proxy.line !== null).toBe(true);

  await ece.page.getByTestId('ctl-start').click();
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
  const { correct } = answerIndexOf(code);
  await ece.page.locator(`[data-answer-index="${correct}"]`).click();
  await expect(ece.page.getByTestId('ctl-confirmed')).toBeVisible();

  proxy.refuse = 2; // the next two reconnect attempts fail as well
  void proxy.line!.close({ code: 4000 });
  await expect(ece.page.getByTestId('net-reconnecting')).toBeVisible();
  await expect(ece.page.getByTestId('net-restored')).toBeVisible({ timeout: 20_000 });
  await expect(ece.page.getByTestId('net-reconnecting')).toHaveCount(0);
  // Nothing was lost: still the same seat, still locked in.
  await expect(ece.page.getByTestId('ctl-confirmed')).toBeVisible();
  await expect(ece.page.getByTestId('phone-name')).toHaveText('Ece');

  await ahmet.page.locator(`[data-answer-index="${correct}"]`).click();
  await expect(ece.page.getByTestId('ctl-outcome')).toHaveAttribute('data-outcome', 'CORRECT');
  await closeAll(ece, ahmet, tv);
});

test('the leader hands over leadership and removes a player from the lobby', async ({
  browser,
}) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  const ahmet = await joinPhone(browser, env.url, code, 'Ahmet', 'cool');
  const merve = await joinPhone(browser, env.url, code, 'Merve', 'frog');

  // Guests have no management controls.
  await expect(ahmet.page.getByTestId('ctl-start')).toHaveCount(0);
  await expect(ahmet.page.getByTestId('ctl-player-Merve')).toHaveCount(0);

  await ece.page.getByTestId('ctl-player-Ahmet').click();
  await expect(ece.page.getByTestId('ctl-manage')).toBeVisible();
  await ece.page.getByTestId('ctl-make-leader').click();
  await expect(ahmet.page.getByTestId('ctl-start')).toBeVisible();
  await expect(ece.page.getByTestId('ctl-start')).toHaveCount(0);

  // Removing needs a second, confirming tap.
  await ahmet.page.getByTestId('ctl-player-Merve').click();
  await ahmet.page.getByTestId('ctl-kick').click();
  await expect(ahmet.page.getByTestId('ctl-kick')).toContainText(
    catalogs.tr['ctl.lobby.kickConfirm'],
  );
  await expect(tv.page.getByTestId('lobby-players')).toContainText('Merve');
  await ahmet.page.getByTestId('ctl-kick').click();
  await expect(tv.page.getByTestId('lobby-players')).not.toContainText('Merve');
  await expect(merve.page.getByText(catalogs.tr['ctl.kicked'])).toBeVisible();
  await closeAll(ece, ahmet, merve, tv);
});

test('the free tier shows what is locked instead of failing silently', async ({ browser }) => {
  await env.server.dispose();
  env = await startE2eServer(PLAY_GAME_CONFIG, { DEFAULT_ROOM_TIER: 'FREE' });
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  await joinPhone(browser, env.url, code, 'Ahmet', 'cool');
  const phone = ece.page;

  await expect(phone.getByText(catalogs.tr['settings.freeHint'])).toBeVisible();
  for (const count of ['10', '15', '20'])
    await expect(phone.getByRole('button', { name: count, exact: true })).toBeDisabled();
  await expect(phone.getByRole('button', { name: '5', exact: true })).toBeEnabled();
  // Only the free category can be picked; the others are shown, but locked.
  const locked = phone.locator('button:disabled', { hasText: /Spor|Müzik|Sinema|Bilim/u });
  expect(await locked.count()).toBeGreaterThanOrEqual(3);
  await closeAll(ece, tv);
});

test('the TV settings dialog works with remote-control keys only', async ({ browser }) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  const page: Page = tv.page;

  await page.getByTestId('lobby-settings').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tv-settings')).toBeVisible();
  // The dialog opens with focus on "Tamam" and traps the arrow keys inside it.
  await expect(page.getByTestId('settings-done')).toBeFocused();

  await page.keyboard.press('ArrowUp'); // up from the done button lands on a control inside the dialog
  const focusedInside = await page.evaluate(() =>
    document.querySelector('[data-testid="tv-settings"]')?.contains(document.activeElement),
  );
  expect(focusedInside).toBe(true);

  // Pick "Zor" with the keyboard (the pill is in the dialog's difficulty group).
  await page
    .getByRole('button', { name: catalogs.tr['settings.preset.HARD'], exact: true })
    .focus();
  await page.keyboard.press('Enter');
  // Back / Escape closes the dialog, and the lobby summary shows the new difficulty.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tv-settings')).toHaveCount(0);
  await expect(page.getByTestId('lobby-summary')).toContainText(
    catalogs.tr['settings.preset.HARD'],
  );
  await expect(
    ece.page.getByRole('button', { name: catalogs.tr['settings.preset.HARD'], exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await closeAll(ece, tv);
});

test('English UI on both screens', async ({ browser }) => {
  const en = catalogs.en;
  const tv = await tvPage(browser, env.url, { locale: 'en-US', search: '?lang=en' });
  await expect(tv.page.getByTestId('tv-start')).toContainText(en['tv.menu.start']);
  const code = await openLobby(tv);
  await expect(tv.page.getByText(en['lobby.scanToJoin'])).toBeVisible();

  const phone = await phonePage(browser, { locale: 'en-US' });
  await phone.page.goto(`${env.url}/join/${code}?lang=en`);
  await expect(phone.page.getByText(en['join.title'])).toBeVisible();
  await phone.page.getByTestId('join-nickname').fill('Alex');
  await phone.page.getByTestId('avatar-fox').click();
  await phone.page.getByTestId('join-submit').click();
  await expect(phone.page.getByTestId('ctl-lobby')).toBeVisible();
  await expect(phone.page.getByText(en['ctl.lobby.title'])).toBeVisible();
  await closeAll(phone, tv);
});

test('join errors are explained in plain words', async ({ browser }) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const room = env.server.built.manager.getByCode(code)!;
  const phone = await phonePage(browser);
  await phone.page.goto(`${env.url}/join/${code}`);
  await phone.page.getByTestId('avatar-fox').click();

  // A reserved name is refused before anything is sent, with the reason on screen.
  await phone.page.getByTestId('join-nickname').fill('admin');
  await expect(phone.page.getByText(catalogs.tr['nickname.reason.RESERVED'])).toBeVisible();
  await phone.page.getByTestId('join-submit').click();
  await expect(phone.page.getByTestId('ctl-lobby')).toHaveCount(0);
  expect(Object.keys(room.state.players)).toHaveLength(0);

  // Fixing the name clears the hint and the same button now joins.
  await phone.page.getByTestId('join-nickname').fill('Ece');
  await expect(phone.page.getByText(catalogs.tr['nickname.reason.RESERVED'])).toHaveCount(0);
  await phone.page.getByTestId('join-submit').click();
  await expect(phone.page.getByTestId('ctl-lobby')).toBeVisible();

  // A room that does not exist says so.
  const lost = await phonePage(browser);
  await lost.page.goto(`${env.url}/join/ZZZZZZ`);
  await expect(lost.page.getByText(catalogs.tr['join.preview.missing'])).toBeVisible();
  await closeAll(phone, lost, tv);
});
