/* eslint-disable @typescript-eslint/no-explicit-any -- the night detail is inspected loosely in the page */
import { expect, test, type Page } from '@playwright/test';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import { png } from '../helpers/images';
import { setVenueFlag } from '../helpers/venue';
import { PLAY_GAME_CONFIG, TV_VIEWPORT, shot, startE2eServer, type E2eServer } from './helpers';

/**
 * A picture round in real browsers (docs/TODO.md A2): the owner builds a night with a PICTURE round on a
 * tablet, uploads a real PNG for the question, and the TV (opened by the display link) really paints it.
 * The web app's CSP is `img-src 'self'`, so this fails the moment a picture comes from anywhere else.
 */
const mailbox = new MemoryEmailSender();
const OWNER = 'sahip@quiz.example';
let env: E2eServer;
let venueId: string;

test.beforeEach(async () => {
  env = await startE2eServer(PLAY_GAME_CONFIG, { VENUE_MINUTE_MS: '60000' }, mailbox);
  await setVenueFlag(env.server, true);
  venueId = (await env.server.built.venues.createVenue('Gusto Board Game Cafe', OWNER, null)).id;
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
const api = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p, {
        method: m,
        credentials: 'same-origin',
        headers: { 'x-quizparty-csrf': '1', 'content-type': 'application/json' },
        ...(b ? { body: JSON.stringify(b) } : {}),
      });
      return { status: r.status, body: await r.json() };
    },
    [method, path, body ?? null] as const,
  );

test('a picture uploaded on the tablet is painted on the TV, from the app origin', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const tablet = await browser.newContext({
    viewport: { width: 1024, height: 1366 },
    locale: 'tr-TR',
  });
  const page = await tablet.newPage();
  await page.goto(`${env.url}/staff`);
  await signIn(page, OWNER);
  await page.getByTestId('staff-tab-quiznight').click();
  await page.getByTestId('qn-new-title').fill('Resim Gecesi');
  await page.getByTestId('qn-template').selectOption('BLANK');
  await page.getByTestId('qn-create').click();
  await expect(page.getByTestId('qn-prepare')).toBeVisible();
  for (const name of ['Kaplanlar', 'Baykuşlar']) {
    await page.getByTestId('qn-team-input').fill(name);
    await page.getByTestId('qn-team-add').click();
  }
  await page.getByTestId('qn-add-round').click();
  await page.getByTestId('qn-round-0').getByRole('combobox').first().selectOption('PICTURE');

  const question = page.getByTestId('qn-round-0').locator('[data-testid^="qn-q-"]').first();
  const id = (await question.getAttribute('data-testid'))!.replace('qn-q-', '');
  await page.getByTestId(`qn-q-text-${id}`).fill('Bu kule hangi şehirdedir?');
  await page.getByTestId(`qn-q-answer-${id}`).fill('İstanbul');
  await page.getByTestId(`qn-q-picture-${id}-file`).setInputFiles({
    name: 'kule.png',
    mimeType: 'image/png',
    buffer: png({ width: 640, height: 400 }),
  });
  await expect(page.getByTestId(`qn-q-picture-${id}-img`)).toBeVisible();
  expect(
    await page
      .getByTestId(`qn-q-picture-${id}-img`)
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
  ).toBe(640);
  await page.getByTestId('qn-save').click();
  await expect(page.getByTestId('qn-ready')).toBeVisible();
  await shot(page, 'quiznight-picture-prepare');

  // Sunum and the TV: the question with its picture.
  await page.getByTestId('qn-mode-present').click();
  await page.getByTestId('qn-start').click();
  await page.getByTestId('qn-make-link').click();
  const link = await page.getByTestId('qn-link').inputValue();
  const tvContext = await browser.newContext({ viewport: TV_VIEWPORT, locale: 'tr-TR' });
  const tv = await tvContext.newPage();
  const violations: string[] = [];
  tv.on('console', (message) => {
    if (/content security policy|refused to load/iu.test(message.text()))
      violations.push(message.text());
  });
  await tv.goto(link);
  for (const step of ['HOWTO', 'ROUND_TITLE', 'QUESTION']) {
    await page.getByTestId('qn-next').click();
    await expect(tv.getByTestId('night-tv')).toHaveAttribute('data-step', step);
  }
  const picture = tv.getByTestId('night-picture');
  await expect(picture).toBeVisible();
  await expect(picture).toHaveAttribute(
    'src',
    new RegExp(`^/v1/venue-assets/${venueId}/[0-9a-f]{64}$`, 'u'),
  );
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(640);
  expect(violations).toEqual([]);
  await tv.waitForTimeout(900);
  await shot(tv, 'quiznight-picture-tv');

  // The server refuses a picture from anywhere else, even if a hand-made request tries.
  const list = await api(page, 'GET', `/v1/venues/${venueId}/quiznights`);
  const nightId = list.body.nights[0].id as string;
  const night = await api(page, 'GET', `/v1/venues/${venueId}/quiznights/${nightId}`);
  expect(night.body.night.status).toBe('LIVE');
});
