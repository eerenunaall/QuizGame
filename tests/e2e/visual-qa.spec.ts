import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';
import { catalogs } from '@quizparty/i18n';
import {
  PLAY_GAME_CONFIG,
  joinPhone,
  openLobby,
  phonePage,
  startE2eServer,
  tvPage,
  type E2eServer,
} from './helpers';

/**
 * Deterministic visual rules (docs/VISUAL_QA.md): TV text stays inside the 5% overscan-safe area, phone
 * controls are real tap targets and never overflow sideways, the first-time sentences are on screen,
 * the high-contrast stage is really black, and reduced motion is honoured. No baseline images: every
 * assertion is a measurement, so it cannot drift with fonts or machines.
 */
let env: E2eServer;
test.beforeAll(async () => {
  env = await startE2eServer(PLAY_GAME_CONFIG);
});
test.afterAll(async () => {
  await env.server.dispose();
});

/** Text nodes (not decorations) whose box leaves the central 90% of the viewport. */
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
      const tolerance = 2;
      if (
        r.left < w * 0.05 - tolerance ||
        r.right > w * 0.95 + tolerance ||
        r.top < h * 0.05 - tolerance ||
        r.bottom > h * 0.95 + tolerance
      )
        bad.push(
          `${text.slice(0, 30)} @ ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`,
        );
    }
    return bad;
  });
}

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
]) {
  test(`TV ${size.width}x${size.height}: first-time line, safe area on title and a full lobby`, async ({
    browser,
  }) => {
    for (const locale of ['tr-TR', 'en-US'] as const) {
      const context = await browser.newContext({ viewport: size, locale });
      const page = await context.newPage();
      await page.goto(`${env.url}/tv`);
      const catalog = catalogs[locale === 'tr-TR' ? 'tr' : 'en'];
      await expect(page.getByTestId('tv-first-time')).toHaveText(catalog['tv.menu.firstTime']);
      await page.waitForTimeout(800); // entrance animations
      expect(await outsideSafeArea(page)).toEqual([]);
      await context.close();
    }
  });
}

test('TV: a lobby of eight with long Turkish names stays inside the safe area', async ({
  browser,
}) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const names = [
    'Şebnem Ğüneş',
    'İsmail',
    'ışıl',
    'Çağlar Öztürk',
    'WWWWWWWWWWWWWWWW',
    'Ömer',
    'Ayşe Ü',
    'Yiğit',
  ];
  const phones = [];
  for (const name of names) phones.push(await joinPhone(browser, env.url, code, name, 'cat'));
  await expect(tv.page.getByTestId('lobby-players')).toContainText('Yiğit');
  await tv.page.waitForTimeout(800);
  expect(await outsideSafeArea(tv.page)).toEqual([]);
  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});

for (const phone of [
  { name: 'phone 390x844', viewport: { width: 390, height: 844 } },
  { name: 'phone 360x740', viewport: { width: 360, height: 740 } },
  { name: 'landscape 844x390', viewport: { width: 844, height: 390 } },
]) {
  test(`${phone.name}: join page has no sideways overflow and real tap targets`, async ({
    browser,
  }) => {
    const tv = await tvPage(browser, env.url);
    const code = await openLobby(tv);
    const screen = await phonePage(browser);
    await screen.page.setViewportSize(phone.viewport);
    await screen.page.goto(`${env.url}/join/${code}`);
    await expect(screen.page.getByTestId('join-howto')).toHaveText(catalogs.tr['join.howto']);
    const boxes = await screen.page.evaluate(() => {
      const rect = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width, height: r.height };
      };
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        avatars: [...document.querySelectorAll('[data-testid^="avatar-"]')].map(rect),
        submit: rect(document.querySelector('[data-testid="join-submit"]')!),
      };
    });
    expect(boxes.scrollWidth).toBeLessThanOrEqual(boxes.viewport);
    expect(boxes.avatars.length).toBeGreaterThan(0);
    for (const box of boxes.avatars) {
      expect(box.right).toBeLessThanOrEqual(boxes.viewport); // the sixth column used to be cut off
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
    expect(boxes.submit.height).toBeGreaterThanOrEqual(48);
    await screen.context.close();
    await tv.context.close();
  });
}

test('phone answer buttons are at least 48 px tall, also on a landscape phone', async ({
  browser,
}) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const a = await joinPhone(browser, env.url, code, 'Ece', 'cat');
  const b = await joinPhone(browser, env.url, code, 'Ahmet', 'frog');
  await a.page.setViewportSize({ width: 844, height: 390 });
  await a.page.getByTestId('ctl-start').click();
  await expect(a.page.getByTestId('ctl-answering')).toBeVisible();
  await b.page.getByTestId('ctl-answering').waitFor();
  const buttons = a.page.locator('button[data-answer-index]');
  await expect(buttons).toHaveCount(4);
  // The cards slide up while they enter; measure the layout they rest in (ambient loops never end, so skip them).
  await a.page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((x) => x.effect?.getComputedTiming().iterations !== Infinity)
        .map((x) => x.finished.catch(() => undefined)),
    ),
  );
  for (const box of await buttons.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { height: r.height, bottom: r.bottom, vh: window.innerHeight };
    }),
  )) {
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.bottom).toBeLessThanOrEqual(box.vh); // all four fit without scrolling in landscape
  }
  for (const screen of [a, b, tv]) await screen.context.close();
});

/** Mean RGB of a block of the stage background, read from a real screenshot. */
async function stageColour(page: Page): Promise<[number, number, number]> {
  const png = PNG.sync.read(
    await page.screenshot({ clip: { x: 20, y: 500, width: 40, height: 40 } }),
  );
  const sum = [0, 0, 0];
  for (let i = 0; i < png.data.length; i += 4)
    for (let c = 0; c < 3; c++) sum[c]! += png.data[i + c]!;
  const n = png.data.length / 4;
  return [sum[0]! / n, sum[1]! / n, sum[2]! / n];
}

test('themes: high-contrast stage is black, venue-gold is warm (not violet), reduced motion is honoured', async ({
  browser,
}) => {
  for (const theme of ['high-contrast', 'venue-gold'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto(`${env.url}/tv?theme=${theme}`);
    await page.getByTestId('tv-start').waitFor();
    await page.waitForTimeout(500);
    const [r, g, b] = await stageColour(page);
    if (theme === 'high-contrast') expect(Math.max(r, g, b)).toBeLessThan(14);
    else expect(r).toBeGreaterThanOrEqual(b); // the old violet beam made blue win
    await context.close();
  }

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(`${env.url}/tv`);
  await page.getByTestId('tv-start').waitFor();
  const duration = await page.evaluate(() => {
    const el = document.querySelector('img.qp-deco')!;
    return parseFloat(getComputedStyle(el).animationDuration);
  });
  expect(duration).toBeLessThan(0.001); // prefers-reduced-motion collapses every animation
  const low = await page.evaluate(() => {
    document.documentElement.dataset.motion = 'low';
    const el = document.querySelector('img.qp-deco')!;
    return getComputedStyle(el).animationName;
  });
  expect(low).toBe('none'); // data-motion='low' removes decorative animation outright
  await context.close();
});
