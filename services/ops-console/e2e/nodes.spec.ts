import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.describe('nodes page', () => {
  test('cards', async ({ page }) => {
    await open(page, '/nodes');

    // R4 in the browser: the sentence and the grid must agree about 在售.
    const listed = page.getByRole('button', { name: /在售$/ });
    await listed.click();
    await settle(page);
    const claimed = Number((await listed.textContent())?.match(/\d+/)?.[0]);
    expect(await page.locator('.node-card').count()).toBe(claimed);
    await listed.click();
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
   * Nothing measures the client-side leg yet. Forty-five identical em dashes
   * is not an answer, so the column goes and one grey line says why — once,
   * where the count sentence is, rather than on every card.
   */
  test('the un-wired path column is one sentence, not a column of dashes', async ({ page }) => {
    await open(page, '/nodes');
    await expect(page.getByText('客户去程数据尚未接入')).toBeVisible();
    await expect(page.locator('.node-card').first()).not.toContainText('客户去程');

    await page.getByRole('button', { name: '表格' }).click();
    await settle(page);
    await expect(page.getByRole('columnheader', { name: '客户去程' })).toHaveCount(0);
  });

  test('drawer', async ({ page }) => {
    await open(page, '/nodes');
    await page.locator('.node-card').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await settle(page);

    await expect(page).toHaveScreenshot('drawer.png');
  });
});
