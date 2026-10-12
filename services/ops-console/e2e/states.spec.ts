import { expect, test, type Page } from '@playwright/test';
import { open } from './ops';

test('empty fleet says so instead of showing zero cards', async ({ page }) => {
  await open(page, '/nodes', 'empty');

  await expect(page.locator('.nodes-table tbody tr')).toHaveCount(0);
  await expect(page.getByText('还没有节点')).toBeVisible();
  await expect(page).toHaveScreenshot('empty.png');
});

test('a failing hub is an error, not an empty list', async ({ page }) => {
  await open(page, '/nodes', 'error');

  await expect(page.getByText('数据源 未知')).toBeVisible();
  // R2: counts that were never measured must not be rendered as zero.
  await expect(page.getByRole('group', { name: '按状态筛选' })).toHaveCount(0);
  await expect(page.locator('.nodes-stats .stat-value').first()).toHaveText('—');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page).toHaveScreenshot('error.png');
});

test('dense fleet: long names truncate rather than reflow', async ({ page }) => {
  await open(page, '/nodes', 'dense');

  expect(await page.locator('.nodes-table tbody tr').count()).toBeGreaterThan(40);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot('dense-table.png', { fullPage: true });
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
  // A row is 36 px until a node or failure cell wraps onto a second line.
  const heights = await page.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBe(36);
  await expect(page).toHaveScreenshot('customers-dense.png');
});

/**
 * The four states a page can be in must be told apart. A failed read says so
 * in a sentence and offers 重试 where a refetch exists; it never stays on the
 * loading word, which would read as "wait" when the answer is "ask again".
 */
async function expectErrorWithRetry(page: Page): Promise<void> {
  const main = page.getByRole('main');
  await expect(main.getByRole('alert').first()).toBeVisible();
  await expect(main.getByText('载入中')).toHaveCount(0);
  const retry = main.getByRole('button', { name: '重试', exact: true }).first();
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
}

const ERROR_PAGES: readonly { name: string; hash: string }[] = [
  { name: 'clients', hash: '/clients' },
  { name: 'traffic', hash: '/traffic' },
  { name: 'customer detail', hash: '/customers/u-04' },
  { name: 'providers', hash: '/settings/providers' },
  { name: 'alerts', hash: '/settings/alerts' },
  { name: 'ledger', hash: '/settings/ledger' },
  { name: 'node detail', hash: `/nodes/${encodeURIComponent('Tokyo · Fuji')}` },
];

for (const { name, hash } of ERROR_PAGES) {
  test(`${name}: a failing hub says so and offers 重试`, async ({ page }) => {
    await open(page, hash, 'error');

    await expectErrorWithRetry(page);
  });
}

// The empty fixture set has no customer detail at all; u-06 is the default
// set's customer who never reported, so its destination and service reads are
// empty lists rather than failures.
test('a customer with no traffic says so in words, not with the node table\'s empty line', async ({ page }) => {
  await open(page, '/customers/u-06');

  const main = page.getByRole('main');
  await expect(main.getByText('这位客户这周还没有去过任何目的地')).toBeVisible();
  await expect(main.getByText('这位客户这周还没有用过任何服务')).toBeVisible();
  await expect(main.getByText('没有节点')).toHaveCount(0);
});

test('traffic with no customers on record says so', async ({ page }) => {
  await open(page, '/traffic', 'empty');

  await expect(page.getByRole('main').getByText('没有客户用量记录。')).toBeVisible();
  await expect(page.getByRole('main').getByText('没有节点')).toHaveCount(0);
});
