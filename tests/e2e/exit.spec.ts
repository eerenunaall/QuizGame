import { expect, test } from '@playwright/test';
import {
  PLAY_GAME_CONFIG,
  joinPhone,
  openLobby,
  startE2eServer,
  tvPage,
  type E2eServer,
} from './helpers';

/**
 * Leaving a room from the TV, and a TV whose phones all vanished: both end on the title menu.
 * Every test gets its own server; allPlayersGoneMs is the schema minimum so the wait stays short.
 */
let env: E2eServer;
test.beforeEach(async () => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    timings: { ...PLAY_GAME_CONFIG.timings, allPlayersGoneMs: 10_000 },
  });
});
test.afterEach(async () => {
  await env.server.dispose();
});

test('the TV exit button asks first, Escape opens it too, and "Evet" closes the room and shows the title menu', async ({
  browser,
}) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat');

  // The control is small, labelled and focusable like the other TV buttons.
  const exit = tv.page.getByTestId('tv-exit');
  await expect(exit).toHaveText('Çıkış');
  await exit.focus();
  await expect(exit).toBeFocused();

  // "Hayır" keeps everything as it was.
  await exit.click();
  const dialog = tv.page.getByTestId('tv-exit-dialog');
  await expect(dialog).toContainText('Odayı kapat ve ana menüye dön?');
  await expect(tv.page.getByTestId('tv-exit-no')).toBeFocused();
  await tv.page.getByTestId('tv-exit-no').click();
  await expect(dialog).toHaveCount(0);
  await expect(tv.page.getByTestId('lobby-code')).toBeVisible();

  // Escape (the remote's Back) opens it, and closes it again.
  await tv.page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await tv.page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(env.server.built.manager.getByCode(code)!.state.phase).toBe('LOBBY');

  // "Evet": the room is closed for everybody and the TV is back on its title menu.
  await tv.page.keyboard.press('Escape');
  await tv.page.getByTestId('tv-exit-yes').click();
  await expect(tv.page.getByTestId('tv-start')).toBeVisible();
  await expect(tv.page.getByTestId('tv-exit')).toHaveCount(0);

  // The phone is told, then returns to the join screen (code entry) by itself.
  await expect(ece.page.getByTestId('ctl-ended')).toContainText('Oda kapatıldı.');
  await expect(ece.page.getByTestId('ctl-ended')).toContainText('Katılma ekranına dönülüyor');
  await expect(ece.page.getByTestId('ctl-ended')).toHaveCount(0, { timeout: 15_000 });
  await expect(ece.page).toHaveURL(/\/join\/?$/);

  await ece.context.close();
  await tv.context.close();
});

test('every phone closing its page sends the TV back to the title menu', async ({ browser }) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  const ahmet = await joinPhone(browser, env.url, code, 'Ahmet', 'cool');

  // One phone alone keeps the room open however long the other one is gone.
  await ahmet.context.close();
  await tv.page.waitForTimeout(12_000);
  await expect(tv.page.getByTestId('lobby-code')).toBeVisible();

  await ece.context.close();
  // allPlayersGoneMs later the room closes: the TV says so, announces the return, then shows the menu.
  await expect(tv.page.getByTestId('tv-closed')).toBeVisible({ timeout: 25_000 });
  await expect(tv.page.getByTestId('tv-closed')).toContainText(
    'Herkes ayrıldığı için oda kapandı.',
  );
  await expect(tv.page.getByTestId('tv-closed-returning')).toHaveText('Ana menüye dönülüyor…');
  await expect(tv.page.getByTestId('tv-start')).toBeVisible({ timeout: 15_000 });

  await tv.context.close();
});

test('"Ana menü" on the closed screen returns at once', async ({ browser }) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  await ece.context.close();
  await expect(tv.page.getByTestId('tv-closed-menu')).toBeVisible({ timeout: 25_000 });
  await tv.page.getByTestId('tv-closed-menu').click();
  await expect(tv.page.getByTestId('tv-start')).toBeVisible();
  await tv.context.close();
});
