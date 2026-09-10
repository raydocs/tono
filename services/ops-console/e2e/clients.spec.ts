import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.describe('clients page', () => {
  test('matrix and releases', async ({ page }) => {
    await open(page, '/clients');

    await expect(page.getByText('11 位在最新版 · 10 位落后 · 0 位未上报')).toBeVisible();
    // Three platforms have shipped nothing: every cell of those rows says so
    // in words rather than claiming nobody upgraded.
    await expect(page.getByText('未发布')).toHaveCount(12);
    await expect(page.getByRole('heading', { name: '版本分布' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '发布' })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('clients.png');
  });

  /**
   * R4 across two machines: the Worker counted the cell, the browser filters
   * the list, and a cell claiming five people that produces four rows is the
   * old "高丢包 2 / 高丢包 8" bug one page apart.
   */
  test('a cell hands over exactly the customers it counted', async ({ page }) => {
    await open(page, '/clients');
    const cell = page.locator('a[href="#/customers?platform=macos&bucket=behind_more"]');
    const claimed = Number(await cell.textContent());
    await cell.click();

    await expect(page).toHaveURL(/#\/customers\?platform=macos&bucket=behind_more/);
    // The chips arrive already pressed, so the filter can be undone.
    await expect(page.getByRole('button', { name: /^macOS/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^落后两版以上/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tbody tr')).toHaveCount(claimed);
    await settle(page);
    await expect(page).toHaveScreenshot('customers-bucket.png');
  });

  test('the version bands only appear once a platform is chosen', async ({ page }) => {
    await open(page, '/customers');
    await expect(page.getByRole('button', { name: /^最新/ })).toHaveCount(0);
    await page.getByRole('button', { name: /^macOS/ }).click();
    await settle(page);
    await expect(page.getByRole('button', { name: /^最新/ })).toBeVisible();
  });

  /**
   * The write path end to end: the PATCH lands, the console refetches, and the
   * row comes back saying what the server now believes.
   */
  test('withdrawing a release changes what the next read returns', async ({ page }, testInfo) => {
    await open(page, '/clients', 'default', `release-${testInfo.project.name}`);
    const row = page.locator('tbody tr').filter({ hasText: '1.8.1' }).first();
    await row.getByRole('button', { name: '撤回' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('这只在后台把 1.8.1 标记为已撤回');
    await dialog.getByRole('button', { name: '撤回' }).click();

    await expect(row).toContainText('已撤回');
    await expect(row.getByRole('button', { name: '撤回' })).toHaveCount(0);
  });

  test('setting the floor repeats what it does and what it does not', async ({ page }, testInfo) => {
    await open(page, '/clients', 'default', `floor-${testInfo.project.name}`);
    const row = page.locator('tbody tr').filter({ hasText: '1.9.0-rc1' }).first();
    await row.getByRole('button', { name: '设最低支持版本' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('1.8.0');
    await expect(dialog).toContainText('不会被停用');
    await dialog.getByRole('button', { name: '设最低支持版本' }).click();
    await expect(row).toContainText('1.8.0');
  });

  test('a fleet with no releases says so instead of showing an empty grid', async ({ page }) => {
    await open(page, '/clients', 'empty');
    await expect(page.getByText('还没有发布过客户端')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('位在最新版');
    await expect(page).toHaveScreenshot('empty.png');
  });

  test('the dense set keeps five platforms in one grid', async ({ page }) => {
    await open(page, '/clients', 'dense');
    await expect(page.getByText('未发布')).toHaveCount(0);
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(20);
    await settle(page);
    await expect(page).toHaveScreenshot('dense.png');
  });
});
