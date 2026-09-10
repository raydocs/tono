import { expect, test } from '@playwright/test';
import { open } from './ops';

/**
 * Not a baseline — this writes the screenshots the package README and the plan
 * point at, so `docs/screenshots/` cannot drift from what the console actually
 * renders. Run with `npx playwright test e2e/docs.spec.ts`.
 */
test('capture the 节点 page for docs', async ({ page }, testInfo) => {
  await open(page, '/nodes');
  await expect(page.locator('.node-card').first()).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/nodes-${testInfo.project.name}.png` });
});

test('capture the 今天 page for docs', async ({ page }, testInfo) => {
  await open(page, '/today');
  await expect(page.locator('.incident-row').first()).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/today-${testInfo.project.name}.png` });
});

test('capture the 客户 table for docs', async ({ page }, testInfo) => {
  await open(page, '/customers');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/customers-${testInfo.project.name}.png` });
});

test('capture the 客户端 page for docs', async ({ page }, testInfo) => {
  await open(page, '/clients');
  await expect(page.getByRole('heading', { name: '版本分布' })).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/clients-${testInfo.project.name}.png` });
});

test('capture the 客户 360 page for docs', async ({ page }, testInfo) => {
  await open(page, '/customers/u-04');
  await expect(page.getByRole('heading', { name: '连接时间线' })).toBeVisible();
  // `scale: 'css'` rather than the suite's 2x: this one is twelve thousand
  // pixels tall, and a retina copy of it is a four-megabyte file in every
  // clone for no extra legibility at the size anyone reads it.
  await page.screenshot({
    path: `docs/screenshots/customer-detail-${testInfo.project.name}.png`,
    fullPage: true,
    scale: 'css',
  });
});

/**
 * 设置 is six pages behind one rail, so the docs get six shots rather than one.
 * Light only: the plan's figures are printed, and a dark copy of each would
 * double the bytes in every clone for a picture nobody puts in a document.
 */
for (const section of ['alerts', 'providers', 'homelines', 'candidates', 'audit', 'catalog']) {
  test(`capture the 设置 ${section} section for docs`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'light', '设置 figures are light-only');
    await open(page, `/settings/${section}`);
    await expect(page.getByRole('navigation', { name: '设置' })).toBeVisible();
    await page.screenshot({ path: `docs/screenshots/settings-${section}.png` });
  });
}
