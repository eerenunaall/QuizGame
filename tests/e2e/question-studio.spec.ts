import { expect, test, type Page } from '@playwright/test';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import { setVenueFlag } from '../helpers/venue';
import { PLAY_GAME_CONFIG, phonePage, shot, startE2eServer, type E2eServer } from './helpers';

/**
 * The Soru Stüdyosu with the model switched off (owner decision 2026-11-10): the owner pastes questions their
 * own assistant wrote, reads what could not be read, approves the drafts and finds them in the question list.
 * No AUTHORING_* key exists on this server.
 */
const mailbox = new MemoryEmailSender();
const OWNER = 'sahip@gusto.example';
let env: E2eServer;

test.beforeEach(async () => {
  env = await startE2eServer(PLAY_GAME_CONFIG, {}, mailbox);
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

const QUESTIONS = `1. Catan oyununda kaç tür kaynak vardır?
A) Üç
B) Dört
C) Beş
D) Altı
Cevap: C
Açıklama: Kerpiç, odun, koyun, buğday ve cevher.

2. Satranç tahtasında toplam kaç kare bulunur?
A) 36
B) 49
C) 64
D) 81
Cevap: 64

3. Bu sorunun yalnızca iki şıkkı var mı?
A) Evet
B) Hayır
Cevap: A
`;

test('paste ready questions, read them with no model, approve and find them in the list', async ({
  browser,
}) => {
  const owner = await phonePage(browser);
  const { page } = owner;
  await page.goto(`${env.url}/staff`);
  await signIn(page, OWNER);
  await page.getByTestId('staff-tab-studio').click();

  // The model is off, the reader is not.
  await expect(page.getByTestId('authoring-off')).toBeVisible();
  await expect(page.getByTestId('text-import')).toBeVisible();
  await expect(page.getByTestId('text-read')).toBeDisabled();
  await page.getByTestId('text-paste').fill(QUESTIONS);
  await page.getByTestId('text-category').fill('Kutu oyunları');
  await page.getByTestId('text-read').click();

  await expect(page.getByTestId('text-done')).toContainText('2 soru taslak oldu');
  await expect(page.getByTestId('text-skipped')).toContainText('Soru 3');
  await expect(page.getByTestId('text-skipped')).toContainText('şık sayısı 4 değil');
  await expect(page.getByTestId('draft-card')).toHaveCount(2);
  // The right option is marked on each card; a text answer ("64") found its option.
  await expect(
    page.getByTestId('draft-card').nth(1).locator('[data-correct="true"]'),
  ).toContainText('64');
  await shot(page, 'studio-text-import');

  // Nothing is a question yet: approve them all.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('authoring-approve-all').click();
  await expect(page.getByTestId('authoring-notice')).toContainText('2');
  await expect(page.getByTestId('draft-card')).toHaveCount(0);

  // They are in the café's own pool now.
  await page.getByTestId('staff-tab-questions').click();
  await expect(page.getByTestId('vq-totals')).toBeVisible();
  await expect(page.getByTestId('vq-uploads')).toContainText('Belge: Yapıştırılan sorular');
});
