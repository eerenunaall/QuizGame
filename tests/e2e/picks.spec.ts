import { expect, test } from '@playwright/test';
import { catalogs } from '@quizparty/i18n';
import {
  PLAY_GAME_CONFIG,
  joinPhone,
  openLobby,
  shot,
  startE2eServer,
  tvPage,
  type E2eServer,
  type Screen,
} from './helpers';

/**
 * RISK TIME and SABOTAGE TIME (ADR-0022): two separately timed screens on the TV and on every phone,
 * a loud title and a big ring on the TV, and "who has locked in" as a bare count in seating order,
 * never as names (ATTACK 27).
 */
const tr = catalogs.tr;
let env: E2eServer;
test.afterEach(async () => {
  await env.server.dispose();
});

const NAMES = ['Ece', 'Ahmet', 'Merve'];

test('risk time and sabotage time are two timed screens, with counts and no names', async ({
  browser,
}) => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    defaultRounds: 6,
    timings: {
      ...PLAY_GAME_CONFIG.timings,
      riskPickMs: 20_000,
      sabotagePickMs: 20_000,
      riskPickDecisionMs: 20_000,
      revealMs: 1800,
      scoreUpdateMs: 1600,
    },
    director: { maxSpeedRounds: 0, maxCrowdRounds: 0, maxRiskRounds: 0 },
    powers: { shieldPerGame: 0 },
  });
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const phones: Screen[] = [];
  for (const [index, name] of NAMES.entries())
    phones.push(await joinPhone(browser, env.url, code, name, ['cat', 'cool', 'frog'][index]!));
  const [ece, ahmet, merve] = phones as [Screen, Screen, Screen];
  await ece.page.getByTestId('ctl-start').click();
  const answerRound = async (): Promise<void> => {
    const question = env.server.built.manager.getByCode(code)!.state.game!.round!.question!;
    const right = question.options.find((option) => option.correct)!;
    for (const phone of phones)
      await phone.page.locator('button[data-answer-index]').filter({ hasText: right.text }).click();
    await expect(tv.page.getByTestId('tv-score')).toBeVisible();
  };

  // ── Round 1: RISK TIME alone. Sabotage is closed in the first rounds, so its screen never shows.
  await expect(tv.page.getByTestId('tv-risk')).toBeVisible();
  await expect(tv.page.getByTestId('tv-pick-title')).toHaveText('RİSK ZAMANI');
  await expect(tv.page.getByTestId('tv-pick-clock')).toBeVisible(); // the big ring
  await expect(tv.page.getByTestId('tv-risk')).toContainText(tr['tv.risk.rule']);
  await expect(tv.page.getByTestId('tv-prep-ready')).toHaveText('0/3 kilitledi');
  for (const phone of phones) {
    await expect(phone.page.getByTestId('ctl-risk')).toBeVisible();
    await expect(phone.page.getByTestId('pick-title')).toHaveText('RİSK ZAMANI');
    await expect(phone.page.getByTestId('prep-sabotage')).toHaveCount(0);
    await expect(phone.page.getByTestId('peek-text')).toHaveCount(0); // the question is on the TV
  }
  await shot(tv.page, '45-tv-risk-time');
  await shot(ece.page, '46-phone-risk-time');

  await ece.page.getByTestId('prep-ready').click();
  await expect(tv.page.getByTestId('tv-prep-ready')).toHaveText('1/3 kilitledi');
  await expect(tv.page.locator('[data-testid="tv-pick-progress"] [class*="tickOn"]')).toHaveCount(
    1,
  );
  const risk = (await tv.page.getByTestId('tv-risk').textContent()) ?? '';
  for (const name of NAMES) expect(risk).not.toContain(name);
  await ahmet.page.getByTestId('prep-ready').click();
  await merve.page.getByTestId('prep-ready').click();
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible(); // early advance, no sabotage screen
  await expect(tv.page.getByTestId('tv-sabotage')).toHaveCount(0);
  await answerRound();
  await expect(ece.page.getByTestId('ctl-risk')).toBeVisible();
  for (const phone of phones) await phone.page.getByTestId('prep-ready').click();
  await answerRound();

  // ── Round 3: RISK TIME, then SABOTAGE TIME as a screen of its own.
  await expect(ece.page.getByTestId('ctl-risk')).toBeVisible();
  for (const phone of phones) await phone.page.getByTestId('prep-ready').click();
  await expect(tv.page.getByTestId('tv-sabotage')).toBeVisible();
  await expect(tv.page.getByTestId('tv-pick-title')).toHaveText('SABOTAJ ZAMANI');
  await expect(tv.page.getByTestId('tv-pick-clock')).toBeVisible();
  await expect(tv.page.getByTestId('tv-sabotage')).toContainText(tr['tv.sabotage.rule']);
  for (const phone of phones) {
    await expect(phone.page.getByTestId('ctl-sabotage')).toBeVisible();
    await expect(phone.page.getByTestId('pick-title')).toHaveText('SABOTAJ ZAMANI');
    await expect(phone.page.getByTestId('stake-SAFE')).toHaveCount(0); // stakes had their own screen
  }
  await shot(tv.page, '47-tv-sabotage-time');
  await shot(ece.page, '48-phone-sabotage-time');

  // Ece hits Merve; the TV only learns that one more person is done.
  await ece.page.getByTestId('prep-sabotage').click();
  await ece.page.getByTestId('sabotage-target-Merve').click();
  await ece.page.getByTestId('sabotage-effect-JAM').click();
  await ece.page.getByTestId('sabotage-confirm').click();
  await expect(ece.page.getByTestId('ctl-sabotage-committed')).toBeVisible({ timeout: 8000 });
  await expect(tv.page.getByTestId('tv-prep-ready')).toHaveText('1/3 kilitledi');
  const sabotage = (await tv.page.getByTestId('tv-sabotage').textContent()) ?? '';
  for (const name of NAMES) expect(sabotage).not.toContain(name);
  // Nobody else's phone shows what Ece sent.
  await expect(merve.page.getByTestId('ctl-sabotage')).not.toContainText(tr['sabotage.JAM']);
  await ahmet.page.getByTestId('sabotage-skip').click();
  await merve.page.getByTestId('sabotage-skip').click(); // everyone who can act is done: on to the question
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
  await answerRound();

  // ── Round 4: Ece has spent her token. She gets a calm waiting screen and is not waited for.
  await expect(ece.page.getByTestId('ctl-risk')).toBeVisible();
  for (const phone of phones) await phone.page.getByTestId('prep-ready').click();
  await expect(ece.page.getByTestId('ctl-sabotage-wait')).toBeVisible();
  await expect(ece.page.getByTestId('sabotage-skip')).toHaveCount(0);
  await shot(ece.page, '49-phone-sabotage-wait');
  await ahmet.page.getByTestId('sabotage-skip').click();
  await merve.page.getByTestId('sabotage-skip').click();
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();

  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});

