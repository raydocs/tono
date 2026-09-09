import { expect, test } from '@playwright/test';
import { open } from './ops';

/**
 * Not a baseline — this writes the two screenshots the package README and the
 * plan point at, so `docs/screenshots/` cannot drift from what the console
 * actually renders. Run with `npx playwright test e2e/docs.spec.ts`.
 */
test('capture the 节点 page for docs', async ({ page }, testInfo) => {
  await open(page, '/nodes');
  await expect(page.locator('.node-card').first()).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/nodes-${testInfo.project.name}.png` });
});
