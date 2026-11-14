import { expect, test, type Page } from '@playwright/test';
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
 * ADR-0023 end to end, as people see it: one risk (an opt-in Duel, with the invite on the rival's
 * phone and the result on the TV) and one sabotage (Blind Clock, hiding a phone's countdown).
 */
const tr = catalogs.tr;
let env: E2eServer;
test.afterEach(async () => {
  await env.server.dispose();
});

const TIMINGS = {
  ...PLAY_GAME_CONFIG.timings,
  riskPickMs: 20_000,
  sabotagePickMs: 20_000,
  riskPickDecisionMs: 20_000,
  powerResolutionMs: 3500,
  powerResolutionPerItemMs: 700,
  powerResolutionMaxMs: 8000,
  revealMs: 1800,
  // Longer than the slowest poll of an auto-retrying assertion, so a phase asserted on cannot fall between two polls.
  scoreUpdateMs: 1600,
};
const PLAIN = { maxSpeedRounds: 0, maxCrowdRounds: 0, maxRiskRounds: 0 };

const NAMES = ['Ece', 'Ahmet', 'Merve'];
// The question exists only once the room is in ANSWERING; a slow machine reaches it later than the
// phones' last click, so wait for the server's own state rather than reading it blind.
const answerOf = async (code: string) => {
  const room = env.server.built.manager.getByCode(code)!;
  await expect.poll(() => room.state.phase).toBe('ANSWERING');
  const question = room.state.game!.round!.question!;
  return {
    right: question.options.find((option) => option.correct)!.text,
    wrong: question.options.find((option) => !option.correct)!.text,
  };
};
const option = (page: Page, text: string) =>
  page.locator('button[data-answer-index]').filter({ hasText: text });

async function lobby(browser: Parameters<typeof tvPage>[0]) {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const phones: Screen[] = [];
  for (const [index, name] of NAMES.entries())
    phones.push(await joinPhone(browser, env.url, code, name, ['cat', 'cool', 'frog'][index]!));
  return { tv, code, phones: phones as [Screen, Screen, Screen] };
}

test('a Duel: the rival gets the invite, accepts, and the TV shows who took the 80', async ({
  browser,
}) => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    defaultRounds: 4,
    timings: TIMINGS,
    director: PLAIN,
    powers: { shieldPerGame: 0 },
  });
  const { tv, code, phones } = await lobby(browser);
  const [ece, ahmet, merve] = phones;
  await ece.page.getByTestId('ctl-start').click();

  // ── Round 1: everybody plays safe and is right, so there is something to win and lose.
  for (const phone of phones) await phone.page.getByTestId('prep-ready').click();
  const first = await answerOf(code);
  for (const phone of phones) await option(phone.page, first.right).click();
  await expect(tv.page.getByTestId('tv-score')).toBeVisible();
  const before = Object.fromEntries(
    Object.entries(env.server.built.manager.getByCode(code)!.state.game!.players).map(
      ([id, player]) => [id, player.score],
    ),
  );

  // ── Round 2: Ece challenges Ahmet.
  await expect(ece.page.getByTestId('ctl-risk')).toBeVisible();
  await expect(ece.page.getByTestId('risk-duel')).toContainText(tr['risk.duel']);
  await expect(tv.page.getByTestId('tv-extra-duel')).toBeVisible(); // the TV lists the extras on offer
  await ece.page.getByTestId('stake-RISK').click();
  await ece.page.getByTestId('risk-duel').click();
  await ece.page.getByTestId('duel-rival-Ahmet').click();
  await expect(ece.page.getByTestId('risk-duel')).toContainText('Rakip: Ahmet');
  await shot(ece.page, '60-phone-duel-challenge');
  await ece.page.getByTestId('prep-ready').click();
  await expect(ece.page.getByTestId('chip-duel')).toContainText('Düello → Ahmet');

  // Only Ahmet is told.
  await expect(ahmet.page.getByTestId('duel-invite')).toContainText(
    'Ece sana Düello teklif ediyor!',
  );
  await expect(merve.page.getByTestId('duel-invite')).toHaveCount(0);
  await expect(tv.page.getByTestId('tv-risk')).not.toContainText('Düello teklif');
  await shot(ahmet.page, '61-phone-duel-invite');
  await merve.page.getByTestId('prep-ready').click();
  await ahmet.page.getByTestId('prep-ready').click();
  // Everyone has chosen, but Ahmet still owes an answer: the screen waits for him.
  await expect(tv.page.getByTestId('tv-risk')).toBeVisible();
  await ahmet.page.getByTestId('duel-accept').click();
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();

  const second = await answerOf(code);
  await option(ece.page, second.right).click();
  await option(ahmet.page, second.wrong).click();
  await option(merve.page, second.right).click();

  // The TV shows the duel, its winner and the points.
  await expect(tv.page.getByTestId('tv-power')).toBeVisible();
  const duel = tv.page.locator('[data-testid="power-item"][data-kind="DUEL"]');
  await expect(duel).toHaveCount(1);
  await expect(duel).toContainText('Ece 80 puan aldı');
  await expect(duel).toContainText('+80');
  await shot(tv.page, '62-tv-duel-result');

  await expect(tv.page.getByTestId('tv-score')).toBeVisible();
  const after = Object.fromEntries(
    Object.entries(env.server.built.manager.getByCode(code)!.state.game!.players).map(
      ([id, player]) => [id, player.score],
    ),
  );
  const ids = Object.keys(before);
  // Ahmet lost exactly the 80 (a wrong SAFE costs nothing else); the points moved, none were made.
  expect(after[ids[1]!]).toBe(before[ids[1]!]! - 80);

  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});

