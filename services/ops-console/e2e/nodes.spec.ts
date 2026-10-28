import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

const rows = '.nodes-table tbody tr';

/** A test that writes gets its own fixture store per project, repeat and retry. */
function sessionFor(name: string): string {
  const info = test.info();
  return `${name}-${info.project.name}-${info.repeatEachIndex}-${info.retry}`;
}

test.describe('nodes page', () => {
  test('dashboard', async ({ page }) => {
    await open(page, '/nodes');

    // R4 in the browser: a filter that says N lists N rows.
    const fine = page.getByRole('group', { name: '按状态筛选' }).getByRole('button', { name: /^正常/ });
    await fine.click();
    await settle(page);
    const claimed = Number((await fine.textContent())?.match(/\d+/)?.[0]);
    expect(await page.locator(rows).count()).toBe(claimed);
    await page.getByRole('group', { name: '按状态筛选' }).getByRole('button', { name: /^全部/ }).click();
    await settle(page);

    await expect(page.getByRole('heading', { name: '机器负载' })).toBeVisible();
    await expect(page.locator('.nodes-load-grid .chart-frame')).toHaveCount(4);
    // The filter clicks scroll the page and leave the pointer over a row. A full-page
    // capture then draws the fixed sidebar at whatever offset the click needed and a
    // hovered row, so the capture starts from the top with nothing hovered.
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    await expect(page).toHaveScreenshot('dashboard.png', { fullPage: true });
  });

  /** Trouble first: the engine's worst word leads the table, whatever order the list came in. */
  test('the table puts the machines that need action first', async ({ page }) => {
    await open(page, '/nodes');
    await expect(page.locator(rows).first().locator('.tone-pill')).toHaveCount(1);
    await expect(page.locator(rows).last().locator('.tone-pill')).toHaveCount(0);
  });

  /**
   * The health filter is the health axis and nothing else: a machine that was
   * taken out of service answers no probe, and counting it as a fault is what
   * made this page disagree with 今天 about how broken the fleet was.
   */
  test('retired machines are hidden until the chip asks for them', async ({ page }) => {
    await open(page, '/nodes');

    const chip = page.getByRole('button', { name: /^已退役/ });
    const claimed = Number((await chip.textContent())?.match(/\d+/)?.[0]);
    expect(claimed).toBeGreaterThan(0);
    await expect(page.locator(rows).filter({ hasText: '已退役' })).toHaveCount(0);
    const shown = await page.locator(rows).count();

    await chip.click();
    await settle(page);
    await expect(page.locator(rows)).toHaveCount(claimed);
    expect(claimed).toBeLessThan(shown);
    // Never an alarm on a machine nobody sells: the word stays, the pill goes.
    await expect(page.locator(`${rows} .tone-pill`)).toHaveCount(0);
    await expect(page.locator(rows).first()).toContainText('已退役');
  });

  test('the customer-side leg is a column once any node has one', async ({ page }) => {
    await open(page, '/nodes');
    await expect(page.getByText('客户去程数据未接入')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: '客户去程' })).toHaveCount(1);
  });

  test('search narrows the rows the filter left', async ({ page }) => {
    await open(page, '/nodes');
    await page.getByRole('searchbox', { name: '搜索节点' }).fill('tokyo');
    await expect(page.locator(rows)).toHaveCount(3);
    await page.getByRole('searchbox', { name: '搜索节点' }).fill('没有这台');
    await expect(page.getByText('没有符合条件的节点')).toBeVisible();
  });

  /** A machine with no cap says so in words, and the row still goes to the page where it is set. */
  test('a node with no quota entered opens the page where it is set', async ({ page }) => {
    await open(page, '/nodes');
    const row = page.locator(rows).filter({ hasText: '未设额度' }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/#\/nodes\/[^?]+$/);
  });

  /**
   * The fixture server accepts the profile PATCH but only into its one
   * node-detail store; the list this page reads is static, so the rows keep
   * saying 未设额度 here. What is asserted is the part the page owns: who was
   * picked, what was refused before sending, and the result line.
   */
  test('the gap banner opens a batch form that registers the machines picked', async ({ page }) => {
    await open(page, '/nodes', 'default', sessionFor('nodes-batch'));
    await expect(page.getByText('5 台没登记额度')).toBeVisible();
    await page.getByRole('button', { name: '批量登记' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('已选 5 / 38 台')).toBeVisible();
    // Nothing filled yet: the button is shut, with the reason as its title.
    const save = drawer.getByRole('button', { name: '登记', exact: true });
    await expect(save).toBeDisabled();

    for (const box of await drawer.getByRole('checkbox').all()) await box.uncheck();
    await drawer.getByRole('checkbox', { name: /那霸/ }).check();
    await drawer.getByRole('checkbox', { name: /马尼拉/ }).check();
    await expect(drawer.getByText('已选 2 / 38 台')).toBeVisible();

    await drawer.getByLabel('每周期流量（GB）').fill('100');
    // A quota needs its rules chosen, not guessed.
    await expect(save).toBeDisabled();
    await drawer.getByLabel('怎么翻页').selectOption({ label: '每月固定某天' });
    await drawer.getByLabel('算哪个方向').selectOption({ label: '上下行都算' });
    await expect(save).toBeEnabled();

    const written: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PATCH') written.push(request.postData() ?? '');
    });
    await save.click();
    await expect(drawer.getByText('已登记 2 台 · 失败 0 台')).toBeVisible();
    expect(written).toHaveLength(2);
    expect(JSON.parse(written[0] ?? '{}')).toEqual({
      quota: { quotaBytes: 100_000_000_000, cycleKind: 'calendar_day', cycleAnchorDay: 1, counts: 'in_out' },
    });
  });

  /**
   * 在报 counts every name the collector heard from, 在役 counts the node list:
   * the sentence says which names are retired machines, which are not in the
   * list, and which in-service machines said nothing. The default set already
   * carries series for its retired machines; the read is edited here, in this
   * page only, so the screenshots keep the default set's own numbers.
   */
  test('the reporting count says why it differs from the machines in service', async ({ page }) => {
    await page.route(/\/api\/v1\/ops\/metrics\?(?!.*node=)/, async (route) => {
      const response = await route.fetch();
      const body = await response.json() as { metrics: { series: Record<string, unknown> } };
      const { series } = body.metrics;
      series['Ghost · Box'] = series['Tokyo · Neon'];
      delete series['Tokyo · Fuji'];
      await route.fulfill({ response, json: body });
    });
    await open(page, '/nodes');

    const retired = Number((await page.getByRole('button', { name: /^已退役/ }).textContent())?.match(/\d+/)?.[0]);
    expect(retired).toBeGreaterThan(0);
    const lead = page.locator('.quality-head .text-fine');
    await expect(lead).toContainText(`其中 ${retired} 台已退役、1 台不在名单，1 台没上报`);
    await expect(lead.locator('.font-mono')).toHaveText(/^\s*\d+ 台在报$/);
  });

  test('the ⌘K drawer still opens from ?node=', async ({ page }) => {
    await open(page, '/nodes?node=Tokyo%20%C2%B7%20Fuji');
    await expect(page.getByRole('dialog')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('drawer.png');
  });
});
