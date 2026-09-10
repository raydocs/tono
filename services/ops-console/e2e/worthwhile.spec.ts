import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

/**
 * 本周最值得做的三件事 — the last block of the 早报.
 *
 * The three things it has to get right are all visible from the outside: never
 * more than three lines, an estimated number that says it is one, and a link
 * that lands on the page where the thing is actually done.
 */
test.describe('本周最值得做的三件事', () => {
  test('早报最后是三件事，估算的说自己是估算，估不出的说估不出', async ({ page }) => {
    await open(page, '/today');
    const week = page.locator('.worthwhile');

    await expect(week.getByRole('heading', { name: '本周最值得做的三件事' })).toBeVisible();
    await expect(week.locator('.worthwhile-row')).toHaveCount(3);

    // The measured one reads as a plain amount; the guessed one carries the ≈
    // and the word, and the one with nothing to claim says so.
    const rows = week.locator('.worthwhile-row');
    await expect(rows.nth(0)).toContainText('¥84.00');
    await expect(rows.nth(0)).not.toContainText('≈');
    await expect(rows.nth(1)).toContainText('≈');
    await expect(rows.nth(1)).toContainText('估算');
    await expect(rows.nth(2)).toContainText('无法估算');

    // How much of each number to believe is said in a word, not left to the reader.
    await expect(rows.nth(0)).toContainText('有把握');
    await expect(rows.nth(1)).toContainText('差不多');
  });

  /**
   * A week with nothing worth doing gets one sentence.
   *
   * The empty fixture set never reaches this branch: 早报 answers a night with
   * nothing in it with its own quiet sentence and stops before this block, so
   * the state is checked here against a digest that has picks and separately in
   * `src/pages/worthwhile/Worthwhile.test.tsx`, which can hand the block an
   * empty week directly.
   */
  test('空空的一周不摆三行空的，早报自己就先收了口', async ({ page }) => {
    await open(page, '/today', 'empty');
    await expect(page.getByText('昨夜无事，今天没有到期的事')).toBeVisible();
    await expect(page.locator('.worthwhile-row')).toHaveCount(0);
  });

  test('机器那一行点下去就是这台机器的页面', async ({ page }) => {
    await open(page, '/today');
    const first = page.locator('.worthwhile-row').first();
    await expect(first).toContainText('Tokyo · Fuji');
    await first.getByRole('button', { name: '去处理' }).click();
    await settle(page);

    await expect(page).toHaveURL(/#\/nodes\/Tokyo/);
    await expect(page.getByRole('heading', { name: 'Tokyo · Fuji' }).first()).toBeVisible();
  });
});

test.describe('在手机上', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('三行会折行，但整页不许横着滚', async ({ page }) => {
    await open(page, '/today');
    const week = page.locator('.worthwhile');
    await expect(week.locator('.worthwhile-row')).toHaveCount(3);
    await expect(week.locator('.worthwhile-row').first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
