import { expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy/copy';
import { linesEndingInDot, linesStartingInDot, open, phraseLines, settle } from './ops';

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
  // On a phone the dots are gone: the three segments are separated by a gap.
  await expect(segments).toHaveText(['11 位在最新版', '10 位落后', '2 位未上报']);
  await expect(page.locator('.clients-hero .text-verdict .dot-joined-sep').first()).toBeHidden();
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

/**
 * "约 140 分钟后齐" is one phrase: a narrow line breaks after the comma that
 * ends the progress, never between the number and the unit. The same note sits
 * under the customers, today and clients heroes.
 */
for (const { name, hash } of [
  { name: 'customers', hash: '/customers' },
  { name: 'today', hash: '/today' },
  { name: 'clients', hash: '/clients' },
]) {
  test(`the backfill estimate is on one line on ${name}`, async ({ page }) => {
    await open(page, hash);
    const note = 'p:has-text("正在回填")';
    await expect(page.locator(note).first()).toBeVisible();
    expect(await phraseLines(page, note, copy.backfillEta('140'))).toBe(1);
  });
}

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

/**
 * 22 production customers broke the sentence "22 位客户 · 2 位正常 ·" after the
 * dot, with the next count alone on the line below; the fix that kept the dot
 * with the next count started lines with it. Chinese layout forbids both, so
 * on a phone the segments are separated by a gap and carry no dots at all.
 * The total is the headline beside the action; the health words and the
 * funnel are the lines under it.
 */
test('the customers count sentences have no dot at either end of a line at 390 px', async ({ page }) => {
  await open(page, '/customers');
  const hero = '.customers-hero .text-verdict, .customers-hero-status';
  const funnel = 'p.text-body:not(.customers-hero-status):has(button[aria-pressed])';
  await expect(page.locator('.customers-hero-status')).toContainText('位连不上');
  await expect(page.locator(funnel)).toContainText('位连上过');
  for (const selector of [hero, funnel]) {
    expect(await linesEndingInDot(page, selector), `${selector} ends a line in a dot`).toEqual([]);
    expect(await linesStartingInDot(page, selector), `${selector} starts a line with a dot`).toEqual([]);
  }
  // Not one dot is visible on a phone, in the hero or the funnel.
  await expect(page.locator('.customers-hero .dot-joined-sep, ' + funnel + ' .dot-joined-sep').first()).toBeHidden();

  // The headline and the action share a row; the status line is beneath both.
  const headline = await page.locator('.customers-hero .text-verdict').boundingBox();
  const action = await page.locator('.customers-hero').getByRole('button', { name: '开通', exact: true }).boundingBox();
  const status = await page.locator('.customers-hero-status').boundingBox();
  expect(Math.abs((headline!.y + headline!.height / 2) - (action!.y + action!.height / 2))).toBeLessThan(headline!.height);
  expect(action!.x).toBeGreaterThan(headline!.x + headline!.width - 1);
  expect(status!.y).toBeGreaterThanOrEqual(Math.max(headline!.y + headline!.height, action!.y + action!.height) - 1);
});

/**
 * The address is two lines on a phone, the local part and then "@domain", so
 * no fixture address ends in an ellipsis in a 390 px column; and the bottom
 * dock does not cover a row once the page is scrolled to its end.
 */
test('the customer cells show whole addresses at 390 px and the dock covers no row', async ({ page }) => {
  await open(page, '/customers');
  const rows = page.locator('.customer-list-table tbody tr');
  expect(await rows.count()).toBeGreaterThanOrEqual(20);
  const cells = await rows.evaluateAll((trs) => trs.slice(0, 20).map((tr) => {
    const cell = tr.querySelectorAll('td')[1]!;
    const lines = [...cell.querySelectorAll('span')];
    return {
      text: (cell.textContent ?? '').trim(),
      cut: lines.filter((line) => line.scrollWidth > line.clientWidth + 1).map((line) => line.textContent),
      domain: cell.querySelector('.address-domain')?.getBoundingClientRect().top ?? null,
    };
  }));
  for (const cell of cells) {
    expect(cell.text, cell.text).not.toContain('\u2026');
    expect(cell.cut, cell.text).toEqual([]);
    // "@domain" is a second line, under the local part.
    expect(cell.domain, cell.text).not.toBeNull();
  }

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const geometry = await page.evaluate(() => {
    const dock = document.querySelector('.shell-dock')!.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.customer-list-table tbody tr')];
    const last = rows.at(-1)!.getBoundingClientRect();
    return { dockTop: dock.top, lastBottom: last.bottom, heights: rows.map((row) => row.getBoundingClientRect().height) };
  });
  expect(geometry.lastBottom).toBeLessThanOrEqual(geometry.dockTop + 0.5);
  // Two lines (15 px and 11 px) in the same row the single line had.
  expect(Math.max(...geometry.heights)).toBeLessThanOrEqual(44);
});
