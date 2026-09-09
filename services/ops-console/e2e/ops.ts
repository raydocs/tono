import type { Page } from '@playwright/test';

export type FixtureSet = 'default' | 'dense' | 'empty' | 'error';

/**
 * Open a console page against one of the dev server's fixture sets. The set
 * travels as a query parameter because `src/lib/api.ts` forwards it to the
 * fixture middleware — one dev server, four data shapes.
 */
export async function open(
  page: Page,
  hash: string,
  fixtures: FixtureSet = 'default',
): Promise<void> {
  const query = fixtures === 'default' ? '' : `?fixtures=${fixtures}`;
  await page.goto(`/ops2/${query}#${hash}`, { waitUntil: 'networkidle' });
  await settle(page);
}

/**
 * Wait for the things that would otherwise make a baseline flake: webfonts
 * swapping in, and Recharts laying out its areas after first paint.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const sparks = page.locator('[data-spark] svg path');
  if (await sparks.count() > 0) await sparks.first().waitFor({ state: 'attached' });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}
