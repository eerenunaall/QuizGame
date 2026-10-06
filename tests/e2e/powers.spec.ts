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
 * Stakes, Double Down, 50/50, sabotage and the crowd reveal, as people see them: one TV, three
 * phones, real browsers. Screenshots of every power screen land in test-results/screenshots.
 */
const POWERS_TIMINGS = {
  ...PLAY_GAME_CONFIG.timings,
  prepQuickMs: 20_000,
  prepDecisionMs: 20_000,
  powerResolutionMs: 3500,
  powerResolutionPerItemMs: 700,
  powerResolutionMaxMs: 8000,
  revealMs: 1800,
  // Longer than the slowest poll interval of an auto-retrying assertion (1 s), so a phase that is
  // only asserted on can never fall between two polls.
  scoreUpdateMs: 1600,
};

/** No random special rounds: these scenarios are about powers, and must not depend on a dice roll. */
const PLAIN = { maxSpeedRounds: 0, maxCrowdRounds: 0, maxRiskRounds: 0 };

const tr = catalogs.tr;
let env: E2eServer;
test.afterEach(async () => {
  await env.server.dispose();
});

const answerOf = (code: string) => {
  const question = env.server.built.manager.getByCode(code)!.state.game!.round!.question!;
  const right = question.options.find((option) => option.correct)!;
  const wrong = question.options.find((option) => !option.correct)!;
  return { right: right.text, wrong: wrong.text };
};

const option = (page: Page, text: string) =>
  page.locator('button[data-answer-index]').filter({ hasText: text });

async function lobby(browser: Parameters<typeof tvPage>[0], names = ['Ece', 'Ahmet', 'Merve']) {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const avatars = ['cat', 'cool', 'frog'];
  const phones: Screen[] = [];
  for (const [index, name] of names.entries())
    phones.push(await joinPhone(browser, env.url, code, name, avatars[index]!));
  return { tv, code, phones };
}

const ready = (phone: Screen, stake?: 'SAFE' | 'RISK' | 'HIGH' | 'ALL_IN') =>
  stake
    ? phone.page
        .getByTestId(`stake-${stake}`)
        .click()
        .then(() => phone.page.getByTestId('prep-ready').click())
    : phone.page.getByTestId('prep-ready').click();

test('stakes, double down and 50/50 play out, and the last question demands a stake', async ({
  browser,
}) => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    defaultRounds: 5,
    timings: POWERS_TIMINGS,
    director: PLAIN,
  });
  const { tv, code, phones } = await lobby(browser);
  const [ece, ahmet, merve] = phones as [Screen, Screen, Screen];
  await ece.page.getByTestId('ctl-start').click();

  // ── Round 1: Ece goes HIGH and doubles down; the others stay safe.
  await expect(ece.page.getByTestId('ctl-prep')).toBeVisible();
  await expect(tv.page.getByTestId('tv-ladder')).toBeVisible();
  await expect(ece.page.getByTestId('stake-SAFE')).toHaveAttribute('aria-checked', 'true');
  await ece.page.getByTestId('stake-HIGH').click();
  await ece.page.getByTestId('prep-double-down').click();
  await expect(ece.page.getByTestId('prep-double-down')).toHaveAttribute('aria-pressed', 'true');
  await shot(ece.page, '30-phone-prep');
  await ece.page.getByTestId('prep-ready').click();
  await expect(ece.page.getByTestId('ctl-prep-committed')).toBeVisible();
  await expect(tv.page.getByTestId('tv-prep-ready')).toHaveText('1/3 hazır');
  await shot(ece.page, '31-phone-prep-committed');
  await shot(tv.page, '32-tv-prep');
  // Choices are private: nobody else's phone shows them.
  await expect(ahmet.page.getByTestId('ctl-prep-committed')).toHaveCount(0);
  await ready(ahmet);
  await ready(merve);

  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
  const first = answerOf(code);
  await option(ece.page, first.right).click();
  await option(ahmet.page, first.wrong).click();
  await option(merve.page, first.right).click();

  await expect(tv.page.getByTestId('tv-power')).toBeVisible();
  await expect(tv.page.getByTestId('power-item')).toHaveCount(2); // her stake and her double
  await expect(tv.page.getByTestId('tv-power')).toContainText('Ece Yüksek oynadı');
  await expect(tv.page.getByTestId('tv-power')).toContainText('Ece ÇİFTE yaptı');
  await tv.page.waitForTimeout(1800);
  await shot(tv.page, '33-tv-power');

  // ── Round 2: Ahmet uses his 50/50. (The next prep is the lasting proof that the score screen
  // came and went; asserting on the score itself after a sleep and a screenshot would race it.)
  await expect(ahmet.page.getByTestId('ctl-prep')).toBeVisible();
  for (const phone of phones) await ready(phone);
  await expect(ahmet.page.getByTestId('ctl-answering')).toBeVisible();
  await ahmet.page.getByTestId('use-fifty').click();
  await expect(ahmet.page.getByTestId('fifty-used')).toBeVisible();
  await expect(ahmet.page.locator('[data-removed="true"]')).toHaveCount(2);
  await shot(ahmet.page, '34-phone-fifty');
  const second = answerOf(code);
  await option(ahmet.page, second.right).click();
  await option(ece.page, second.right).click();
  await option(merve.page, second.right).click();
  await expect(tv.page.getByTestId('tv-power')).toContainText('Ahmet 50/50 kullandı');
  await expect(tv.page.getByTestId('tv-score')).toBeVisible();

  // ── Rounds 3 and 4: everyone answers; nothing special.
  for (let round = 2; round < 4; round++) {
    await expect(ece.page.getByTestId('ctl-prep')).toBeVisible();
    for (const phone of phones) await ready(phone);
    await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
    const pick = answerOf(code);
    for (const phone of phones) await option(phone.page, pick.right).click();
    await expect(tv.page.getByTestId('tv-score')).toBeVisible();
  }

  // ── The very last question: no safe rung, a stake is a must.
  await expect(ece.page.getByTestId('ctl-prep')).toBeVisible();
  await expect(ece.page.getByTestId('stake-SAFE')).toHaveCount(0);
  await expect(ece.page.getByTestId('stake-RISK')).toHaveAttribute('aria-checked', 'true');
  await expect(ece.page.getByText(tr['ctl.prep.mandatory'])).toBeVisible();
  await expect(tv.page.getByTestId('tv-prep')).toContainText(tr['tv.prep.mandatory']);
  await shot(ece.page, '35-phone-prep-final');
  await shot(tv.page, '36-tv-prep-final');
  for (const phone of phones) await ready(phone, 'ALL_IN');
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
  const last = answerOf(code);
  for (const phone of phones) await option(phone.page, last.right).click();
  await expect(tv.page.getByTestId('tv-results')).toBeVisible();
  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});

