import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.describe('customers page', () => {
  test('table', async ({ page }) => {
    await open(page, '/customers');

    // The sentence the whole page is built around.
    await expect(page.getByRole('button', { name: '20 位客户' })).toBeVisible();
    await expect(page.getByRole('button', { name: '4 位在线' })).toBeVisible();
    await expect(page.getByRole('button', { name: '1 位连不上' })).toBeVisible();

    // R4 in the browser: the fragment and the rows it filters to must agree.
    const online = page.getByRole('button', { name: /位在线$/ });
    await online.click();
    await settle(page);
    const claimed = Number((await online.textContent())?.match(/\d+/)?.[0]);
    expect(await page.locator('tbody tr').count()).toBe(claimed);
    await online.click();
    await settle(page);

    // Three platforms have shipped nothing; they are shown, greyed, and say so.
    await expect(page.getByRole('button', { name: /Linux 未发布/ })).toBeDisabled();
    await expect(page.locator('tbody tr').first()).toHaveCSS('height', '36px');
    await expect(page).toHaveScreenshot('table.png');
  });

  test('privacy masks the addresses without hiding the rows', async ({ page }) => {
    await open(page, '/customers');
    const before = await page.locator('tbody tr').count();
    // The mask lives in the avatar menu now: it is a preference, not a fact.
    await page.getByRole('button', { name: '偏好' }).click();
    await page.getByRole('menuitemcheckbox', { name: '隐私' }).click();
    await settle(page);
    expect(await page.locator('tbody tr').count()).toBe(before);
    await expect(page.locator('tbody')).not.toContainText('wang.tao@example.com');
  });

  test('detail', async ({ page }) => {
    await open(page, '/customers/u-04');

    await expect(page.getByRole('heading', { name: 'wang.tao@example.com' })).toBeVisible();
    // The health word, and the four header actions that have no endpoint yet.
    await expect(page.getByText('连不上').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '发起远程诊断' }).first()).toBeDisabled();

    // Every block the plan asks for, in the plan's order.
    for (const heading of ['现在', '连接时间线', '使用时段', '流量去向', '服务使用', '按运营商的路径', '设备']) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
    await settle(page);
    await expect(page).toHaveScreenshot('detail.png');
  });

  test('the timeline filters down to the failures that explain the word', async ({ page }) => {
    await open(page, '/customers/u-04');
    const before = await page.getByText('没连上').count();
    expect(before).toBeGreaterThan(0);
    await page.getByRole('button', { name: '只看失败' }).click();
    await settle(page);
    // Nothing but failures survives, and the successes are gone.
    await expect(page.getByText('连上', { exact: true })).toHaveCount(0);
    expect(await page.getByText('没连上').count()).toBe(before);
  });

  test('a row opens its own page, not a drawer', async ({ page }) => {
    await open(page, '/customers');
    await page.locator('tbody tr').first().click();
    await expect(page).toHaveURL(/#\/customers\/u-/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
