import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshot baselines only mean something if everything outside the code
 * under test is nailed down: the clock (`VITE_FAKE_NOW`, honoured by
 * `src/lib/clock.ts` in both the dev server and the page), the timezone, the
 * locale, the device pixel ratio, and motion. Change any of these and every
 * baseline has to be recaptured, so they live here and nowhere else.
 */
const FAKE_NOW = '1788895426'; // 2026-09-09 03:23:46 +08:00
const TIMEZONE = 'Asia/Shanghai';
const PORT = 5174;

const shared = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  timezoneId: TIMEZONE,
  locale: 'zh-CN',
  reducedMotion: 'reduce',
} as const;

export default defineConfig({
  testDir: 'e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFileName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002 },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...shared,
  },
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], ...shared, colorScheme: 'light' } },
    { name: 'dark', use: { ...devices['Desktop Chrome'], ...shared, colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'npm run dev:fixtures',
    url: `http://localhost:${PORT}/ops2/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { VITE_FAKE_NOW: FAKE_NOW, TZ: TIMEZONE },
  },
});