test('a declined Duel does nothing, and says so on the TV', async ({ browser }) => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    defaultRounds: 4,
    timings: TIMINGS,
    director: PLAIN,
    powers: { shieldPerGame: 0 },
  });
  const { tv, code, phones } = await lobby(browser);
  const [ece, ahmet, merve] = phones;
  await ece.page.getByTestId('ctl-start').click();
  for (const phone of phones) await phone.page.getByTestId('prep-ready').click();
  const first = await answerOf(code);
  for (const phone of phones) await option(phone.page, first.right).click();
  await expect(tv.page.getByTestId('tv-score')).toBeVisible();

  await expect(ece.page.getByTestId('ctl-risk')).toBeVisible();
  await ece.page.getByTestId('stake-RISK').click();
  await ece.page.getByTestId('risk-duel').click();
  await ece.page.getByTestId('duel-rival-Ahmet').click();
  await ece.page.getByTestId('prep-ready').click();
  await merve.page.getByTestId('prep-ready').click();
  await ahmet.page.getByTestId('duel-decline').click();
  await ahmet.page.getByTestId('prep-ready').click();
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
  const second = await answerOf(code);
  await option(ece.page, second.right).click();
  await option(ahmet.page, second.wrong).click();
  await option(merve.page, second.right).click();
  const duel = tv.page.locator('[data-testid="power-item"][data-kind="DUEL"]');
  await expect(duel).toContainText('Ahmet Düelloyu kabul etmedi');
  await expect(duel).not.toContainText('+80');

  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});

test('Blind Clock: the target’s countdown is gone from their phone, the TV names the hit', async ({
  browser,
}) => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    defaultRounds: 6,
    timings: TIMINGS,
    director: PLAIN,
    powers: { shieldPerGame: 0 },
  });
  const { tv, code, phones } = await lobby(browser);
  const [ece, ahmet, merve] = phones;
  await ece.page.getByTestId('ctl-start').click();
  const answerRound = async (): Promise<void> => {
    const { right } = await answerOf(code);
    for (const phone of phones) await option(phone.page, right).click();
    await expect(tv.page.getByTestId('tv-score')).toBeVisible();
  };

  // Rounds 1 and 2: sabotage is still closed.
  for (let round = 0; round < 2; round++) {
    await expect(ece.page.getByTestId('ctl-risk')).toBeVisible();
    for (const phone of phones) await phone.page.getByTestId('prep-ready').click();
    await answerRound();
  }

  // Round 3: Ece blinds Merve's clock.
  await expect(ece.page.getByTestId('ctl-risk')).toBeVisible();
  for (const phone of phones) await phone.page.getByTestId('prep-ready').click();
  await expect(ece.page.getByTestId('ctl-sabotage')).toBeVisible();
  await expect(tv.page.getByTestId('tv-sabotage')).toContainText(tr['sabotage.BLIND_CLOCK']);
  await ece.page.getByTestId('prep-sabotage').click();
  await ece.page.getByTestId('sabotage-target-Merve').click();
  await expect(ece.page.getByTestId('sabotage-effect-BLIND_CLOCK')).toContainText(
    tr['sabotage.BLIND_CLOCK.desc'],
  );
  await shot(ece.page, '63-phone-blind-clock-card');
  await ece.page.getByTestId('sabotage-effect-BLIND_CLOCK').click();
  await ece.page.getByTestId('sabotage-confirm').click();
  await expect(ece.page.getByTestId('ctl-sabotage-committed')).toBeVisible({ timeout: 8000 });
  await ahmet.page.getByTestId('sabotage-skip').click();
  await merve.page.getByTestId('sabotage-skip').click();

  await expect(merve.page.getByTestId('ctl-answering')).toBeVisible();
  await expect(merve.page.getByTestId('blind-clock')).toContainText('Saat gizli');
  await expect(merve.page.getByTestId('hit-notices')).toContainText('Saatin gizlendi');
  await shot(merve.page, '64-phone-blind-clock');
  // Everybody else still has a clock, and Merve can still answer.
  await expect(ece.page.getByTestId('blind-clock')).toHaveCount(0);
  await expect(ahmet.page.getByTestId('blind-clock')).toHaveCount(0);
  const { right } = await answerOf(code);
  await option(merve.page, right).click();
  await option(ece.page, right).click();
  await option(ahmet.page, right).click();

  await expect(tv.page.getByTestId('tv-power')).toBeVisible();
  const hit = tv.page.locator('[data-testid="power-item"][data-kind="SABOTAGE"]');
  await expect(hit).toContainText(tr['sabotage.BLIND_CLOCK']);
  await expect(hit).toContainText('Ece → Merve');
  await shot(tv.page, '65-tv-blind-clock');

  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});
