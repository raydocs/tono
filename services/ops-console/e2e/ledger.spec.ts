import { expect, test, type Page } from '@playwright/test';
import { open, settle } from './ops';

/**
 * 设置 · 账目 is the operator's money page, so the flows here are the three
 * things that would cost real money to get wrong: a foreign-currency entry
 * that has to show what it converts to before it is saved, a reversal that
 * has to leave both halves of the pair marked, and a lock that has to stop
 * the month being edited afterwards.
 *
 * The baselines are the fourth check. A page of totals is exactly the kind of
 * surface that can drift into printing a confident margin for a customer
 * nobody has reconciled, and 待核对 is a word a screenshot can catch.
 */

const LEDGER = '/settings/ledger';

/**
 * A test that writes gets its own fixture store per project, repeat and
 * retry: a store left reversed or locked by the previous run of the same test
 * would otherwise be what `--repeat-each` or a retry starts from.
 */
function sessionFor(name: string): string {
  const info = test.info();
  return `${name}-${info.project.name}-${info.repeatEachIndex}-${info.retry}`;
}

/** The reviewable copy: this page is taller than the 900 px viewport. */
async function keep(page: Page, name: string) {
  if (test.info().project.name !== 'light') return;
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true });
}

test.describe('账目', () => {
  test('一个月的账，一页', async ({ page }) => {
    await open(page, LEDGER);
    await expect(page.getByRole('main').getByRole('heading', { name: '账目', exact: true })).toBeVisible();
    await expect(page.getByText('40 笔')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('ledger.png');
    await keep(page, 'settings-ledger');
  });

  test('一笔账都没有的月份', async ({ page }) => {
    await open(page, LEDGER, 'empty');
    await expect(page.getByText('这个月一笔账都没有')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('ledger-empty.png');
  });

  test('毛利算不出来的，写着待核对', async ({ page }) => {
    await open(page, LEDGER);
    await expect(page.getByText('3 项还没对上')).toBeVisible();
    // The SLO table links every node once per day row, so the node is looked
    // for inside the 待核对 block, where it must appear exactly once.
    const block = page.getByRole('heading', { name: '待核对', exact: true }).locator('xpath=ancestor::section[1]');
    const pending = block.getByRole('link', { name: 'zhao.lei@example.com', exact: true });
    await expect(pending).toHaveAttribute('href', '#/customers/u-05');
    const node = block.getByRole('link', { name: 'Seoul · Han', exact: true });
    await expect(node).toBeVisible();
    await expect(node).toHaveAttribute('href', `#/nodes/${encodeURIComponent('Seoul · Han')}`);
    await expect(block.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Seoul · Han', exact: true }) })).toContainText('待核对');
  });

  test('导出是一个能点开的链接', async ({ page }) => {
    await open(page, LEDGER);
    await expect(page.getByRole('link', { name: '导出 CSV' }))
      .toHaveAttribute('href', /months\/2026-09\/export\.csv/);
  });

  test('记一笔外币，存之前就看得到折多少人民币', async ({ page }) => {
    await open(page, LEDGER, 'default', sessionFor('ledger-add'));
    await page.getByRole('button', { name: '记一笔' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByLabel('类型').selectOption({ value: 'cost' });
    await drawer.getByLabel('类目').selectOption({ value: 'server' });
    await drawer.getByLabel('对象').selectOption({ value: 'Tokyo · Fuji' });
    await drawer.getByLabel('金额').fill('12.00');
    await drawer.getByLabel('币种').selectOption({ value: 'USD' });
    await drawer.getByLabel('付款日').fill('2025-01-01');
    await drawer.getByLabel('备注').fill('续了一个月');

    await expect(drawer.getByText('按 2026-09-08 汇率 7.1342 ≈ ¥85.61')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('ledger-drawer.png');

    await drawer.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('41 笔')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: '续了一个月' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('12.00 USD');
    await expect(row).toContainText('¥85.61');
  });

  /**
   * The currency is the kind's business, not the operator's. Money coming in
   * only ever arrives in yuan, so those three kinds lock the field and say
   * why; a bill opens on dollars because that is what the invoices are in, and
   * stays changeable because some of them are not.
   */
  test('收款只收人民币，支出默认美元', async ({ page }) => {
    await open(page, LEDGER, 'default', sessionFor('ledger-cny'));
    await page.getByRole('button', { name: '记一笔' }).click();

    const drawer = page.getByRole('dialog');
    const currency = drawer.getByLabel('币种');
    await expect(currency).toHaveValue('CNY');
    await expect(currency).toBeDisabled();
    await expect(drawer.getByText('收款只收人民币')).toBeVisible();

    await drawer.getByLabel('类型').selectOption({ value: 'cost' });
    await expect(currency).toHaveValue('USD');
    await expect(currency).toBeEnabled();
    await expect(drawer.getByText('收款只收人民币')).toHaveCount(0);

    // A currency the operator picked survives the trip through a locked kind;
    // the dollar default only ever fills the field the lock left behind.
    await currency.selectOption({ value: 'EUR' });
    await drawer.getByLabel('类型').selectOption({ value: 'refund' });
    await expect(currency).toHaveValue('CNY');
    await drawer.getByLabel('类型').selectOption({ value: 'cost' });
    await expect(currency).toHaveValue('USD');
  });

  /** The hub's half of the same rule, and the sentence it comes back as. */
  test('收入记成外币，中间层也不收', async ({ page }) => {
    const session = sessionFor('ledger-cny-refuse');
    await open(page, LEDGER, 'default', session);
    const refused = await page.request.post(`/api/v1/ops/ledger?session=${session}`, {
      data: {
        kind: 'revenue',
        category: 'plan',
        subjectType: 'user',
        subjectId: 'u-01',
        amountMinor: 12_800,
        currency: 'USD',
        month: '2026-09',
        paidAt: null,
        note: null,
      },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: '收款只收人民币' },
    });
  });

  test('汇率还没拉到的那天，直接说出来', async ({ page }) => {
    await page.route('**/api/v1/ops/fx?**', (route) => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'FX_RATE_MISSING', message: 'missing rate' } }),
    }));
    await open(page, LEDGER, 'default', sessionFor('ledger-fx'));
    await page.getByRole('button', { name: '记一笔' }).click();

    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('类型').selectOption({ value: 'cost' });
    await drawer.getByLabel('币种').selectOption({ value: 'USD' });
    await expect(drawer.getByText('2026-09-08 的汇率还没拉到，等入账日的汇率进来再记。')).toBeVisible();
  });

  test('冲正之后两笔都标上，说清楚落在哪个月', async ({ page }) => {
    await open(page, LEDGER, 'default', sessionFor('ledger-rev'));
    // Rows are looked for in 条目 only: the SLO table on the same page is a
    // thousand more rows for every role query to walk on each poll.
    const table = page.getByRole('heading', { name: '条目', exact: true }).locator('xpath=ancestor::section[1]');
    const original = table.getByRole('row').filter({ hasText: '客服号与短信' });
    await original.getByRole('button', { name: '冲正', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('冲正会在 2026 年 9 月 记一笔跟「客服号与短信」相反的账，原来那笔留着，标成已冲正。')).toBeVisible();
    await dialog.getByRole('button', { name: '冲正', exact: true }).click();
    // The dialog closes once the write has landed and the page has asked
    // again; until then it hides the table from every role query.
    await expect(dialog).toBeHidden();

    const both = table.getByRole('row').filter({ hasText: '客服号与短信' });
    await expect(both).toHaveCount(2);
    await expect(both.filter({ hasText: '已冲正' })).toHaveCount(1);
    await expect(both.filter({ hasText: '冲正的是这笔' })).toHaveCount(1);
    await expect(both.first()).toContainText('-¥200.00');
  });

  test('客户 360 上写着这一个月他值多少', async ({ page }) => {
    await open(page, '/customers/u-01');
    await page.getByRole('button', { name: /账务与用量/ }).click();
    await expect(page.getByText('本期收入')).toBeVisible();
    await expect(page.getByText('¥128.00')).toBeVisible();
    await expect(page.getByText('¥32.40')).toBeVisible();
    await expect(page.getByText('¥95.60')).toBeVisible();
  });

  test('成本没对上的客户，毛利那一栏写着待核对', async ({ page }) => {
    await open(page, '/customers/u-05');
    await page.getByRole('button', { name: /账务与用量/ }).click();
    await expect(page.getByText('待核对')).toBeVisible();
  });

  test('节点详情上写着这台机器每 GB 花了多少', async ({ page }) => {
    await open(page, `/nodes/${encodeURIComponent('Tokyo · Fuji')}`);
    await expect(page.getByText('每 GB 成本')).toBeVisible();
    await expect(page.getByText('¥0.11', { exact: true })).toBeVisible();
  });

  test('计量还没对上的机器，每 GB 成本写着待核对', async ({ page }) => {
    await open(page, `/nodes/${encodeURIComponent('Seoul · Han')}`);
    await expect(page.getByText('每 GB 成本')).toBeVisible();
    await expect(page.getByText('待核对', { exact: true })).toBeVisible();
  });

  test('改到期的时候可以顺手把这笔收入记上', async ({ page }) => {
    const session = sessionFor('ledger-renew');
    await open(page, '/customers/u-04', 'default', session);
    await page.getByRole('button', { name: '改到期' }).click();

    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('顺手记一笔套餐收入').check();
    await drawer.getByLabel('金额').fill('168.00');
    await drawer.getByRole('button', { name: '续 30 天' }).click();

    const ask = page.getByRole('dialog').filter({ hasText: '顺手在本月记一笔 ¥168.00 的套餐收入。' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: '续 30 天' }).click();

    await open(page, LEDGER, 'default', session);
    await expect(page.getByText('41 笔')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'wang.tao@example.com' })).toHaveCount(2);
  });

  test('锁定当前 UTC 月之后不能再接收冲正', async ({ page }) => {
    const session = sessionFor('ledger-close');
    await open(page, LEDGER, 'default', session);
    await page.getByRole('button', { name: '锁定本月' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/收入 ¥2,402\.00，支出 ¥1,789\.80，毛利 ¥612\.20，3 项还没对上。/)).toBeVisible();
    await expect(dialog).toContainText('这也是当前 UTC 月，锁定后本月不能再接收冲正。');
    await dialog.getByRole('button', { name: '锁定', exact: true }).click();

    await expect(page.getByText(/已锁定 · owner@example\.test/)).toBeVisible();
    await expect(page.getByText('这个月已经锁了，不能改；冲正只能记入未锁定的当前 UTC 月。')).toBeVisible();
    await expect(page.getByRole('button', { name: '记一笔' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '改备注' }).first()).toBeDisabled();
    await expect(page.getByRole('button', { name: '冲正', exact: true }).first()).toBeDisabled();

    // The button being disabled is the console's half; the hub refusing the
    // write is the half that actually protects a closed month.
    const refused = await page.request.patch(
      `/api/v1/ops/ledger/led_seed0001?session=${session}`,
      { data: { note: 'x' } },
    );
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: { code: 'MONTH_CLOSED', message: '这个月已经锁了，只能冲正，不能改' },
    });
  });
});
