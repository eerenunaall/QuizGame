import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';

export const WEB_DIST = fileURLToPath(new URL('../../apps/web/dist', import.meta.url));
export const SHOTS = fileURLToPath(new URL('../../test-results/screenshots', import.meta.url));

/** Paced for a human-readable browser run: long enough for animations and screenshots, short enough to finish. */
export const E2E_GAME_CONFIG = {
  ...FAST_GAME_CONFIG,
  defaultRounds: 3,
  timings: {
    ...FAST_GAME_CONFIG.timings,
    countdownMs: 3200,
    roundIntroMs: 1400,
    prepMs: 900,
    readBaseMs: 1400,
    readMinMs: 1400,
    readMaxMs: 1400,
    answerMs: { STANDARD: 9000, SPEED: 9000, RISK: 9000, CROWD: 9000, FINAL: 9000 },
    // Long enough for a polling assertion (100-1000 ms steps) to see the "locked" screen.
    lockedMs: 1800,
    revealMs: 3200,
    // Reading time for the explanation card, like production (35 ms per character, at most 5 s).
    revealPerCharMs: 35,
    revealExplanationMaxMs: 5000,
    scoreUpdateMs: 3800,
    microIntermissionMs: 900,
    finalIntroMs: 2600,
    displayGraceMs: 30_000,
  },
};

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        address && typeof address === 'object'
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
    probe.on('error', reject);
  });
}

export interface E2eServer {
  server: TestServer;
  url: string;
}

/** Quick but human-usable pacing for behaviour tests (no screenshots): a long answer window, short pauses. */
export const PLAY_GAME_CONFIG = {
  ...FAST_GAME_CONFIG,
  defaultRounds: 3,
  timings: {
    ...FAST_GAME_CONFIG.timings,
    countdownMs: 500,
    roundIntroMs: 300,
    prepMs: 300,
    readBaseMs: 300,
    readMinMs: 300,
    readMaxMs: 300,
    answerMs: { STANDARD: 25_000, SPEED: 25_000, RISK: 25_000, CROWD: 25_000, FINAL: 25_000 },
    lockedMs: 300,
    revealMs: 700,
    scoreUpdateMs: 700,
    microIntermissionMs: 300,
    finalIntroMs: 500,
    displayGraceMs: 30_000,
  },
};

export async function startE2eServer(
  gameConfig: unknown = E2E_GAME_CONFIG,
  env: Record<string, string> = {},
): Promise<E2eServer> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = await startServer({
    port,
    gameConfig,
    env: {
      SERVE_WEB: '1',
      WEB_DIST,
      PUBLIC_WEB_URL: url,
      RATE_LIMIT_SCALE: '100',
      // Real browsers (several at once, headless, sharing one CPU) are slower than the raw-socket
      // test clients the default timeouts were tuned for.
      WS_AUTH_TIMEOUT_MS: '5000',
      LEASE_MS: '10000',
      HEARTBEAT_INTERVAL_MS: '1000',
      ...env,
    },
  });
  return { server, url };
}

export const TV_VIEWPORT = { width: 1920, height: 1080 } as const;
export const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
} as const;

export interface Screen {
  context: BrowserContext;
  page: Page;
}

export async function tvPage(
  browser: Browser,
  url: string,
  options: { locale?: string; search?: string } = {},
): Promise<Screen> {
  const context = await browser.newContext({
    viewport: TV_VIEWPORT,
    deviceScaleFactor: 1,
    locale: options.locale ?? 'tr-TR',
  });
  const page = await context.newPage();
  await page.goto(`${url}/tv${options.search ?? ''}`);
  await page.getByTestId('tv-start').waitFor();
  return { context, page };
}

export async function phonePage(
  browser: Browser,
  options: { locale?: string } = {},
): Promise<Screen> {
  const context = await browser.newContext({ ...PHONE, locale: options.locale ?? 'tr-TR' });
  return { context, page: await context.newPage() };
}

/** TV opens a room; resolves with its code once the lobby is on screen. */
export async function openLobby(tv: Screen): Promise<string> {
  await tv.page.getByTestId('tv-start').click();
  await tv.page.getByTestId('lobby-code').waitFor();
  return (await tv.page.getByTestId('lobby-code').innerText()).trim();
}

/** A phone in its own browser context joins `code` through the public join link. */
export async function joinPhone(
  browser: Browser,
  url: string,
  code: string,
  name: string,
  avatar: string,
  options: { locale?: string; search?: string } = {},
): Promise<Screen> {
  const phone = await phonePage(browser, options.locale ? { locale: options.locale } : {});
  await phone.page.goto(`${url}/join/${code}${options.search ?? ''}`);
  await phone.page.getByTestId('join-nickname').fill(name);
  await phone.page.getByTestId(`avatar-${avatar}`).click();
  await phone.page.getByTestId('join-submit').click();
  await phone.page.getByTestId('ctl-lobby').waitFor();
  return phone;
}

/** Decodes the QR code in a PNG screenshot (what a phone camera would read). */
export function decodeQr(png: Buffer): string | null {
  const image = PNG.sync.read(png);
  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ?? null;
}

export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}
