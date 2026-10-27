import { expect, test, type Page } from '@playwright/test';
import { liveRoom } from '../helpers/oracle';
import {
  E2E_GAME_CONFIG,
  joinPhone,
  openLobby,
  shot,
  startE2eServer,
  tvPage,
  type E2eServer,
} from './helpers';

/**
 * The show: staged reveal, streak flames, last-seconds urgency, score bars and the podium
 * (docs/VISUAL_QA.md "Show motion"). Screenshots of the key moments land in test-results/screenshots;
 * the assertions are measurements, not baselines: what must be on screen at which moment, that TV
 * text stays inside the 5% safe area while everything moves, that reduced motion keeps the
 * information but drops the movement, and that a 4x slower CPU still paints frames.
 */
let env: E2eServer;
test.beforeAll(async () => {
  // A longer score screen: the shots and measurements of a round take a few seconds of real time.
  env = await startE2eServer({
    ...E2E_GAME_CONFIG,
    timings: { ...E2E_GAME_CONFIG.timings, scoreUpdateMs: 10_000 },
  });
});
test.afterAll(async () => {
  await env.server.dispose();
});

/** Text boxes (not decorations) that leave the central 90% of the stage. */
async function outsideSafeArea(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const bad: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest('[aria-hidden="true"], .qp-deco, .qp-sr-only'))
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (
        r.left < w * 0.05 - 2 ||
        r.right > w * 0.95 + 2 ||
        r.top < h * 0.05 - 2 ||
        r.bottom > h * 0.95 + 2
      )
        bad.push(
          `${text.slice(0, 30)} @ ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`,
        );
    }
    return bad;
  });
}

/** Frame gaps (ms) between animation frames while `run` executes; a stand-in for dropped frames on a weak TV. */
async function frameGaps(page: Page, run: () => Promise<void>): Promise<number[]> {
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __stop: boolean };
    w.__gaps = [];
    w.__stop = false;
    let last = performance.now();
    const tick = (now: number): void => {
      w.__gaps.push(now - last);
      last = now;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await run();
  return page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __stop: boolean };
    w.__stop = true;
    return w.__gaps;
  });
}

/**
 * Screenshots of a moving screen are timed by the machine, not by the show. Freezing every running
 * animation at `ms` (the Web Animations API covers CSS animations and transitions) gives the same
 * frame on every run: how the screen looks that many ms into its choreography.
 */
async function freezeAt(page: Page, ms: number): Promise<void> {
  await page.evaluate((time) => {
    for (const animation of document.getAnimations()) {
      try {
        animation.pause();
        animation.currentTime = time;
      } catch {
        // an animation that cannot be seeked is left alone
      }
    }
  }, ms);
}

async function thaw(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      try {
        animation.play();
      } catch {
        // ignore
      }
    }
  });
}

const percentile = (values: number[], p: number): number =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ??
  0;

