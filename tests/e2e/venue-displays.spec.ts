import { expect, test, type Page } from '@playwright/test';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import { setVenueFlag } from '../helpers/venue';
import {
  PLAY_GAME_CONFIG,
  TV_VIEWPORT,
  phonePage,
  shot,
  startE2eServer,
  type E2eServer,
} from './helpers';

/**
 * Venue displays in real browsers (ADR-0028): under VENUE_LOCK an unpaired TV shows only a pairing code; the
 * owner pairs it from the panel; "Bu TV'de oyun aç" puts a lobby on it; "Kaldır" sends it back to the code.
 */
const mailbox = new MemoryEmailSender();
const OWNER = 'sahip@gusto.example';
let env: E2eServer;

test.beforeEach(async () => {
  env = await startE2eServer(PLAY_GAME_CONFIG, { VENUE_LOCK: '1' }, mailbox);
  await setVenueFlag(env.server, true);
  await env.server.built.venues.createVenue('Gusto Board Game Cafe', OWNER, null);
});
test.afterEach(async () => {
  await env.server.dispose();
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.getByTestId('unlock-email').fill(email);
  await page.getByTestId('unlock-send').click();
  await page.getByTestId('unlock-code').waitFor();
  await expect.poll(() => mailbox.lastCode(email)).not.toBeNull();
  await page.getByTestId('unlock-code').fill(mailbox.lastCode(email)!);
  await page.getByTestId('unlock-verify').click();
}

test('pair a TV from the panel, send a game to it, remove it', async ({ browser }) => {
  const tvContext = await browser.newContext({ viewport: TV_VIEWPORT, locale: 'tr-TR' });
  const tv = await tvContext.newPage();
  await tv.goto(`${env.url}/tv`);

  // Unpaired: a big code, no title menu, nothing to play.
  const code = tv.getByTestId('display-pairing-code');
  await expect(code).toBeVisible();
  await expect(tv.getByTestId('tv-start')).toHaveCount(0);
  await shot(tv, 'display-pairing');
  const shown = (await code.innerText()).trim();
  expect(shown).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u);

  // The owner's phone: sign in, TV'ler, TV ekle.
  const owner = await phonePage(browser);
  await owner.page.goto(`${env.url}/staff`);
  await signIn(owner.page, OWNER);
  await owner.page.getByTestId('staff-tab-displays').click();
  await owner.page.getByTestId('display-code').fill(shown.toLowerCase());
  await owner.page.getByTestId('display-name').fill('Salon TV 1');
  await owner.page.getByRole('button', { name: 'Bağla' }).click();
  await expect(owner.page.getByTestId('display-Salon TV 1')).toBeVisible();
  await expect(owner.page.getByTestId('displays-seats')).toContainText('1 / 3');

  // The TV picks the credential up by itself and shows the game's title menu.
  await expect(tv.getByTestId('tv-start')).toBeVisible({ timeout: 15_000 });
  await expect(owner.page.getByText('Açık')).toBeVisible({ timeout: 15_000 });
  await shot(owner.page, 'display-panel-list');

  // Soru Stüdyosu: one question by hand, checked and saved into the café's own pool.
  await owner.page.getByTestId('staff-tab-studio').click();
  await owner.page.getByTestId('studio-category').fill('Kutu Oyunları');
  await owner.page
    .getByTestId('studio-question')
    .fill('Catan oyununda kaç farklı kaynak türü vardır?');
  for (const [i, text] of ['Üç', 'Dört', 'Beş', 'Altı'].entries())
    await owner.page.getByTestId(`studio-option-${i}`).fill(text);
  await owner.page.getByTestId('studio-correct-2').check();
  await owner.page.getByRole('button', { name: 'Kontrol et' }).click();
  await expect(owner.page.getByTestId('studio-result')).toHaveAttribute('data-status', 'OK');
  await shot(owner.page, 'studio-manual');
  await owner.page.getByTestId('studio-save').click();
  await expect(owner.page.getByTestId('studio-result')).toContainText('kaydedildi');
  await owner.page.getByTestId('staff-tab-displays').click();

  // "Bu TV'de oyun aç": a lobby appears on the TV, with a room code guests can join.
  await owner.page.getByTestId('display-open-Salon TV 1').click();
  await expect(tv.getByTestId('lobby-code')).toBeVisible({ timeout: 15_000 });

  // A browser that is not paired sees the pairing screen only, and the server refuses its rooms.
  const stranger = await browser.newContext({ viewport: TV_VIEWPORT });
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(`${env.url}/tv`);
  await expect(strangerPage.getByTestId('display-pairing-code')).toBeVisible();
  const refused = await strangerPage.evaluate(async () => {
    const response = await fetch('/v1/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: { kind: 'DISPLAY', version: 'e2e' } }),
    });
    return response.status;
  });
  expect(refused).toBe(403);

  // Kaldır (two taps): the TV is back at the code within seconds.
  await owner.page.getByTestId('display-remove-Salon TV 1').click();
  await owner.page.getByTestId('display-remove-Salon TV 1').click();
  await expect(tv.getByTestId('display-pairing-code')).toBeVisible({ timeout: 15_000 });
  await expect(owner.page.getByTestId('display-Salon TV 1')).toHaveCount(0);
});
