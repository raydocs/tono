import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.use({ viewport: { width: 390, height: 844 } });

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
  });
}
