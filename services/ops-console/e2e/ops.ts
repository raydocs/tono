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
  session?: string,
): Promise<void> {
  const params = new URLSearchParams();
  if (fixtures !== 'default') params.set('fixtures', fixtures);
  // A test that writes asks for its own copy of the mutable store, so an ack
  // in the light project cannot change what the dark project screenshots.
  if (session) params.set('session', session);
  const query = params.toString();
  await page.goto(`/ops2/${query ? `?${query}` : ''}#${hash}`, { waitUntil: 'networkidle' });
  await settle(page);
}

/**
 * Wait for the things that would otherwise make a baseline flake: webfonts
 * swapping in, and the day bars taking their height from the layout.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const sparks = page.locator('[data-spark] .spark-bar');
  if (await sparks.count() > 0) await sparks.first().waitFor({ state: 'attached' });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}