test('a full game: staged reveal, flames, urgency, bars, podium (screenshots + measurements)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const ece = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  await freezeAt(tv.page, 320); // mid-pop of the arrival
  await shot(tv.page, 'show-01-lobby-arrival');
  await thaw(tv.page);
  const ahmet = await joinPhone(browser, env.url, code, 'Ahmet', 'cool');
  const merve = await joinPhone(browser, env.url, code, 'Merve', 'frog');
  const phones = [ece, ahmet, merve];
  await expect(tv.page.getByTestId('lobby-players')).toContainText('Merve');
  await tv.page.waitForTimeout(900);
  expect(await outsideSafeArea(tv.page)).toEqual([]);

  await ece.page.getByTestId('ctl-start').click();
  await expect(tv.page.getByTestId('tv-countdown')).toBeVisible();
  await tv.page.waitForTimeout(350);
  await shot(tv.page, 'show-02-countdown');

  const room = env.server.built.manager.getByCode(code)!;
  for (let round = 0; round < 3; round++) {
    await Promise.all(
      phones.map((phone) => expect(phone.page.getByTestId('ctl-answering')).toBeVisible()),
    );
    const question = room.state.game!.round!.question!;
    const correct = question.options.findIndex((option) => option.correct);
    const wrong = (correct + 1) % question.options.length;
    await ece.page.locator(`[data-answer-index="${correct}"]`).click();
    await ahmet.page.locator(`[data-answer-index="${wrong}"]`).click();
    if (round === 0) {
      await tv.page.waitForTimeout(150);
      await shot(ece.page, 'show-03-phone-locked');
    }
    // Merve waits for the last seconds so the urgency state can be measured and photographed.
    if (round === 1) {
      await tv.page.locator('[role="timer"][data-urgent="true"]').waitFor({ timeout: 12_000 });
      // measured first: the urgent window is only three seconds and a screenshot takes a while
      await expect(tv.page.locator('[data-active="true"]').first()).toBeAttached();
      expect(await outsideSafeArea(tv.page)).toEqual([]);
      await shot(tv.page, 'show-04-tv-urgent');
      await shot(merve.page, 'show-05-phone-urgent');
    }
    // (in round 1 Merve never answers: the clock runs out, which is what the urgency shots need)
    if (round !== 1) await merve.page.locator(`[data-answer-index="${correct}"]`).click();

    // The reveal: roll, wrong options dim one by one, then the right card lights up.
    await tv.page.locator('[data-reveal="correct"]').waitFor();
    if (round === 0) {
      await freezeAt(tv.page, 300);
      await shot(tv.page, 'show-06-reveal-roll');
      await freezeAt(ece.page, 300);
      await shot(ece.page, 'show-07-phone-reveal-roll');
      await freezeAt(tv.page, 800);
      await shot(tv.page, 'show-08-reveal-dimming');
      await freezeAt(tv.page, 1450);
      await shot(tv.page, 'show-09-reveal-hit');
      await freezeAt(ece.page, 1500);
      await shot(ece.page, 'show-10-phone-reveal-hit');
      await freezeAt(tv.page, 2200);
      await shot(tv.page, 'show-10b-reveal-faces-explanation');
      await thaw(tv.page);
      await thaw(ece.page);
    }
    if (round >= 1) {
      await expect(tv.page.getByTestId('streak-flame').first()).toBeVisible();
      // the flame shows from a streak of 2; the TV's combo corner from 3 (the third question)
      if (round === 2) await expect(tv.page.getByTestId('tv-combos')).toBeVisible();
      else await expect(tv.page.getByTestId('tv-combos')).toHaveCount(0);
      expect(await outsideSafeArea(tv.page)).toEqual([]);
      await freezeAt(tv.page, 2200);
      await shot(tv.page, `show-11-reveal-streak-r${round}`);
      await freezeAt(ece.page, 2400);
      await shot(ece.page, `show-12-phone-streak-r${round}`);
      await thaw(tv.page);
      await thaw(ece.page);
      // the phone's combo toast comes with the reveal (a streak of 2+); its header flame follows the board,
      // which counts the streak when the score screen starts, so it is there from the next question on
      await expect(ece.page.getByTestId('combo-toast')).toBeVisible();
      if (round === 2)
        await expect(
          ece.page.getByTestId('phone-score').locator('..').getByTestId('streak-flame'),
        ).toBeVisible();
    }

    await expect(tv.page.getByTestId('tv-score')).toBeVisible();
    await expect(tv.page.getByTestId('score-bar').first()).toBeAttached();
    await freezeAt(tv.page, 700);
    await shot(tv.page, `show-13-score-r${round}-bars`);
    await thaw(tv.page);
    await tv.page.waitForTimeout(1900);
    await shot(tv.page, `show-14-score-r${round}-settled`);
    expect(await outsideSafeArea(tv.page)).toEqual([]);
  }

  await expect(tv.page.getByTestId('tv-results')).toBeVisible();
  await freezeAt(tv.page, 700);
  await shot(tv.page, 'show-15-podium-third');
  await freezeAt(tv.page, 1500);
  await shot(tv.page, 'show-16-podium-second');
  await freezeAt(tv.page, 2900);
  await shot(tv.page, 'show-17-podium-winner');
  await freezeAt(tv.page, 4500);
  await shot(tv.page, 'show-18-podium-settled');
  await thaw(tv.page);
  await tv.page.waitForTimeout(1500);
  expect(await outsideSafeArea(tv.page)).toEqual([]);
  expect(liveRoom(env.server, room.id).state.phase).toBe('RESULTS');
  await shot(ece.page, 'show-19-phone-results');

  for (const screen of [tv, ...phones]) await screen.context.close();
});

test('reduced motion keeps the information and drops the movement', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'tr-TR',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(`${env.url}/tv`);
  await page.getByTestId('tv-start').click();
  await page.getByTestId('lobby-code').waitFor();
  const code = (await page.getByTestId('lobby-code').innerText()).trim();
  const a = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  const b = await joinPhone(browser, env.url, code, 'Ahmet', 'cool');
  await a.page.getByTestId('ctl-start').click();
  const room = env.server.built.manager.getByCode(code)!;
  await a.page.getByTestId('ctl-answering').waitFor();
  const question = room.state.game!.round!.question!;
  const correct = question.options.findIndex((option) => option.correct);
  await a.page.locator(`[data-answer-index="${correct}"]`).click();
  await b.page.locator(`[data-answer-index="${(correct + 1) % question.options.length}"]`).click();
  await page.locator('[data-reveal="correct"]').waitFor();
  // collapsed animations: nothing is mid-flight a moment later, and the right answer is shown at once
  await page.waitForTimeout(1600);
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            (animation.effect?.getComputedTiming().iterations ?? 1) === Infinity,
        ).length,
  );
  expect(running).toBe(0);
  await expect(page.locator('[data-reveal="correct"]')).toBeVisible();
  expect(await outsideSafeArea(page)).toEqual([]);
  for (const screen of [a, b]) await screen.context.close();
  await context.close();
});

test('frames keep coming on a 4x slower CPU during a reveal', async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const a = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  const b = await joinPhone(browser, env.url, code, 'Ahmet', 'cool');
  const cdp = await tv.context.newCDPSession(tv.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await a.page.getByTestId('ctl-start').click();
  const room = env.server.built.manager.getByCode(code)!;
  await a.page.getByTestId('ctl-answering').waitFor();
  const question = room.state.game!.round!.question!;
  const correct = question.options.findIndex((option) => option.correct);
  const gaps = await frameGaps(tv.page, async () => {
    await a.page.locator(`[data-answer-index="${correct}"]`).click();
    await b.page
      .locator(`[data-answer-index="${(correct + 1) % question.options.length}"]`)
      .click();
    await tv.page.locator('[data-reveal="correct"]').waitFor();
    await tv.page.getByTestId('tv-score').waitFor();
    await tv.page.waitForTimeout(2200);
  });
  const p95 = percentile(gaps, 0.95);
  const worst = Math.max(...gaps);
  console.log(
    `4x CPU: ${gaps.length} frames, p50 ${percentile(gaps, 0.5).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, worst ${worst.toFixed(0)} ms`,
  );
  expect(gaps.length).toBeGreaterThan(40);
  expect(p95).toBeLessThan(160);
  for (const screen of [a, b, tv]) await screen.context.close();
});
