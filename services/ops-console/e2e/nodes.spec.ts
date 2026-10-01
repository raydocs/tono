import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

const rows = '.nodes-table tbody tr';

test.describe('nodes page', () => {
  test('dashboard', async ({ page }) => {
    await open(page, '/nodes');

    // R4 in the browser: a filter that says N lists N rows.
    const fine = page.getByRole('group', { name: '按状态筛选' }).getByRole('button', { name: /^正常/ });
    await fine.click();
    await settle(page);
    const claimed = Number((await fine.textContent())?.match(/\d+/)?.[0]);
    expect(await page.locator(rows).count()).toBe(claimed);
    await page.getByRole('group', { name: '按状态筛选' }).getByRole('button', { name: /^全部/ }).click();
    await settle(page);

    await expect(page.getByRole('heading', { name: '机器负载' })).toBeVisible();
    await expect(page.locator('.nodes-load-grid .chart-frame')).toHaveCount(4);
    await expect(page).toHaveScreenshot('dashboard.png', { fullPage: true });
  });

  /** Trouble first: the engine's worst word leads the table, whatever order the list came in. */
  test('the table puts the machines that need action first', async ({ page }) => {
    await open(page, '/nodes');
    await expect(page.locator(rows).first().locator('.tone-pill')).toHaveCount(1);
    await expect(page.locator(rows).last().locator('.tone-pill')).toHaveCount(0);
  });

  /**
   * The health filter is the health axis and nothing else: a machine that was
   * taken out of service answers no probe, and counting it as a fault is what
   * made this page disagree with 今天 about how broken the fleet was.
   */
  test('retired machines are hidden until the chip asks for them', async ({ page }) => {
    await open(page, '/nodes');

    const chip = page.getByRole('button', { name: /^已退役/ });
    const claimed = Number((await chip.textContent())?.match(/\d+/)?.[0]);
    expect(claimed).toBeGreaterThan(0);
    await expect(page.locator(rows).filter({ hasText: '已退役' })).toHaveCount(0);
    const shown = await page.locator(rows).count();

    await chip.click();
    await settle(page);
    await expect(page.locator(rows)).toHaveCount(claimed);
    expect(claimed).toBeLessThan(shown);
    // Never an alarm on a machine nobody sells: the word stays, the pill goes.
    await expect(page.locator(`${rows} .tone-pill`)).toHaveCount(0);
    await expect(page.locator(rows).first()).toContainText('已退役');
  });

  test('the customer-side leg is a column once any node has one', async ({ page }) => {
    await open(page, '/nodes');
    await expect(page.getByText('客户去程数据尚未接入')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: '客户去程' })).toHaveCount(1);
  });

  test('search narrows the rows the filter left', async ({ page }) => {
    await open(page, '/nodes');
    await page.getByRole('searchbox', { name: '搜索节点' }).fill('tokyo');
    await expect(page.locator(rows)).toHaveCount(3);
    await page.getByRole('searchbox', { name: '搜索节点' }).fill('没有这台');
    await expect(page.getByText('没有符合条件的节点')).toBeVisible();
  });

  /** A machine with no cap says so in words, and the row still goes to the page where it is set. */
  test('a node with no quota entered opens the page where it is set', async ({ page }) => {
    await open(page, '/nodes');
    const row = page.locator(rows).filter({ hasText: '未设额度' }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/#\/nodes\/[^?]+$/);
  });

  test('the ⌘K drawer still opens from ?node=', async ({ page }) => {
    await open(page, '/nodes?node=Tokyo%20%C2%B7%20Fuji');
    await expect(page.getByRole('dialog')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('drawer.png');
  });
});
