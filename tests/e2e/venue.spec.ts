import { expect, test, type Page } from '@playwright/test';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import { setVenueFlag } from '../helpers/venue';
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
 * Venue mode in real browsers (ADR-0024), the café evening in one run: a waiter signs in on the staff
 * page and opens a two-minute table on the TV (one metered minute lasts six seconds here), the TV
 * shows the time, the time runs out during the first question, the question finishes and results
 * show; the waiter extends, the table plays again, the winner's phone shows a code, the waiter
 * redeems it once and the second try is refused.
 */
const mailbox = new MemoryEmailSender();
const WAITER = 'garson@gusto.example';
let env: E2eServer;

test.beforeEach(async () => {
  env = await startE2eServer(PLAY_GAME_CONFIG, { VENUE_MINUTE_MS: '6000' }, mailbox);
  await setVenueFlag(env.server, true);
  const venues = env.server.built.venues;
  const { id } = await venues.createVenue('Gusto Board Game Cafe', 'sahip@gusto.example', null);
  await venues.addStaff(id, WAITER, 'STAFF', null);
  await venues.updateSettings(id, {
    reward: { enabled: true, text: 'Bir içecek bizden', minPlayers: 3 },
  });
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

test('a metered table: open, time-up after the round, extend, play, win a code, redeem it once', async ({
  browser,
}) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const players = [
    await joinPhone(browser, env.url, code, 'Ece', 'cat'),
    await joinPhone(browser, env.url, code, 'Ahmet', 'cool'),
    await joinPhone(browser, env.url, code, 'Merve', 'fox'),
  ];
  const [ece, ahmet, merve] = players as [
    (typeof players)[0],
    (typeof players)[0],
    (typeof players)[0],
  ];

  // The waiter's own phone: sign in, open a two-minute table by the code on the TV.
  const waiter = await phonePage(browser);
  await waiter.page.goto(`${env.url}/staff`);
  await signIn(waiter.page, WAITER);
  await waiter.page.getByTestId('staff-tab-new').click();
  await waiter.page.getByTestId('staff-new-minutes').fill('2');
  await waiter.page.getByTestId('staff-new-code').fill(code);
  await waiter.page.getByTestId('staff-new-open').click();
  await expect(waiter.page.getByTestId('staff-new-result')).toContainText(code);
  await expect(waiter.page.getByTestId(`staff-table-${code}`)).toBeVisible();
  await shot(waiter.page, 'venue-staff-tables');

  // The TV shows the time left, quietly, next to the room code.
  await expect(tv.page.getByTestId('venue-chip')).toBeVisible();
  await shot(tv.page, 'venue-tv-chip');

  // The game starts; the paid time runs out while the first question is open.
  await ece.page.getByTestId('ctl-start').click();
  for (const phone of players) await expect(phone.page.getByTestId('ctl-answering')).toBeVisible();
  const room = env.server.built.manager.getByCode(code)!;
  await expect(tv.page.getByTestId('venue-chip')).toHaveAttribute('data-tone', 'up', {
    timeout: 20_000,
  });
  await expect(tv.page.getByTestId('tv-options')).toBeVisible();
  const question = room.state.game!.round!.question!;
  const correct = question.options.findIndex((option) => option.correct);
  for (const phone of players) await phone.page.locator(`[data-answer-index="${correct}"]`).click();
  // The question finished (answers counted, revealed); then results, not the next round.
  await expect(ece.page.getByTestId('ctl-outcome')).toHaveAttribute('data-outcome', 'CORRECT');
  await expect(tv.page.getByTestId('tv-results')).toBeVisible({ timeout: 20_000 });
  expect(room.state.game!.roundIndex).toBe(0);
  await expect(tv.page.getByTestId('tv-venue-time-up')).toBeVisible();
  await expect(tv.page.getByTestId('tv-venue-reward')).toHaveCount(0);
  await expect(ece.page.getByTestId('ctl-venue-blocked')).toHaveAttribute('data-reason', 'up');
  await shot(tv.page, 'venue-tv-time-up');
  // A rematch is refused while the time is up.
  await ece.page.getByTestId('ctl-rematch').click();
  await expect(tv.page.getByTestId('tv-results')).toBeVisible();
  expect(room.state.phase).toBe('RESULTS');

  // The waiter extends the table: the TV and phones learn it live, without a reload.
  await waiter.page.getByTestId('staff-tab-tables').click();
  await expect(waiter.page.getByTestId(`staff-status-${code}`)).toContainText('Süre doldu');
  await waiter.page.getByTestId(`staff-extend-${code}-15`).click();
  await expect(waiter.page.getByTestId(`staff-status-${code}`)).toContainText('Kalan');
  await expect(tv.page.getByTestId('tv-venue-time-up')).toHaveCount(0);
  // (fifteen scaled minutes are 90 s here, so the chip is amber, not calm: the tones count real time)
  await expect(tv.page.getByTestId('venue-chip')).toHaveAttribute('data-tone', /calm|amber/u);

  // Play resumes: Ahmet wins every question, the others miss.
  await ece.page.getByTestId('ctl-rematch').click();
  for (let round = 0; round < 3; round++) {
    for (const phone of players)
      await expect(phone.page.getByTestId('ctl-answering')).toBeVisible();
    const q = room.state.game!.round!.question!;
    const right = q.options.findIndex((option) => option.correct);
    const wrong = (right + 1) % q.options.length;
    await ahmet.page.locator(`[data-answer-index="${right}"]`).click();
    await ece.page.locator(`[data-answer-index="${wrong}"]`).click();
    await merve.page.locator(`[data-answer-index="${wrong}"]`).click();
    await expect(ahmet.page.getByTestId('ctl-outcome')).toHaveAttribute('data-outcome', 'CORRECT');
  }
  await expect(tv.page.getByTestId('tv-results')).toBeVisible({ timeout: 20_000 });

  // The winner's phone shows the code big; the TV says who won; nobody else sees a code.
  await expect(ahmet.page.getByTestId('ctl-venue-reward')).toContainText('Bir içecek bizden');
  const shown = (await ahmet.page.getByTestId('ctl-venue-reward-code').innerText()).trim();
  expect(shown).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u);
  await expect(tv.page.getByTestId('tv-venue-reward')).toContainText('Ahmet');
  for (const phone of [ece, merve])
    await expect(phone.page.getByTestId('ctl-venue-reward')).toHaveCount(0);
  await shot(ahmet.page, 'venue-phone-reward');
  await shot(tv.page, 'venue-tv-reward');

  // At the counter: the waiter checks the code once; the second try is refused.
  await waiter.page.getByTestId('staff-tab-redeem').click();
  await waiter.page.getByTestId('staff-redeem-code').fill(shown.toLowerCase());
  await waiter.page.getByTestId('staff-redeem-submit').click();
  await expect(waiter.page.getByTestId('staff-redeem-result')).toHaveAttribute('data-ok', '1');
  await expect(waiter.page.getByTestId('staff-redeem-result')).toContainText('Ahmet');
  await shot(waiter.page, 'venue-staff-redeemed');
  await waiter.page.getByTestId('staff-redeem-code').fill(shown);
  await waiter.page.getByTestId('staff-redeem-submit').click();
  await expect(waiter.page.getByTestId('staff-redeem-result')).toHaveAttribute('data-ok', '0');
  await expect(waiter.page.getByTestId('staff-redeem-result')).toContainText('zaten kullanıldı');

  // Closing time: the waiter ends the table (two taps); back in the lobby the TV says who to ask.
  await waiter.page.getByTestId('staff-tab-tables').click();
  await waiter.page.getByTestId(`staff-end-${code}`).click();
  await waiter.page.getByTestId(`staff-end-${code}`).click();
  await expect(waiter.page.getByTestId(`staff-table-${code}`)).toHaveCount(0);
  await ece.page.getByTestId('ctl-lobby-back').click();
  await expect(tv.page.getByTestId('venue-time-up')).toBeVisible();
  await expect(tv.page.getByTestId('venue-time-up')).toContainText(code);
  await expect(ece.page.getByTestId('ctl-venue-blocked')).toBeVisible();
  await shot(tv.page, 'venue-tv-closed-table');

  for (const screen of [tv, waiter, ...players]) await screen.context.close();
});
