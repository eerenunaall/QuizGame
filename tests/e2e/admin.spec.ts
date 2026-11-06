import { expect, test, type Page } from '@playwright/test';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import {
  ADMIN_DIST,
  PLAY_GAME_CONFIG,
  joinPhone,
  openLobby,
  shot,
  startE2eServer,
  tvPage,
  type E2eServer,
} from './helpers';

/**
 * The whole report loop in real browsers: a player reports the question on the reveal screen, staff
 * sign in to the console with a mailed code, find the report and act on it. Its own server.
 */
const BOSS = 'boss@example.test';
const mailbox = new MemoryEmailSender();
// Reveal and score screens last long enough to tap through the report sheet.
const CONFIG = {
  ...PLAY_GAME_CONFIG,
  defaultRounds: 3,
  timings: { ...PLAY_GAME_CONFIG.timings, revealMs: 20_000, scoreUpdateMs: 20_000 },
};

let env: E2eServer;
test.beforeEach(async () => {
  env = await startE2eServer(
    CONFIG,
    { SERVE_ADMIN: '1', ADMIN_DIST, ADMIN_BOOTSTRAP_EMAILS: BOSS },
    mailbox,
  );
});
test.afterEach(async () => {
  await env.server.dispose();
});

async function signIn(page: Page): Promise<void> {
  await page.goto(`${env.url}/admin/`);
  await page.getByTestId('login-email').fill(BOSS);
  await page.getByTestId('login-send').click();
  await page.getByTestId('login-code').waitFor();
  await expect.poll(() => mailbox.lastCode(BOSS)).not.toBeNull();
  await page.getByTestId('login-code').fill(mailbox.lastCode(BOSS)!);
  await page.getByTestId('login-verify').click();
  await expect(page.getByTestId('nav-questions')).toBeVisible();
}

test('a player reports a question and a moderator closes the report in the console', async ({
  browser,
}) => {
  // ── a phone reports the question it just answered ──
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  const ahmet = await joinPhone(browser, env.url, code, 'Ahmet', 'cool');
  await ece.page.getByTestId('ctl-start').click();
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
  const question = env.server.built.manager.getByCode(code)!.state.game!.round!.question!;
  const correct = question.options.findIndex((option) => option.correct);
  await ece.page.locator(`[data-answer-index="${correct}"]`).click();
  await ahmet.page.locator(`[data-answer-index="${correct}"]`).click();

  await ece.page.getByTestId('ctl-report-open').click();
  await expect(ece.page.getByTestId('ctl-report-sheet')).toBeVisible();
  await ece.page.getByTestId('ctl-report-WRONG_ANSWER').click();
  await expect(ece.page.getByTestId('ctl-report-sent')).toBeVisible();

  const stored = await env.server.db.db
    .selectFrom('question_reports')
    .select(['id', 'question_id', 'reason', 'status'])
    .execute();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ reason: 'WRONG_ANSWER', status: 'OPEN' });
  await ece.context.close();
  await ahmet.context.close();
  await tv.context.close();

  // ── staff: sign in, see the report, send the question to review, reject it ──
  const staff = await browser.newContext({ locale: 'tr-TR' });
  const page = await staff.newPage();
  await page.goto(`${env.url}/admin/#/reports`);
  await expect(page.getByTestId('login-email')).toBeVisible(); // not signed in: the sign-in form, nothing else
  await signIn(page);

  await page.getByTestId('nav-reports').click();
  const rows = page.getByTestId('report-table').locator('tr');
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId('report-table')).toContainText('WRONG_ANSWER');
  await shot(page, 'admin-reports');
  await page.getByTestId('report-SEND_TO_REVIEW').click();
  await expect(page.getByTestId('ok')).toBeVisible();

  await expect
    .poll(async () => {
      const row = await env.server.db.db
        .selectFrom('question_reports')
        .select('status')
        .where('id', '=', stored[0]!.id)
        .executeTakeFirstOrThrow();
      return row.status;
    })
    .toBe('ACTIONED');

  await page.getByTestId('nav-queue').click();
  await expect(page.getByTestId('queue-table')).toContainText(question.text);
  await page.getByTestId('queue-table').getByRole('link', { name: question.text }).click();
  await expect(page.getByTestId('edit-text')).toHaveValue(question.text);

  await shot(page, 'admin-question');
  await page.getByTestId('workflow-reason').fill('oyuncu bildirimi doğrulandı');
  await page.getByTestId('reject').click();
  await expect(page.getByTestId('ok')).toBeVisible();
  const after = await env.server.db.db
    .selectFrom('questions')
    .select('status')
    .where('id', '=', stored[0]!.question_id)
    .executeTakeFirstOrThrow();
  expect(after.status).toBe('REJECTED');

  // Every change staff made is in the audit log.
  await page.getByTestId('nav-audit').click();
  await expect(page.getByTestId('audit-table')).toContainText('report.resolve');
  await expect(page.getByTestId('audit-table')).toContainText('question.reject');

  // Signing out ends the session for real: the console asks for a code again.
  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.goto(`${env.url}/admin/#/audit`);
  await expect(page.getByTestId('login-email')).toBeVisible();
  await staff.close();
});

test('someone who is not on staff is refused at the door with a plain message', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'tr-TR' });
  const page = await context.newPage();
  await page.goto(`${env.url}/admin/`);
  await page.getByTestId('login-email').fill('player@example.test');
  await page.getByTestId('login-send').click();
  await page.getByTestId('login-code').waitFor();
  await expect.poll(() => mailbox.lastCode('player@example.test')).not.toBeNull();
  await page.getByTestId('login-code').fill(mailbox.lastCode('player@example.test')!);
  await page.getByTestId('login-verify').click();
  await expect(page.getByTestId('error')).toContainText('yetkisi yok');
  await expect(page.getByTestId('nav-questions')).toHaveCount(0);
  await context.close();
});
