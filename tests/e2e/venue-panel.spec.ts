import { expect, test, type Page } from '@playwright/test';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import { png } from '../helpers/images';
import { seedVenueQuestions, setVenueFlag } from '../helpers/venue';
import {
  PLAY_GAME_CONFIG,
  joinPhone,
  openLobby,
  phonePage,
  shot,
  startE2eServer,
  tvPage,
  type E2eServer,
} from './helpers';

/**
 * The venue panel in real browsers (ADR-0030): the owner opens the short address /mekan on a phone,
 * uploads a logo, picks a theme and accent, sets the prize and the entrance line; the TV lobby and a
 * guest's phone wear exactly that, and a price edit follows live. The owner also checks the answers view.
 */
const mailbox = new MemoryEmailSender();
const OWNER = 'sahip@cinar.example';
let env: E2eServer;
let venueId = '';

test.beforeEach(async () => {
  env = await startE2eServer(PLAY_GAME_CONFIG, { VENUE_MINUTE_MS: '6000' }, mailbox);
  await setVenueFlag(env.server, true);
  const created = await env.server.built.venues.createVenue('Çınar Kafe', OWNER, null);
  venueId = created.id;
  await seedVenueQuestions(env.server, venueId, 4, { prefix: 'Çınar' });
  await env.server.db.db
    .updateTable('questions')
    .set({ status: 'ACTIVE' })
    .where('owner_venue_id', '=', venueId)
    .execute();
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

test('the owner dresses the café from /mekan and the TV and a phone follow, a price edit live', async ({
  browser,
}) => {
  const owner = await phonePage(browser);
  const panel = owner.page;
  await panel.goto(`${env.url}/mekan`);
  await signIn(panel, OWNER);
  await expect(panel.getByTestId('staff-venue')).toHaveText('Çınar Kafe');
  await expect(panel.getByTestId('panel-tabs').locator('button')).toHaveCount(11 + 1); // + quiz night
  await shot(panel, 'panel-tables');

  // Görünüm: logo, theme, accent, a team name
  await panel.getByTestId('staff-tab-look').click();
  await panel.getByTestId('look-logo-file').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: png({ width: 480, height: 160 }),
  });
  await expect(panel.getByTestId('look-logo-img')).toBeVisible();
  await panel.getByTestId('look-theme-venue-gold').click();
  await panel.getByTestId('look-accent-mint').click();
  await panel.getByTestId('staff-play-name-0').fill('Aslanlar');
  await expect(panel.getByTestId('look-tv-logo')).toBeVisible();
  await panel.getByTestId('look-team-0').scrollIntoViewIfNeeded();
  await shot(panel, 'panel-look-teams');
  await panel.getByTestId('look-preview-tv').scrollIntoViewIfNeeded();
  await shot(panel, 'panel-look');
  await panel.getByTestId('panel-save-look').click();
  await expect(panel.getByTestId('panel-toast')).toContainText('Kaydedildi');
  await expect(panel.getByTestId('panel-logo')).toBeVisible();

  // Ödül
  await panel.getByTestId('staff-tab-reward').click();
  await panel.getByTestId('staff-settings-reward').check({ force: true });
  await panel.getByTestId('staff-settings-reward-text').fill('Bir türk kahvesi bizden');
  await shot(panel, 'panel-reward');
  await panel.getByTestId('panel-save-reward').click();
  await expect(panel.getByTestId('panel-toast')).toContainText('Kaydedildi');

  // Giriş ücreti
  await panel.getByTestId('staff-tab-entrance').click();
  await panel.getByTestId('panel-entrance-on').check({ force: true });
  await panel.getByTestId('panel-entrance-text').fill('150 TL, içecek dahil');
  await shot(panel, 'panel-entrance');
  await panel.getByTestId('panel-save-entrance').click();
  await expect(panel.getByTestId('panel-toast')).toContainText('Kaydedildi');

  // Sorular: the owner reads the venue's own questions with their answers
  await panel.getByTestId('staff-tab-questions').click();
  await panel.getByTestId('questions-view-venue').click();
  await expect(panel.getByTestId('answer-card').first()).toBeVisible();
  await expect(panel.locator('[data-correct="1"]').first()).toBeVisible();
  await shot(panel, 'panel-answers');

  // The TV opens a lobby, a guest joins, the owner opens the table by its code
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const guest = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  await panel.getByTestId('staff-tab-new').click();
  await panel.getByTestId('staff-new-code').fill(code);
  await panel.getByTestId('staff-new-open').click();
  await expect(panel.getByTestId('staff-new-result')).toContainText(code);

  // The TV wears the venue's look and shows the entrance line next to the room code
  await expect(tv.page.getByTestId('tv-entrance')).toContainText('150 TL, içecek dahil');
  await expect(tv.page.locator('html')).toHaveAttribute('data-theme', 'venue-gold');
  await expect(tv.page.locator(`img[src^="/v1/venue-assets/${venueId}/"]`).first()).toBeVisible();
  await shot(tv.page, 'panel-tv-lobby');
  // the guest's phone shows the café and the line
  await expect(guest.page.getByTestId('ctl-entrance')).toContainText('150 TL, içecek dahil');
  await expect(guest.page.getByTestId('ctl-brand')).toContainText('Çınar Kafe');
  await shot(guest.page, 'panel-phone-lobby');

  // A price edit while the table is open follows live, no reload
  await panel.getByTestId('staff-tab-entrance').click();
  await panel.getByTestId('panel-entrance-text').fill('200 TL, iki içecek dahil');
  await panel.getByTestId('panel-save-entrance').click();
  await expect(panel.getByTestId('panel-toast')).toContainText('Kaydedildi');
  await expect(tv.page.getByTestId('tv-entrance')).toContainText('200 TL, iki içecek dahil');
  await expect(guest.page.getByTestId('ctl-entrance')).toContainText('200 TL, iki içecek dahil');
});
