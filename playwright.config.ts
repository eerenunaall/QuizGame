import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests drive the real web app against the real realtime server (started by the specs
 * themselves, serving the production build). Run `pnpm build:web` first. The sandbox's Chromium
 * lives at /opt/pw-browsers/chromium; elsewhere Playwright's own download is used.
 */
const sandboxChromium = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
