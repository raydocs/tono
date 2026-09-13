import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.use({ viewport: { width: 390, height: 844 } });

/**
 * One card per screen at 390 px is a scroll through forty-five screens to
 * find the broken one. Three columns answer the same question in one.
 */
test('the fleet is a three column table at 390 px', async ({ page }) => {
  await open(page, '/nodes');

  await expect(page.locator('.node-card')).toHaveCount(0);
  await expect(page.locator('thead th')).toHaveCount(3);
  for (const header of ['状态', '节点', '本周期流量']) {
    await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
  }
  // The toggle is gone: there is nothing to toggle to.
  await expect(page.getByRole('button', { name: '卡片' })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await settle(page);
  await expect(page).toHaveScreenshot('nodes.png');
});
