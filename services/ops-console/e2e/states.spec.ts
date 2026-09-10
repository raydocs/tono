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
  await expect(page.getByRole('button', { name: /台正常/ })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('0 台正常');
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

test('an empty customer list says so instead of showing a zero table', async ({ page }) => {
  await open(page, '/customers', 'empty');

  await expect(page.locator('tbody tr')).toHaveCount(0);
  // R2 reaches the headline: no customers measured means no count sentence.
  await expect(page.getByRole('button', { name: /位客户$/ })).toHaveCount(1);
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page).toHaveScreenshot('customers-empty.png');
});

test('a failing hub gives the customer table an error, not an empty state', async ({ page }) => {
  await open(page, '/customers', 'error');

  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('0 位客户');
  await expect(page).toHaveScreenshot('customers-error.png');
});

test('a failing hub gives 今天 an error, not a clear sky', async ({ page }) => {
  await open(page, '/today', 'error');

  // The one thing this page must never do is report calm it could not measure.
  await expect(page.locator('body')).not.toContainText('现在没有事故');
  await expect(page.locator('.incident-row')).toHaveCount(0);
  await expect(page).toHaveScreenshot('today-error.png');
});

test('the dense customer table truncates rather than reflows', async ({ page }) => {
  await open(page, '/customers', 'dense');

  expect(await page.locator('tbody tr').count()).toBeGreaterThan(40);
  await expect(page.locator('tbody tr').first()).toHaveCSS('height', '36px');
  await expect(page).toHaveScreenshot('customers-dense.png');
});
