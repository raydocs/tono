import { expect, test } from '@playwright/test';
import { open, phraseLines, settle } from './ops';

test.use({ viewport: { width: 390, height: 844 } });

/**
 * Nine columns do not fit 390 px, and a table that scrolls sideways hides the
 * one column that matters. Three columns answer the same question in one
 * screen, and the list comes before the charts because it is what a phone
 * opens this page for.
 */
test('the fleet is a three column table at 390 px, ahead of the charts', async ({ page }) => {
  await open(page, '/nodes');

  await expect(page.locator('.nodes-table thead th')).toHaveCount(3);
  for (const header of ['状态', '节点', '本周期流量']) {
    await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
  }
  const table = await page.getByRole('heading', { name: '全部节点' }).boundingBox();
  const load = await page.getByRole('heading', { name: '机器负载' }).boundingBox();
  expect(table!.y).toBeLessThan(load!.y);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await settle(page);
  await expect(page).toHaveScreenshot('nodes.png');
});

/** The banner's action drops under its sentence and is a thumb tall, inside the screen. */
test('the data-gap banner action is 44 px tall and inside the viewport at 390 px', async ({ page }) => {
  await open(page, '/nodes');
  const action = page.getByRole('button', { name: '批量登记' });
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const sentence = await page.getByText('台没登记额度').boundingBox();
  expect(box!.y).toBeGreaterThan(sentence!.y);
});

/**
 * Six production nodes share a city. A one-line cell showed all of them as
 * "Los Ang…"; the site after the separator has to be readable in full.
 */
test('two nodes in the same city show their site name in full at 390 px', async ({ page }) => {
  await open(page, '/nodes');

  const links = page.locator('.nodes-table tbody .nodes-name a');
  const sites: (string | null)[] = [];
  const clipped: (boolean | undefined)[] = [];
  for (const link of await links.all()) {
    if (!(await link.textContent())?.startsWith('Los Angeles')) continue;
    // The last line of the cell is the site; the muted line above it is the city.
    const main = await link.evaluate((a) => {
      const lines = a.querySelectorAll('span');
      const last = lines[lines.length - 1];
      return last ? { text: last.textContent, clipped: last.scrollHeight > last.clientHeight + 1 } : null;
    });
    sites.push(main?.text ?? null);
    clipped.push(main?.clipped);
  }
  expect(sites).toEqual(['Mesa', 'Pacific-Coast-Highway-Backhaul-01']);
  expect(clipped).toEqual([false, false]);
  for (const site of sites) expect(site?.endsWith('…')).toBe(false);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

/** "问题在前；点一行去节点页" left its last character alone on a line. */
test('the fleet table subtitle keeps 点一行去节点页 on one line at 390 px', async ({ page }) => {
  await open(page, '/nodes');
  expect(await phraseLines(page, 'p.text-fine:has-text("点一行去节点页")', '点一行去节点页')).toBe(1);
});