test('a sabotage the shield blocks, then one that lands on the target and nobody else', async ({
  browser,
}) => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    defaultRounds: 6,
    timings: POWERS_TIMINGS,
    director: PLAIN,
    powers: {
      sabotage: { startTokens: 2, maxTokens: 2, attackerCooldownRounds: 0, targetMinGapRounds: 0 },
    },
  });
  const { tv, code, phones } = await lobby(browser);
  const [ece, ahmet, merve] = phones as [Screen, Screen, Screen];
  await ece.page.getByTestId('ctl-start').click();

  // Rounds 1 and 2 are plain: sabotage opens at round 3.
  for (let round = 0; round < 2; round++) {
    await expect(ece.page.getByTestId('ctl-prep')).toBeVisible();
    await expect(ece.page.getByTestId('prep-sabotage')).toHaveCount(0);
    for (const phone of phones) await ready(phone);
    await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
    const pick = answerOf(code);
    for (const phone of phones) await option(phone.page, pick.right).click();
    await expect(tv.page.getByTestId('tv-score')).toBeVisible();
  }

  // ── Round 3: Merve sabotages Ece (SHUFFLE). Ece's shield blocks it.
  await expect(merve.page.getByTestId('prep-sabotage')).toBeVisible();
  await merve.page.getByTestId('prep-sabotage').click();
  await shot(merve.page, '37-phone-sabotage-who');
  await merve.page.getByTestId('sabotage-target-Ece').click();
  await shot(merve.page, '38-phone-sabotage-what');
  await merve.page.getByTestId('sabotage-effect-SHUFFLE').click();
  await expect(merve.page.getByTestId('prep-sabotage')).toContainText('Karıştır → Ece');
  await merve.page.getByTestId('prep-ready').click();
  await ready(ece);
  await ready(ahmet);
  await expect(ece.page.getByTestId('hit-notices')).toContainText('Kalkanın engelledi');
  await expect(ahmet.page.getByTestId('hit-notices')).toHaveCount(0); // nobody else is told
  await shot(ece.page, '39-phone-hit-blocked');
  const third = answerOf(code);
  for (const phone of phones) await option(phone.page, third.right).click();
  await expect(tv.page.getByTestId('tv-power')).toBeVisible();
  await expect(tv.page.locator('[data-kind="SABOTAGE"][data-blocked="true"]')).toHaveCount(1);
  await expect(tv.page.getByTestId('tv-power')).toContainText(tr['tv.power.blocked']);
  await tv.page.waitForTimeout(1500);
  await shot(tv.page, '40-tv-power-blocked');

  // ── Round 4: Ahmet sabotages Ece again (JAM): the shield is gone, so it lands.
  await expect(ahmet.page.getByTestId('prep-sabotage')).toBeVisible();
  await ahmet.page.getByTestId('prep-sabotage').click();
  await ahmet.page.getByTestId('sabotage-target-Ece').click();
  await ahmet.page.getByTestId('sabotage-effect-JAM').click();
  await ahmet.page.getByTestId('prep-ready').click();
  await ready(ece);
  await ready(merve);
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
  await expect(ece.page.getByTestId('hit-notices')).toContainText('Süren');
  await expect(merve.page.getByTestId('hit-notices')).toHaveCount(0);
  await shot(ece.page, '41-phone-jam');
  const fourth = answerOf(code);
  for (const phone of phones) await option(phone.page, fourth.right).click();
  await expect(tv.page.locator('[data-kind="SABOTAGE"][data-blocked="false"]')).toHaveCount(1);
  await expect(tv.page.getByTestId('tv-score')).toBeVisible();
  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});

