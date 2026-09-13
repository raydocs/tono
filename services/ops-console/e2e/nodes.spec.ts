import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.describe('nodes page', () => {
  test('cards', async ({ page }) => {
    await open(page, '/nodes');

    // R4 in the browser: the sentence and the grid must agree about 正常.
    const fine = page.getByRole('button', { name: /台正常$/ });
    await fine.click();
    await settle(page);
    const claimed = Number((await fine.textContent())?.match(/\d+/)?.[0]);
    expect(await page.locator('.node-card').count()).toBe(claimed);
    await fine.click();
    await settle(page);

    await expect(page.locator('.node-card').first()).toBeVisible();
    await expect(page).toHaveScreenshot('cards.png');
  });

  test('table', async ({ page }) => {
    await open(page, '/nodes');
    await page.getByRole('button', { name: '表格' }).click();
    await settle(page);

    await expect(page.locator('tbody tr').first()).toHaveCSS('height', '36px');
    await expect(page).toHaveScreenshot('table.png');
  });

  /**
   * The count sentence is the health axis and nothing else: a machine that was
   * taken out of service answers no probe, and counting it as a fault is what
   * made this page disagree with 今天 about how broken the fleet was.
   */
  test('retired machines are hidden until the chip asks for them', async ({ page }) => {
    await open(page, '/nodes');

    const chip = page.getByRole('button', { name: /^已退役/ });
    const claimed = Number((await chip.textContent())?.match(/\d+/)?.[0]);
    expect(claimed).toBeGreaterThan(0);
    await expect(page.locator('.node-card').filter({ hasText: '已退役' })).toHaveCount(0);
    const shown = await page.locator('.node-card').count();

    await chip.click();
    await settle(page);
    await expect(page.locator('.node-card')).toHaveCount(claimed);
    expect(claimed).toBeLessThan(shown);
    // Never an alarm on a machine nobody sells: the word stays, the pill goes.
    await expect(page.locator('.node-card .tone-pill')).toHaveCount(0);
    await expect(page.locator('.node-card').first()).toContainText('已退役');
  });

  /**
   * The client-side leg is measured for some machines and not others, so the
   * column is on and the machines without a measurement say so — one em dash
   * and the word for who should have measured it, never a zero.
   */
  test('the customer-side leg is a column once any node has one', async ({ page }) => {
    await open(page, '/nodes');
    await expect(page.getByText('客户去程数据尚未接入')).toHaveCount(0);
    await expect(page.locator('.node-card').first()).toContainText('客户去程');

    await page.getByRole('button', { name: '表格' }).click();
    await settle(page);
    await expect(page.getByRole('columnheader', { name: '客户去程' })).toHaveCount(1);
  });

  /** A machine with no cap is one line that goes somewhere, not two blank ones. */
  test('a node with no quota entered offers the page where it is set', async ({ page }) => {
    await open(page, '/nodes');
    const card = page.locator('.node-card').filter({ hasText: '未设额度' }).first();
    await expect(card).toBeVisible();
    await expect(card).not.toContainText('预计耗尽');

    await card.getByRole('button', { name: '未设额度' }).click();
    await expect(page).toHaveURL(/#\/nodes\/[^?]+$/);
  });

  test('drawer', async ({ page }) => {
    await open(page, '/nodes');
    await page.locator('.node-card').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await settle(page);

    await expect(page).toHaveScreenshot('drawer.png');
  });
});
