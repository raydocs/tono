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
      // Four columns answer "who, how are they, until when"; the rest are on the 360.
      await expect(page.locator('.customer-list-table thead th')).toHaveCount(4);
      for (const header of ['状态', '客户', '到期']) {
        await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
      }
    }
  });
}

test('the release actions are inside the first screen of the clients page', async ({ page }) => {
  await open(page, '/clients');
  const row = page.locator('tbody tr').filter({ hasText: '1.8.1' }).first();
  const withdraw = await row.getByRole('button', { name: '撤回' }).boundingBox();
  expect(withdraw).not.toBeNull();
  expect(withdraw!.x + withdraw!.width).toBeLessThanOrEqual(390);
  await expectTapTargets(page);
});