test('a shuffle and a fog change what the target sees, and only the target', async ({
  browser,
}) => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    defaultRounds: 6,
    timings: { ...POWERS_TIMINGS, readMinMs: 300 },
    director: PLAIN,
    powers: {
      shieldPerGame: 0,
      sabotage: {
        startTokens: 2,
        maxTokens: 2,
        attackerCooldownRounds: 0,
        targetMinGapRounds: 0,
        fogMs: 2500,
      },
    },
  });
  const { tv, code, phones } = await lobby(browser);
  const [ece, , merve] = phones as [Screen, Screen, Screen];
  await ece.page.getByTestId('ctl-start').click();
  for (let round = 0; round < 2; round++) {
    for (const phone of phones) await ready(phone);
    await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
    const pick = answerOf(code);
    for (const phone of phones) await option(phone.page, pick.right).click();
    await expect(tv.page.getByTestId('tv-score')).toBeVisible();
  }

  // Round 3: Merve shuffles Ece's options.
  await merve.page.getByTestId('prep-sabotage').click();
  await merve.page.getByTestId('sabotage-target-Ece').click();
  await merve.page.getByTestId('sabotage-effect-SHUFFLE').click();
  await merve.page.getByTestId('prep-ready').click();
  await ready(ece);
  await ready(phones[1]!);
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
  await expect(ece.page.getByTestId('hit-notices')).toContainText('karıştı');
  const texts = async (page: Page) => page.locator('button[data-answer-index]').allInnerTexts();
  const mine = (await texts(ece.page)).map((text) => text.replace(/^[A-D]\s*/u, '').trim());
  const theirs = (await texts(merve.page)).map((text) => text.replace(/^[A-D]\s*/u, '').trim());
  expect([...mine].sort()).toEqual([...theirs].sort()); // the same options
  expect(mine).not.toEqual(theirs); // in a different order
  await shot(ece.page, '42-phone-shuffled');
  const third = answerOf(code);
  for (const phone of phones) await option(phone.page, third.right).click();
  await expect(tv.page.getByTestId('tv-score')).toBeVisible();

  // Round 4: Merve fogs Ece: one option is hidden at first, then comes back.
  await merve.page.getByTestId('prep-sabotage').click();
  await merve.page.getByTestId('sabotage-target-Ece').click();
  await merve.page.getByTestId('sabotage-effect-FOG').click();
  await merve.page.getByTestId('prep-ready').click();
  await ready(ece);
  await ready(phones[1]!);
  await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
  await expect(ece.page.locator('button[data-answer-index]', { hasText: '• • •' })).toHaveCount(1);
  await shot(ece.page, '43-phone-fog');
  await expect(ece.page.locator('button[data-answer-index]', { hasText: '• • •' })).toHaveCount(0, {
    timeout: 6000,
  });
  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});

test('a crowd round shows what share of the room chose each answer', async ({ browser }) => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    defaultRounds: 5,
    timings: { ...POWERS_TIMINGS, revealMs: 4000 },
    director: {
      specialBasePermille: 1000,
      specialMaxPermille: 1000,
      maxSpeedRounds: 0,
      maxRiskRounds: 0,
      maxCrowdRounds: 3,
    },
  });
  const { tv, code, phones } = await lobby(browser);
  const [ece, ahmet, merve] = phones as [Screen, Screen, Screen];
  await ece.page.getByTestId('ctl-start').click();

  let crowdSeen = false;
  for (let round = 0; round < 5 && !crowdSeen; round++) {
    await expect(ece.page.getByTestId('ctl-prep')).toBeVisible();
    const kind = env.server.built.manager.getByCode(code)!.state.game!.round!.kind;
    for (const phone of phones) await ready(phone);
    await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
    const pick = answerOf(code);
    await option(ece.page, pick.right).click();
    await option(ahmet.page, pick.right).click();
    await option(merve.page, pick.wrong).click();
    if (kind === 'CROWD') {
      await expect(tv.page.getByTestId('crowd-percent').first()).toBeVisible();
      const shares = await tv.page.getByTestId('crowd-percent').allInnerTexts();
      expect(shares).toHaveLength(4);
      expect(shares.filter((text) => text === '67%')).toHaveLength(1);
      expect(shares.filter((text) => text === '33%')).toHaveLength(1);
      await expect(tv.page.getByTestId('tv-status')).toContainText(tr['game.crowd.right']);
      await tv.page.waitForTimeout(1200);
      await shot(tv.page, '44-tv-crowd');
      crowdSeen = true;
    } else {
      await expect(tv.page.getByTestId('tv-score')).toBeVisible();
    }
  }
  expect(crowdSeen).toBe(true);
  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});
