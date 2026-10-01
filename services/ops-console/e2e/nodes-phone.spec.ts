import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.use({ viewport: { width: 390, height: 844 } });

/**
 * Nine columns do not fit 390 px, and a table that scrolls sideways hides the
 * one column that matters. Three columns answer the same question in one
 * screen, and the list comes before the charts because it is what a phone
 * opens this page for.
 */
test('the fleet is a three column table at 390 px, ahead of the charts', async ({ page }) => {
  await open(page, '/nodes');

  await expect(page.locator('.nodes-table thead th')).toHaveCount(3);
  for (const header of ['状态', '节点', '本周期流量']) {
    await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
  }
  const table = await page.getByRole('heading', { name: '全部节点' }).boundingBox();
  const load = await page.getByRole('heading', { name: '机器负载' }).boundingBox();
  expect(table!.y).toBeLessThan(load!.y);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await settle(page);
  await expect(page).toHaveScreenshot('nodes.png');
});
