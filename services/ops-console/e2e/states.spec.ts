import { expect, test } from '@playwright/test';
import { open } from './ops';

test('empty fleet says so instead of showing zero cards', async ({ page }) => {
  await open(page, '/nodes', 'empty');

  await expect(page.locator('.node-card')).toHaveCount(0);
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page).toHaveScreenshot('empty.png');
});

test('a failing hub is an error, not an empty list', async ({ page }) => {
  await open(page, '/nodes', 'error');

  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByText('数据源 未知')).toBeVisible();
  // R2: counts that were never measured must not be rendered as zero.
  await expect(page.getByRole('button', { name: /台在售/ })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('0 台在售');
  await expect(page).toHaveScreenshot('error.png');
});

test('dense fleet: long names truncate rather than reflow', async ({ page }) => {
  await open(page, '/nodes', 'dense');

  expect(await page.locator('.node-card').count()).toBeGreaterThan(40);
  await expect(page).toHaveScreenshot('dense-cards.png');

  await page.getByRole('button', { name: '表格' }).click();
  await expect(page.locator('tbody tr').first()).toHaveCSS('height', '36px');
  await expect(page).toHaveScreenshot('dense-table.png');
});