test('each screen ends by its own clock when nobody locks in', async ({ browser }) => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    defaultRounds: 6,
    timings: {
      ...PLAY_GAME_CONFIG.timings,
      riskPickMs: 1500,
      sabotagePickMs: 1500,
      riskPickDecisionMs: 1500,
      scoreUpdateMs: 1600,
    },
    director: { maxSpeedRounds: 0, maxCrowdRounds: 0, maxRiskRounds: 0 },
  });
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const phones: Screen[] = [];
  for (const [index, name] of NAMES.entries())
    phones.push(await joinPhone(browser, env.url, code, name, ['cat', 'cool', 'frog'][index]!));
  await phones[0]!.page.getByTestId('ctl-start').click();
  // Nobody touches anything: risk time, then (from round 3) sabotage time, then the question.
  await expect(tv.page.getByTestId('tv-risk')).toBeVisible();
  await expect(tv.page.getByTestId('tv-question')).toBeVisible({ timeout: 10_000 });
  const manager = env.server.built.manager.getByCode(code)!;
  await expect
    .poll(() => manager.state.game!.round!.index, { timeout: 60_000, intervals: [250] })
    .toBeGreaterThanOrEqual(2);
  await expect(tv.page.getByTestId('tv-sabotage')).toBeVisible({ timeout: 15_000 });
  await expect(tv.page.getByTestId('tv-question')).toBeVisible({ timeout: 10_000 });
  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});
