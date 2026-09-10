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

/** The reviewable copy: this page is taller than the 900 px viewport. */
async function keep(page: Page, name: string) {
  if (test.info().project.name !== 'light') return;
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true });
}

test.describe('账目', () => {
  test('一个月的账，一页', async ({ page }) => {
    await open(page, LEDGER);
    await expect(page.getByRole('heading', { name: '账目', exact: true })).toBeVisible();
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
    const pending = page.getByRole('link', { name: 'zhao.lei@example.com' });
    await expect(pending).toHaveAttribute('href', '#/customers/u-05');
    await expect(page.getByRole('link', { name: 'Seoul · Han' })).toBeVisible();
    await expect(page.getByText('待核对').first()).toBeVisible();
  });

  test('导出是一个能点开的链接', async ({ page }) => {
    await open(page, LEDGER);
    await expect(page.getByRole('link', { name: '导出 CSV' }))
      .toHaveAttribute('href', /months\/2026-09\/export\.csv/);
  });

  test('记一笔外币，存之前就看得到折多少人民币', async ({ page }, testInfo) => {
    await open(page, LEDGER, 'default', `ledger-add-${testInfo.project.name}`);
    await page.getByRole('button', { name: '记一笔' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByLabel('类型').selectOption({ value: 'cost' });
    await drawer.getByLabel('类目').selectOption({ value: 'server' });
    await drawer.getByLabel('对象').selectOption({ value: 'Tokyo · Fuji' });
    await drawer.getByLabel('金额').fill('12.00');
    await drawer.getByLabel('币种').selectOption({ value: 'USD' });
    await drawer.getByLabel('备注').fill('续了一个月');

    await expect(drawer.getByText('按 2026-09-09 汇率 7.1342 ≈ ¥85.61')).toBeVisible();
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
  test('收款只收人民币，支出默认美元', async ({ page }, testInfo) => {
    await open(page, LEDGER, 'default', `ledger-cny-${testInfo.project.name}`);
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
  test('收入记成外币，中间层也不收', async ({ page }, testInfo) => {
    const session = `ledger-cny-refuse-${testInfo.project.name}`;
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

  test('汇率还没拉到的那天，直接说出来', async ({ page }, testInfo) => {
    await open(page, LEDGER, 'default', `ledger-fx-${testInfo.project.name}`);
    await page.getByRole('button', { name: '记一笔' }).click();

    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('类型').selectOption({ value: 'cost' });
    await drawer.getByLabel('币种').selectOption({ value: 'USD' });
    await drawer.getByLabel('付款日').fill('2025-01-01');
    await expect(drawer.getByText('2025-01-01 的汇率还没拉到，等今天的汇率进来再记，或者换一个付款日。')).toBeVisible();
  });

  test('冲正之后两笔都标上，说清楚落在哪个月', async ({ page }, testInfo) => {
    await open(page, LEDGER, 'default', `ledger-rev-${testInfo.project.name}`);
    const original = page.getByRole('row').filter({ hasText: '客服号与短信' });
    await original.getByRole('button', { name: '冲正', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('冲正会在 2026 年 9 月（按后台的月份算）记一笔跟「客服号与短信」相反的账，原来那笔留着，标成已冲正。')).toBeVisible();
    await dialog.getByRole('button', { name: '冲正', exact: true }).click();

    const both = page.getByRole('row').filter({ hasText: '客服号与短信' });
    await expect(both).toHaveCount(2);
    await expect(both.filter({ hasText: '已冲正' })).toHaveCount(1);
    const mirror = both.filter({ hasText: '冲正的是这笔' });
    await expect(mirror).toHaveCount(1);
    // Only the yuan flips. The original amount is what an invoice says, and
    // there is no invoice for minus two hundred yuan.
    await expect(mirror.getByRole('cell').nth(4)).toHaveText('¥200.00');
    await expect(mirror.getByRole('cell').nth(5)).toHaveText('-¥200.00');
  });

  /**
   * A reversal is written into the current month, so locking that month stops
   * it — and the page has to say so with the right month in the sentence, not
   * the one on screen.
   */
  test('本月锁上之后，冲正也落不进来', async ({ page }, testInfo) => {
    const session = `ledger-rev-locked-${testInfo.project.name}`;
    await open(page, LEDGER, 'default', session);
    await page.getByRole('button', { name: '锁定本月' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '锁定', exact: true }).click();
    await expect(page.getByText(/已锁定 · owner@example\.test/)).toBeVisible();

    await expect(page.getByText('这个月已经锁了，改不了；冲正也落在这个月，得等下个月再冲。')).toBeVisible();
    const reverse = page.getByRole('button', { name: '冲正', exact: true }).first();
    await expect(reverse).toBeDisabled();
    await expect(reverse).toHaveAttribute(
      'title',
      '本月（按后台的月份算）已经锁了，冲正落不进来，得等下个月。',
    );

    const refused = await page.request.post(
      `/api/v1/ops/ledger/led_seed0001/reverse?session=${session}`,
      { data: {} },
    );
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: 'MONTH_CLOSED' } });
  });

  /** The month locked out from under an open page: the hub's refusal, in words. */
  test('页面开着的时候月份被锁上，冲正说得清为什么没记成', async ({ page }, testInfo) => {
    const session = `ledger-rev-race-${testInfo.project.name}`;
    await open(page, LEDGER, 'default', session);
    const locked = await page.request.post(
      `/api/v1/ops/months/2026-09/close?session=${session}`,
      { data: {} },
    );
    expect(locked.status()).toBe(200);

    const original = page.getByRole('row').filter({ hasText: '客服号与短信' });
    await original.getByRole('button', { name: '冲正', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '冲正', exact: true }).click();
    await expect(page.getByText(
      '冲正落在本月（按后台的月份算），那个月已经锁上了，这一笔没记成，等下个月再冲。',
    ).first()).toBeVisible();
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
    await expect(page.getByText('¥0.11')).toBeVisible();
  });

  test('计量还没对上的机器，每 GB 成本写着待核对', async ({ page }) => {
    await open(page, `/nodes/${encodeURIComponent('Seoul · Han')}`);
    await expect(page.getByText('每 GB 成本')).toBeVisible();
    await expect(page.getByText('待核对')).toBeVisible();
  });

  test('改到期的时候可以顺手把这笔收入记上', async ({ page }, testInfo) => {
    const session = `ledger-renew-${testInfo.project.name}`;
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

  test('锁定之后只能冲正，改不了', async ({ page }, testInfo) => {
    const session = `ledger-close-${testInfo.project.name}`;
    await open(page, LEDGER, 'default', session);
    await page.getByRole('button', { name: '锁定本月' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/收入 ¥2,402\.00，支出 ¥1,789\.80，毛利 ¥612\.20，3 项还没对上。/)).toBeVisible();
    await dialog.getByRole('button', { name: '锁定', exact: true }).click();

    await expect(page.getByText(/已锁定 · owner@example\.test/)).toBeVisible();
    await expect(page.getByText('这个月已经锁了，改不了；冲正也落在这个月，得等下个月再冲。')).toBeVisible();
    // The count and the list under 待核对 are both read off the closed month,
    // so the tag and the rows under it still say the same number afterwards.
    await expect(page.getByText('3 项还没对上')).toBeVisible();
    await expect(page.locator('a[href^="#/customers/"], a[href^="#/nodes/"]')).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'zhao.lei@example.com' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Seoul · Han' })).toBeVisible();
    await expect(page.getByRole('button', { name: '记一笔' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '改备注' }).first()).toBeDisabled();

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
