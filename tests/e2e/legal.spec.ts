import { expect, test, type Page } from '@playwright/test';
import { phonePage, startE2eServer, tvPage, type E2eServer } from './helpers';

/**
 * /privacy, /terms and /support in a real browser under the production shell's strict CSP: the lazy
 * page loads, shows the Turkish text then the English one under the draft notice, nothing is blocked
 * by the policy, and the TV title and the phone's front door link to them.
 */
let env: E2eServer;
test.beforeEach(async () => {
  env = await startE2eServer();
});
test.afterEach(async () => {
  await env.server.dispose();
});

function watchPolicy(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/iu.test(message.text())) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

test('the legal pages render under the strict CSP, Turkish first then English', async ({
  browser,
}) => {
  const phone = await phonePage(browser);
  const problems = watchPolicy(phone.page);
  for (const [path, tr, en] of [
    ['/privacy', 'Gizlilik ve KVKK aydınlatma metni', 'Privacy notice'],
    ['/terms', 'Kullanım koşulları', 'Terms of use'],
    ['/support', 'Destek', 'Support'],
  ] as const) {
    const response = await phone.page.goto(`${env.url}${path}`);
    expect(response?.headers()['content-security-policy']).toContain("default-src 'none'");
    const headings = phone.page.getByRole('heading', { level: 1 });
    await expect(headings).toHaveText([tr, en]);
    await expect(phone.page.getByTestId('legal-draft-notice')).toContainText('not legal advice');
  }
  await expect(phone.page.getByText(/QuizNight is not affiliated with/u)).toHaveCount(0);
  await phone.page.goto(`${env.url}/terms`);
  await expect(phone.page.getByText(/QuizNight is not affiliated with/u)).toBeVisible();
  expect(problems).toEqual([]);
  await phone.context.close();
});

test('the phone front door and the TV title link to them', async ({ browser }) => {
  const phone = await phonePage(browser);
  const problems = watchPolicy(phone.page);
  await phone.page.goto(`${env.url}/join`);
  await phone.page.getByRole('link', { name: 'Gizlilik' }).click();
  await expect(phone.page).toHaveURL(/\/privacy$/u);
  await expect(phone.page.getByRole('heading', { level: 1 }).first()).toHaveText(
    'Gizlilik ve KVKK aydınlatma metni',
  );
  expect(problems).toEqual([]);
  await phone.context.close();

  const tv = await tvPage(browser, env.url);
  await expect(tv.page.getByTestId('legal-links')).toBeVisible();
  await tv.page.getByRole('link', { name: 'Destek' }).click();
  await expect(tv.page).toHaveURL(/\/support$/u);
  await tv.context.close();
});
