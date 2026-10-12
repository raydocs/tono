import { expect, test, type Page } from '@playwright/test';
import { open, settle } from './ops';

test.use({ viewport: { width: 390, height: 844 } });

const TAP_TARGET = 44;

/** Every visible control on the page is at least a finger tall. */
async function expectTapTargets(page: Page): Promise<void> {
  const short = await page.locator('.ops-action, .ops-chip, .quality-range-btn').evaluateAll((nodes) => nodes
    .filter((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    })
    .map((node) => ({
      label: (node.textContent ?? '').trim().slice(0, 24),
      height: node.getBoundingClientRect().height,
    }))
    .filter((target) => target.height < 44));
  expect(short, `controls under ${TAP_TARGET} px tall`).toEqual([]);
}

/**
 * Every page an operator can reach, on a phone. today, nodes, node detail and
 * clients have their own phone specs; these are the rest. Each page must not
 * scroll sideways, and the whole page is a baseline so a layout that only
 * breaks below the fold is still seen. The screenshot comes before the width
 * check so a failing page still leaves its picture in the diffs.
 */
const PAGES: readonly { name: string; hash: string }[] = [
  { name: 'customers', hash: '/customers' },
  { name: 'customer-detail', hash: '/customers/u-04' },
  { name: 'traffic', hash: '/traffic' },
  { name: 'ledger', hash: '/settings/ledger' },
  { name: 'alerts', hash: '/settings/alerts' },
  { name: 'catalog', hash: '/settings/catalog' },
  { name: 'policy', hash: '/settings/policy' },
  { name: 'homeinventory', hash: '/settings/homeinventory' },
  { name: 'homelines', hash: '/settings/homelines' },
  { name: 'providers', hash: '/settings/providers' },
  { name: 'candidates', hash: '/settings/candidates' },
  { name: 'allowlist', hash: '/settings/allowlist' },
  { name: 'audit', hash: '/settings/audit' },
];

for (const { name, hash } of PAGES) {
  test(`${name} works on a phone without scrolling sideways`, async ({ page }) => {
    await open(page, hash);
    await expect(page.getByRole('main')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expectTapTargets(page);

    if (name === 'customers') {
      // Three columns answer "who, how are they, until when"; the rest are on the 360.
      await expect(page.locator('.customer-list-table thead th')).toHaveCount(3);
      for (const header of ['状态', '客户', '到期']) {
        await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
      }
    }
  });
}

/**
 * The month's four measures on the customer page sit two across, as the node
 * page's band does, instead of one small number per full-width row.
 */
test('the customer month experience measures sit in two columns on a phone', async ({ page }) => {
  await open(page, '/customers/u-04');
  const labels = ['成功率', '连上用时中位数', '已验证中断', '缺测'];
  const boxes = [];
  for (const label of labels) {
    const box = await page.getByText(label, { exact: true }).boundingBox();
    expect(box, `${label} is on the page`).not.toBeNull();
    boxes.push(box!);
  }
  expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBe(2);
  expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

/**
 * The fixture customers all have an expiry, so one is cleared first, through
 * the hub's own PATCH and into a store of its own, to make the notice appear.
 */
test('the customers expiry banner action is 44 px tall and inside the viewport', async ({ page }, testInfo) => {
  const session = `customers-gap-${testInfo.project.name}-${String(testInfo.repeatEachIndex)}-${String(testInfo.retry)}`;
  const cleared = await page.request.patch(`/api/v1/ops/users/u-06?session=${session}`, {
    data: { expiresAt: null },
  });
  expect(cleared.ok()).toBe(true);
  await open(page, '/customers', 'default', session);
  const action = page.getByRole('button', { name: '批量设到期日', exact: true });
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const sentence = await page.getByText('位客户没登记到期').boundingBox();
  expect(box!.y).toBeGreaterThan(sentence!.y);
});

test('the release actions are inside the first screen of the clients page', async ({ page }) => {
  await open(page, '/clients');
  const row = page.locator('tbody tr').filter({ hasText: '1.8.1' }).first();
  const withdraw = await row.getByRole('button', { name: '撤回' }).boundingBox();
  expect(withdraw).not.toBeNull();
  expect(withdraw!.x + withdraw!.width).toBeLessThanOrEqual(390);
  await expectTapTargets(page);
});

test('the clients hero breaks only between its three segments', async ({ page }) => {
  await open(page, '/clients');
  const segments = page.locator('.clients-hero .text-verdict span.whitespace-nowrap');
  await expect(segments).toHaveCount(3);
  const measured = await segments.evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node);
    return {
      whiteSpace: style.whiteSpace,
      lines: node.getClientRects().length,
      height: node.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight),
    };
  }));
  for (const segment of measured) {
    expect(segment.whiteSpace).toBe('nowrap');
    expect(segment.lines).toBe(1);
    expect(segment.height).toBeLessThanOrEqual(segment.lineHeight * 1.5);
  }
  await expect(page.locator('.clients-hero .text-verdict')).toHaveText('11 位在最新版 · 10 位落后 · 2 位未上报');
});

test('the page note drops its separator and stacks its two parts', async ({ page }) => {
  await open(page, '/clients');
  const note = page.locator('.clients-hero p').filter({ hasText: '本页截至' });
  await expect(note.locator('[aria-hidden]')).toBeHidden();
  const stamp = await note.getByText(/^本页截至/).boundingBox();
  const filling = await note.getByText(/^正在回填/).boundingBox();
  expect(stamp).not.toBeNull();
  expect(filling).not.toBeNull();
  expect(filling!.x).toBe(stamp!.x);
  expect(filling!.y).toBeGreaterThan(stamp!.y);
});

test('a release row keeps its actions on one or two lines, inside the viewport', async ({ page }) => {
  await open(page, '/clients');
  const row = page.locator('tbody tr').filter({ hasText: '1.9.0-rc1' }).first();
  const cell = await row.locator('td').nth(2).boundingBox();
  expect(cell!.height).toBeLessThan(110);
  const publish = await row.getByRole('button', { name: '发布', exact: true }).boundingBox();
  const setMin = await row.getByRole('button', { name: '设最低支持版本', exact: true }).boundingBox();
  // The short button and the long one share a line; they used to stack.
  expect(Math.abs(publish!.y - setMin!.y)).toBeLessThan(2);
  for (const name of ['发布', '设最低支持版本']) {
    const button = row.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box!.x + box!.width, name).toBeLessThanOrEqual(390);
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
  }
});
