import { expect, test, type Page } from '@playwright/test';
import { open } from './ops';

/**
 * What the operator sees when the hub stops answering: one plain banner, the
 * last good rows still on screen, and never the login-expired wording for a
 * 502 from the edge. No screenshots; these are about wording and layout.
 */
const VIEWPORTS = [
  { name: 'desktop', size: { width: 1440, height: 900 } },
  { name: '390 px', size: { width: 390, height: 844 } },
] as const;

async function edgeDown(page: Page): Promise<void> {
  await page.route('**/api/v1/ops/**', (route) => route.fulfill({
    status: 502,
    contentType: 'text/html',
    body: '<html><body>502 Bad Gateway</body></html>',
  }));
}

/** The shell beats on a tab coming back, once the first load has settled for 5 s. */
async function beatNow(page: Page): Promise<void> {
  await page.waitForTimeout(5_200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

for (const { name, size } of VIEWPORTS) {
  test.describe(`backend unreachable at ${name}`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize(size); });

    test('keeps the rows on screen, says the data is old, and recovers on retry', async ({ page }) => {
      await open(page, '/nodes');
      const rows = page.locator('.nodes-table tbody tr');
      const before = await rows.count();
      expect(before).toBeGreaterThan(0);

      await edgeDown(page);
      await beatNow(page);

      const banner = page.getByRole('alert').filter({ hasText: '连不上后台' });
      await expect(banner).toBeVisible({ timeout: 15_000 });
      await expect(banner).toHaveText(/连不上后台 · 页面上的数据停在 \d\d:\d\d/);
      await expect(page.locator('body')).not.toContainText('登录已过期');
      await expect(rows).toHaveCount(before);

      const retry = banner.getByRole('button', { name: '重试' });
      if (name === '390 px') {
        const box = (await retry.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        const frame = (await banner.boundingBox())!;
        expect(frame.x + frame.width).toBeLessThanOrEqual(390);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      }

      await page.unroute('**/api/v1/ops/**');
      await retry.click();
      await expect(page.getByRole('alert').filter({ hasText: '连不上后台' })).toHaveCount(0);
      await expect(rows).toHaveCount(before);
    });

    test('a page opened while the edge answers 502 says the backend is down, not that the login expired', async ({ page }) => {
      await edgeDown(page);
      await open(page, '/nodes');

      await expect(page.getByRole('alert').filter({ hasText: '连不上后台' })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('登录已过期');
      await expect(page.locator('body')).not.toContainText('Failed to fetch');
    });
  });
}
