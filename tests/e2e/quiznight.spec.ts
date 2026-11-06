/* eslint-disable @typescript-eslint/no-explicit-any -- the night detail is inspected loosely in the page */
import { expect, test, type Page } from '@playwright/test';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import { setVenueFlag } from '../helpers/venue';
import { PLAY_GAME_CONFIG, shot, startE2eServer, TV_VIEWPORT, type E2eServer } from './helpers';

/**
 * A host-led quiz night in real browsers (ADR-0029): the owner builds a "Hızlı" night with three teams on a
 * tablet, the TV opens through the signed display link, round one has a 2x joker (the banner shows on the TV),
 * round two is marked with the quick count, the TV standings are checked and the prize code appears on the
 * tablet only.
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

/** The page's own cookie session talks to the API, like the panel does (CSRF header included). */
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

test('Hızlı night: three teams, TV by display link, a 2x joker, quick count, standings, prize on the tablet only', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const tablet = await browser.newContext({
    viewport: { width: 1024, height: 1366 },
    locale: 'tr-TR',
  });
  const page = await tablet.newPage();
  await page.goto(`${env.url}/staff`);
  await signIn(page, OWNER);
  await page.getByTestId('staff-tab-quiznight').click();

  // Hazırlık: template Hızlı, three teams typed on the tablet.
  await page.getByTestId('qn-new-title').fill('Cuma Quiz Gecesi');
  await page.getByTestId('qn-template').selectOption('QUICK');
  await page.getByTestId('qn-create').click();
  await expect(page.getByTestId('qn-prepare')).toBeVisible();
  for (const name of ['Kaplanlar', 'Baykuşlar', 'Tilkiler']) {
    await page.getByTestId('qn-team-input').fill(name);
    await page.getByTestId('qn-team-add').click();
  }
  await page.getByTestId('qn-entrance').fill('Giriş 100 TL, bir içecek dahil');
  await page.getByTestId('qn-prize-text').fill('Bir içecek bizden');
  await page.getByTestId('qn-save').click();
  await expect(page.getByTestId('qn-issues')).toBeVisible(); // 16 blank questions still to fill

  // The 16 questions are filled through the same API the form uses (typing 16 questions adds nothing here).
  const list = await api(page, 'GET', `/v1/venues/${venueId}/quiznights`);
  const nightId = list.body.nights[0].id as string;
  const detail = await api(page, 'GET', `/v1/venues/${venueId}/quiznights/${nightId}`);
  const config = detail.body.night.config;
  config.rounds.forEach((round: any, r: number) => {
    round.questions.forEach((q: any, i: number) => {
      q.text = `Tur ${r + 1} soru ${i + 1}: hangisi doğru?`;
      q.options = ['Bir', 'İki', 'Üç', 'Dört'];
      q.answer = { type: 'OPTION', index: 2 };
      q.explanation = `Açıklama ${r + 1}.${i + 1}`;
    });
  });
  expect(
    (await api(page, 'POST', `/v1/venues/${venueId}/quiznights/${nightId}/config`, config)).status,
  ).toBe(200);
  const teams = config.teams as { id: string; name: string }[];
  const q1 = config.rounds[0].questions[0].id as string;
  const q2 = config.rounds[0].questions[1].id as string;

  // Back to the list and into the saved night: now it is ready.
  await page.getByText('Gecelere dön').click();
  await page.getByTestId(`qn-night-${nightId}`).getByRole('button', { name: 'Aç' }).click();
  await expect(page.getByTestId('qn-ready')).toBeVisible();
  await shot(page, 'quiznight-tablet-prepare');

  // Sunum: start, display link, TV.
  await page.getByTestId('qn-mode-present').click();
  await page.getByTestId('qn-start').click();
  await expect(page.getByTestId('qn-step')).toContainText('Açılış');
  await page.getByTestId('qn-make-link').click();
  const link = await page.getByTestId('qn-link').inputValue();
  expect(link).toContain('/tv/gece?l=');

  const tvContext = await browser.newContext({ viewport: TV_VIEWPORT, locale: 'tr-TR' });
  const tv = await tvContext.newPage();
  await tv.goto(link);
  await expect(tv.getByTestId('night-tv')).toHaveAttribute('data-step', 'INTRO');
  await expect(tv.getByTestId('night-tv')).toContainText('Giriş 100 TL');
  await tv.waitForTimeout(900);
  await shot(tv, 'quiznight-tv-intro');

  const tvShot = async (name: string) => {
    await tv.waitForTimeout(900); // let the slide's entrance animation finish
    await shot(tv, name);
  };
  const next = async () => {
    await page.getByTestId('qn-next').click();
    // the tablet is the truth; wait until the server has applied it (the step label changes or the cursor moves)
    await page.waitForTimeout(250);
  };

  // A team tells the host before round one's first question: Kaplanlar play the 2x joker.
  await page.getByTestId(`qn-joker-${teams[0]!.id}`).click();
  await expect(page.getByTestId(`qn-joker-${teams[0]!.id}`)).toContainText('1 hak');
  await next(); // HOWTO
  await expect(tv.getByTestId('night-tv')).toHaveAttribute('data-step', 'HOWTO');
  await tvShot('quiznight-tv-howto');
  await next(); // ROUND_TITLE
  await next(); // question 1 is on the TV
  await expect(tv.getByTestId('night-tv')).toHaveAttribute('data-step', 'QUESTION');
  await expect(tv.getByTestId('night-doubled')).toContainText('Kaplanlar ÇİFT PUAN dedi!');
  await tvShot('quiznight-tv-question-joker');
  // locked: the next question's picker no longer offers question 1, and the server refuses a late pick
  const late = await api(page, 'POST', `/v1/venues/${venueId}/quiznights/${nightId}/command`, {
    cmd: { type: 'JOKER', questionId: q1, teamId: teams[1]!.id, on: true },
  });
  expect(late.status).toBe(409);
  for (let i = 0; i < 7; i++) await next(); // questions 2-8
  await next(); // LOCKED
  await expect(tv.getByTestId('night-pens-down')).toBeVisible();
  await tvShot('quiznight-tv-pens-down');
  await next(); // SWAP
  await expect(tv.getByTestId('night-rotation')).toContainText('Masa 1 → Masa 2');
  await tvShot('quiznight-tv-swap');
  await next(); // ANSWER 1
  await expect(tv.getByTestId('night-answer')).toContainText('Üç');
  await tvShot('quiznight-tv-answer');
  for (let i = 0; i < 7; i++) await next(); // answers 2-8
  await next(); // MARKING
  await expect(tv.getByTestId('night-tv')).toHaveAttribute('data-step', 'MARKING');

  // Marking grid: Kaplanlar (doubled) and Baykuşlar get question 1; Baykuşlar also question 2.
  await page.getByTestId(`qn-cell-${q1}-${teams[0]!.id}`).click();
  await page.getByTestId(`qn-cell-${q1}-${teams[1]!.id}`).click();
  await page.getByTestId(`qn-cell-${q2}-${teams[1]!.id}`).click();
  await expect(page.getByTestId(`qn-pts-${teams[0]!.id}`)).toHaveText('2');
  await expect(page.getByTestId(`qn-pts-${teams[1]!.id}`)).toHaveText('2');
  await shot(page, 'quiznight-tablet-present');
  await next(); // ROUND_SCORES
  await expect(tv.getByTestId('night-round-scores')).toBeVisible();
  await expect(tv.getByTestId('night-joker-paid')).toContainText('Kaplanlar');
  await tvShot('quiznight-tv-round-scores');
  await next(); // STANDINGS
  await expect(tv.getByTestId('night-standings')).toBeVisible();

  // Round two: quick count.
  await next(); // ROUND_TITLE 2
  for (let i = 0; i < 8; i++) await next(); // questions
  await next(); // LOCKED
  await next(); // SWAP
  await page.getByTestId('qn-mode-COUNT').click();
  await page.getByTestId(`qn-count-${teams[0]!.id}`).fill('3');
  await page.getByTestId(`qn-count-${teams[1]!.id}`).fill('6');
  await page.getByTestId(`qn-count-${teams[2]!.id}`).fill('1');
  await expect(page.getByTestId(`qn-pts-${teams[1]!.id}`)).toHaveText('6');
  for (let i = 0; i < 8; i++) await next(); // answers
  await next(); // MARKING
  await next(); // ROUND_SCORES
  await next(); // STANDINGS
  await expect(tv.getByTestId('night-tv')).toHaveAttribute('data-step', 'STANDINGS');
  // totals: Kaplanlar 2+3, Baykuşlar 2+6, Tilkiler 0+1
  const rows = tv.getByTestId('night-standings').locator('li');
  await expect(rows.nth(0)).toContainText('Baykuşlar');
  await expect(rows.nth(0)).toContainText('8');
  await expect(rows.nth(1)).toContainText('Kaplanlar');
  await expect(rows.nth(2)).toContainText('Tilkiler');
  await tvShot('quiznight-tv-standings');

  // Podium and the prize: the code is on the tablet, never on the TV.
  await next();
  await expect(tv.getByTestId('night-podium')).toBeVisible();
  await expect(tv.getByTestId('night-podium')).toContainText('Baykuşlar kazandı!');
  await tvShot('quiznight-tv-podium');
  await page.getByTestId(`qn-give-${teams[1]!.id}`).click();
  const code = (await page.getByTestId('qn-prize-code').locator('strong').innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{8}$/u);
  await shot(page, 'quiznight-tablet-prize');
  await tv.waitForTimeout(2000);
  expect(await tv.content()).not.toContain(code);
  expect(await tv.getByTestId('night-tv').innerText()).not.toContain(code);
});
