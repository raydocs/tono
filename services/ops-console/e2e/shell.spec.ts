import { expect, test } from '@playwright/test';
import { open } from './ops';

/**
 * The header capsule and the grey line under a page sentence: the two places
 * the console says how much of what you are reading can be trusted. No
 * screenshots here — these are about wording, and a baseline would only make
 * the next copy edit look like a regression.
 */
test.describe('the header says which source is behind', () => {
  test('names a source nobody has wired up, in words, without an alarm', async ({ page }) => {
    await open(page, '/nodes');
    const pill = page.locator('.source-pill');
    await expect(pill).toHaveText('任务 未接');
    await expect(pill).toHaveClass(/tone-unk/);
  });

  test('names the feed that has stopped, and how long it has been stopped', async ({ page }) => {
    await open(page, '/nodes', 'dense');
    const pill = page.locator('.source-pill');
    await expect(pill).toHaveText('探针 停了 19 小时');
    await expect(pill).toHaveClass(/tone-warn/);
  });

  test('says 正常 only when every source is ready', async ({ page }) => {
    await open(page, '/nodes', 'empty');
    await expect(page.locator('.source-pill')).toHaveText(/^数据源 正常 · /);
  });

  test('admits it knows nothing when the read itself failed', async ({ page }) => {
    await open(page, '/nodes', 'error');
    await expect(page.locator('.source-pill')).toHaveText('数据源 未知');
  });
});

test('the page says how old it is, and that the backfill is still running', async ({ page }) => {
  await open(page, '/nodes');
  await expect(page.getByText(/^本页截至/)).toBeVisible();
  await expect(page.getByText(/^正在回填 30 天遥测/)).toContainText('3200 / 8640');
});

/**
 * ⌘K is the only way into a machine or a customer from a page that lists
 * neither, so it has to hold all four kinds — and mask the address when the
 * privacy switch is on, without losing the ability to search by it.
 */
test('the palette finds pages, incidents, customers and machines', async ({ page }) => {
  await open(page, '/nodes');
  await page.keyboard.press('Meta+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('combobox').fill('chen.jie');
  await expect(dialog.getByRole('option').first()).toBeVisible();

  await dialog.getByRole('combobox').fill('Tokyo');
  const node = dialog.getByRole('option').first();
  await expect(node).toBeVisible();
  await node.click();
  await expect(page).toHaveURL(/node=Tokyo/);
});
