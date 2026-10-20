import { expect, test, type Page } from '@playwright/test';
import { catalogs } from '@quizparty/i18n';
import {
  PLAY_GAME_CONFIG,
  joinPhone,
  openLobby,
  startE2eServer,
  tvPage,
  type E2eServer,
  type Screen,
} from './helpers';

/**
 * The phone as a controller (owner play-test, ADR-0021 era): the question lives on the TV, answers are
 * big and thumb-high, a locked answer looks locked, sabotage is chip -> face -> card -> one button.
 * Every assertion is a measurement of the real page, so it cannot drift with fonts.
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
  answerMs: { STANDARD: 25_000, SPEED: 25_000, RISK: 25_000, CROWD: 25_000, FINAL: 25_000 },
  revealMs: 1800,
  scoreUpdateMs: 1600,
};
const PLAIN = { maxSpeedRounds: 0, maxCrowdRounds: 0, maxRiskRounds: 0 };

const currentQuestion = (code: string) =>
  env.server.built.manager.getByCode(code)!.state.game!.round!.question!;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

const boxes = (page: Page, selector: string): Promise<Box[]> =>
  page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    }),
  );

const viewportOf = (page: Page) =>
  page.evaluate(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
    scrollW: document.documentElement.scrollWidth,
  }));

for (const phoneSize of [
  { name: '360x740, gusto', viewport: { width: 360, height: 740 }, theme: 'gusto' },
  { name: '390x844, party', viewport: { width: 390, height: 844 }, theme: 'party' },
]) {
  test(`${phoneSize.name}: the question stays on the TV; the phone shows big answers, a hint and a switch`, async ({
    browser,
  }) => {
    env = await startE2eServer({ ...PLAY_GAME_CONFIG, defaultRounds: 3, timings: TIMINGS });
    const tv = await tvPage(browser, env.url);
    const code = await openLobby(tv);
    const search = `?theme=${phoneSize.theme}`;
    const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat', { search });
    const ahmet = await joinPhone(browser, env.url, code, 'Ahmet', 'frog');
    await ece.page.setViewportSize(phoneSize.viewport);
    await ece.page.getByTestId('ctl-start').click();
    await expect(ece.page.getByTestId('ctl-risk')).toBeVisible();
    await expect(ece.page.getByTestId('pick-title')).toHaveText(tr['tv.risk.title']);
    // Risk time: the question is not even chosen yet; the phone knows the category and nothing else.
    await expect(ece.page.getByTestId('peek-text')).toHaveCount(0);
    await ece.page.getByTestId('prep-ready').click();
    await ahmet.page.getByTestId('prep-ready').click();

    // ── answering
    await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
    const question = currentQuestion(code);
    await expect(tv.page.getByTestId('tv-question')).toContainText(question.text);
    await expect(ece.page.getByTestId('ctl-answering')).not.toContainText(question.text);
    await expect(ece.page.getByTestId('ctl-tv-hint')).toHaveText(tr['ctl.tvQuestion']);
    await expect(ece.page.getByTestId('peek-toggle')).toHaveText(tr['ctl.peek.show']);
    await expect(ece.page.getByTestId('peek-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(await ece.page.getByTestId('ctl-tv-hint').locator('svg[data-icon="tv"]').count()).toBe(
      1,
    );

    const view = await viewportOf(ece.page);
    expect(view.scrollW).toBeLessThanOrEqual(view.w); // no sideways scroll
    const answers = await boxes(ece.page, 'button[data-answer-index]');
    expect(answers).toHaveLength(4);
    for (const box of answers) {
      expect(box.height).toBeGreaterThanOrEqual(64);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(view.w);
      expect(box.bottom).toBeLessThanOrEqual(view.h);
    }
    // Thumb zone: the answers fill the lower part of the screen, the last one sits in the bottom third.
    const centre = (box: Box) => (box.top + box.bottom) / 2;
    expect(centre(answers[3]!)).toBeGreaterThan(view.h * (2 / 3));
    expect(centre(answers[0]!)).toBeGreaterThan(view.h * 0.3);
    // Colour, letter and shape on every card.
    const cues = await ece.page.locator('button[data-answer-index]').evaluateAll((els) =>
      els.map((el) => ({
        letter: el.getAttribute('aria-label')?.charAt(0),
        shape: el.querySelector('svg[data-shape]')?.getAttribute('data-shape'),
        background: getComputedStyle(el).backgroundImage,
      })),
    );
    expect(cues.map((cue) => cue.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(cues.map((cue) => cue.shape)).toEqual(['triangle', 'diamond', 'circle', 'square']);
    expect(new Set(cues.map((cue) => cue.background)).size).toBe(4);
    // The clock is a fat bar at the top of the screen.
    const [track] = await boxes(ece.page, '[role="timer"] > div');
    expect(track!.height).toBeGreaterThanOrEqual(18);
    expect(track!.top).toBeLessThan(answers[0]!.top);

    // ── the switch reveals the text in place, above the answers, and is remembered
    await ece.page.getByTestId('peek-toggle').click();
    await expect(ece.page.getByTestId('peek-text')).toHaveText(question.text);
    await expect(ece.page.getByTestId('peek-toggle')).toHaveText(tr['ctl.peek.hide']);
    await ece.page.reload();
    await expect(ece.page.getByTestId('peek-text')).toHaveText(question.text);

    // ── press and lock-in: the pick is framed with a lock, the rest cannot be tapped
    const right = question.options.find((option) => option.correct)!;
    await ece.page.locator('button[data-answer-index]').filter({ hasText: right.text }).click();
    await expect(ece.page.getByTestId('ctl-confirmed')).toBeVisible();
    await expect(ece.page.getByTestId('ctl-locked-banner')).toContainText(tr['ctl.answer.locked']);
    const picked = ece.page.locator('button[data-answer-index][aria-pressed="true"]');
    await expect(picked).toHaveCount(1);
    await expect(picked).toContainText(right.text);
    await expect(picked.locator('img[data-sticker="lock"]')).toHaveCount(1);
    await expect(ece.page.locator('button[data-answer-index]:not([disabled])')).toHaveCount(0);

    await ahmet.context.close();
    await ece.context.close();
    await tv.context.close();
  });
}

test('sabotage: a chip, two big faces, one card each, one button; undo within two seconds; long names fit', async ({
  browser,
}) => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    defaultRounds: 6,
    timings: TIMINGS,
    director: PLAIN,
    powers: {
      shieldPerGame: 0,
      sabotage: { startTokens: 2, maxTokens: 2, attackerCooldownRounds: 0, targetMinGapRounds: 0 },
    },
  });
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const names = ['Ece', 'WWWWWWWWWWWWWWWW', 'Şebnem Ğüneş'];
  const phones: Screen[] = [];
  for (const [index, name] of names.entries())
    phones.push(await joinPhone(browser, env.url, code, name, ['cat', 'cool', 'frog'][index]!));
  const [ece, , sebnem] = phones as [Screen, Screen, Screen];
  await ece.page.getByTestId('ctl-start').click();

  // Rounds 1 and 2: sabotage is closed, so its screen is skipped and the stakes screen leads
  // straight to the question.
  for (let round = 0; round < 2; round++) {
    await expect(ece.page.getByTestId('ctl-risk')).toBeVisible();
    await expect(ece.page.getByTestId('prep-sabotage')).toHaveCount(0); // never on the stakes screen
    for (const phone of phones) await phone.page.getByTestId('prep-ready').click();
    await expect(ece.page.getByTestId('ctl-answering')).toBeVisible();
    await expect(ece.page.getByTestId('ctl-sabotage')).toHaveCount(0);
    const right = currentQuestion(code).options.find((option) => option.correct)!;
    for (const phone of phones)
      await phone.page.locator('button[data-answer-index]').filter({ hasText: right.text }).click();
    await expect(tv.page.getByTestId('tv-score')).toBeVisible();
  }

  // Round 3: first the stakes screen (no sabotage on it), then the sabotage screen of its own.
  await expect(ece.page.getByTestId('ctl-risk')).toBeVisible();
  await ece.page.getByTestId('stake-RISK').click();
  for (const phone of phones) await phone.page.getByTestId('prep-ready').click();
  await expect(ece.page.getByTestId('ctl-sabotage')).toBeVisible();
  await expect(ece.page.getByTestId('pick-title')).toHaveText(tr['tv.sabotage.title']);
  await expect(ece.page.getByTestId('pick-rule')).toHaveText(tr['ctl.sabotage.rule']);
  await expect(ece.page.getByTestId('stake-SAFE')).toHaveCount(0);
  // Ece has two tokens. Chip -> face -> card -> button.
  const chip = ece.page.getByTestId('prep-sabotage');
  await expect(chip).toBeEnabled();
  await expect(chip).toContainText(tr['ctl.prep.sabotage']);
  await expect(chip).toContainText('2 jeton');
  const chipBox = (await boxes(ece.page, '[data-testid="prep-sabotage"]'))[0]!;
  const skipBox = (await boxes(ece.page, '[data-testid="sabotage-skip"]'))[0]!;
  expect(chipBox.height).toBeGreaterThanOrEqual(56);
  expect(skipBox.top).toBeGreaterThan(chipBox.bottom);
  const view = await viewportOf(ece.page);
  expect(skipBox.top).toBeGreaterThan(view.h * (2 / 3) - 60); // the action row is in the bottom third
  expect(skipBox.bottom).toBeLessThanOrEqual(view.h);

  await chip.click();
  await expect(ece.page.getByTestId('sabotage-sheet')).toHaveAttribute('data-step', 'who');
  const faces = await boxes(ece.page, '[data-testid^="sabotage-target-"]');
  expect(faces).toHaveLength(2);
  expect(Math.abs(faces[0]!.top - faces[1]!.top)).toBeLessThan(2); // two columns
  for (const face of faces) {
    expect(face.height).toBeGreaterThanOrEqual(100);
    expect(face.width).toBeGreaterThanOrEqual(120);
    expect(face.left).toBeGreaterThanOrEqual(0);
    expect(face.right).toBeLessThanOrEqual(view.w); // long names never push a column out
  }
  const nameBoxes = await boxes(ece.page, '[data-testid^="sabotage-target-"] > span');
  for (const [index, name] of nameBoxes.entries()) {
    expect(name.left).toBeGreaterThanOrEqual(faces[index]!.left);
    expect(name.right).toBeLessThanOrEqual(faces[index]!.right);
  }

  await ece.page.getByTestId('sabotage-target-Şebnem Ğüneş').click();
  await expect(ece.page.getByTestId('sabotage-sheet')).toHaveAttribute('data-step', 'what');
  for (const kind of ['JAM', 'SHUFFLE', 'FOG', 'LOCKOUT', 'POINT_TAX']) {
    const card = ece.page.getByTestId(`sabotage-effect-${kind}`);
    await expect(card).toContainText(tr[`sabotage.${kind}` as keyof typeof tr]);
    await expect(card).toContainText(tr[`sabotage.${kind}.desc` as keyof typeof tr]);
  }
  const confirm = ece.page.getByTestId('sabotage-confirm');
  await expect(confirm).toBeDisabled();
  await expect(ece.page.getByTestId('sabotage-why')).toHaveText(tr['ctl.prep.sabotage.pickEffect']);
  await ece.page.getByTestId('sabotage-effect-FOG').click();
  await expect(confirm).toBeEnabled();
  const confirmBox = (await boxes(ece.page, '[data-testid="sabotage-confirm"]'))[0]!;
  expect(confirmBox.height).toBeGreaterThanOrEqual(64);
  expect(confirmBox.bottom).toBeLessThanOrEqual(view.h);
  expect(confirmBox.top).toBeGreaterThan(view.h * 0.5); // the one button sits in the lower half

  // Send, then change your mind within two seconds.
  await confirm.click();
  await expect(ece.page.getByTestId('sabotage-sheet')).toHaveCount(0);
  await expect(ece.page.getByTestId('sabotage-going')).toContainText('Sis → Şebnem Ğüneş');
  await ece.page.getByTestId('sabotage-undo').click();
  await expect(ece.page.getByTestId('sabotage-going')).toHaveCount(0);
  await expect(ece.page.getByTestId('prep-sabotage')).toBeEnabled();
  await ece.page.waitForTimeout(2600);
  await expect(ece.page.getByTestId('ctl-sabotage-committed')).toHaveCount(0); // nothing went out

  // And once more for real: the commit follows by itself after the undo window.
  await ece.page.getByTestId('prep-sabotage').click();
  await ece.page.getByTestId('sabotage-target-Şebnem Ğüneş').click();
  await ece.page.getByTestId('sabotage-effect-JAM').click();
  await ece.page.getByTestId('sabotage-confirm').click();
  await expect(ece.page.getByTestId('ctl-sabotage-committed')).toBeVisible({ timeout: 8000 });
  await expect(ece.page.getByTestId('ctl-sabotage-committed')).toContainText(
    'Süre kes → Şebnem Ğüneş',
  );

  // The others pass; the target is hit and nobody else is told (no shield in this game).
  for (const phone of phones.slice(1)) await phone.page.getByTestId('sabotage-skip').click();
  await expect(sebnem.page.getByTestId('ctl-answering')).toBeVisible();
  await expect(sebnem.page.getByTestId('hit-notices')).toContainText('Süren');

  // The header keeps a long nickname inside the screen.
  const longName = (await boxes(phones[1]!.page, '[data-testid="phone-name"]'))[0]!;
  expect(longName.right).toBeLessThanOrEqual((await viewportOf(phones[1]!.page)).w);

  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});
