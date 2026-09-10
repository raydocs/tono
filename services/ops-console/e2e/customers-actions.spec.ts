import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { open, settle } from './ops';

/**
 * The writes the 客户 pages exist for, each one end to end: the console asks,
 * the fixture hub answers, the console reads back and the page agrees.
 *
 * Every test takes its own copy of the mutable store — one per project, so the
 * light and dark runs cannot onboard the same customer twice — and every one
 * of them goes through the confirmation, because that is the path a real
 * operator takes and a test that skips it is not testing the page.
 */

/** The gate in front of a write, found by the sentence it repeats. */
function gate(page: Page, consequence: RegExp) {
  return page.getByRole('dialog').filter({ hasText: consequence });
}

/**
 * A copy of the mutable fixture store nothing else has touched.
 *
 * Per project so the light and dark runs cannot onboard the same address, and
 * per run because the dev server outlives the suite: a second `npx playwright
 * test` against the same server would otherwise find the customer from the
 * first one already onboarded and the device already carrying an action.
 */
function fresh(name: string, testInfo: TestInfo): string {
  return `${name}-${testInfo.project.name}-${String(Date.now())}`;
}

/** The customer's own header, not the shell's. */
function head(page: Page) {
  return page.locator('.page-wrap > header');
}

test.describe('客户写动作', () => {
  test('开通一位客户之后列表里就有这一行', async ({ page }, testInfo) => {
    const session = fresh('onboard', testInfo);
    await open(page, '/customers', 'default', session);
    await page.getByRole('button', { name: '开通', exact: true }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('先让客户能用这个邮箱登录')).toBeVisible();
    await drawer.getByLabel('客户邮箱').fill('shen.yi@example.com');
    await drawer.getByRole('button', { name: '开通', exact: true }).click();

    // The hub allow-lists the address first and can do nothing else until the
    // customer has logged in, so the first answer is a checklist, not a row.
    const first = gate(page, /会进允许登录的名单/);
    await expect(first).toBeVisible();
    await first.getByRole('button', { name: '开通', exact: true }).click();
    await expect(page.getByText('还没登录，请客户先用这个邮箱在客户端收验证码')).toBeVisible();

    await page.getByRole('button', { name: '客户登录过了，再开通一次' }).click();
    await gate(page, /会进允许登录的名单/).getByRole('button', { name: '开通', exact: true }).click();
    await expect(page.getByText('已经在客户端登录过')).toBeVisible();

    await page.getByRole('button', { name: '取消' }).click();
    await settle(page);
    await expect(page.locator('tbody')).toContainText('shen.yi@example.com');
  });

  test('改到期之后头上写的就是新日期', async ({ page }, testInfo) => {
    const session = fresh('expiry', testInfo);
    await open(page, '/customers/u-04', 'default', session);
    await page.getByRole('button', { name: '改到期' }).click();
    await page.getByRole('button', { name: '续 30 天' }).click();

    const ask = gate(page, /的到期改成/);
    const said = await ask.getByText(/的到期改成/).textContent();
    const date = /(\d{4}-\d{2}-\d{2})/.exec(said ?? '')?.[1];
    expect(date).toBeTruthy();
    await ask.getByRole('button', { name: '续 30 天' }).click();

    await settle(page);
    await expect(head(page)).toContainText(date ?? '');
  });

  test('停用之后这位客户带着已停用的标', async ({ page }, testInfo) => {
    const session = fresh('close', testInfo);
    await open(page, '/customers/u-02', 'default', session);
    await expect(head(page)).not.toContainText('已停用');
    await page.getByRole('button', { name: '停用', exact: true }).click();

    const ask = gate(page, /马上不能登录/);
    await ask.getByLabel('停用原因').fill('退款');
    await ask.getByRole('button', { name: '停用', exact: true }).click();

    await settle(page);
    await expect(head(page)).toContainText('已停用');
    await expect(page.getByRole('button', { name: '恢复' })).toBeVisible();
  });

  test('绑上一条家宽之后家宽这一节写的是它', async ({ page }, testInfo) => {
    const session = fresh('home', testInfo);
    await open(page, '/customers/u-02', 'default', session);
    await expect(page.getByText('还没绑家宽，走的是节点的公共出口')).toBeVisible();
    await page.getByRole('button', { name: '绑定', exact: true }).click();

    const drawer = page.getByRole('dialog');
    // By value: the option's own words carry the address and the privacy
    // switch, and the id is what the console actually sends.
    await drawer.getByLabel('从库存里选').selectOption('home_fixture_03');
    await drawer.getByRole('button', { name: '绑定', exact: true }).click();

    const ask = gate(page, /的 Claude 流量改走/);
    await expect(ask).toContainText('Preview Catalog Line');
    await ask.getByRole('button', { name: '绑定', exact: true }).click();

    await settle(page);
    await expect(page.getByText('Preview Catalog Line')).toBeVisible();
    await expect(page.getByRole('button', { name: '解绑' })).toBeVisible();
  });

  test('下发一个设备动作之后这台机器上写着它排着', async ({ page }, testInfo) => {
    const session = fresh('action', testInfo);
    await open(page, '/customers/u-04', 'default', session);
    const card = page.locator('article').filter({ hasText: 'MacBook Pro' }).first();
    await expect(card.getByText('还没下发过动作')).toBeVisible();
    await card.getByRole('button', { name: '刷新目录' }).click();

    const ask = gate(page, /客户端下次上报时执行/);
    await expect(ask).toContainText('MacBook Pro');
    await ask.getByRole('button', { name: '已下发刷新目录' }).click();

    await settle(page);
    await expect(card.getByText('最近 刷新目录 · 待下发')).toBeVisible();
  });

  test('批量给选中的客户续 30 天', async ({ page }, testInfo) => {
    const session = fresh('cohort', testInfo);
    await open(page, '/customers', 'default', session);
    const rows = page.locator('tbody tr');
    await rows.nth(0).getByRole('checkbox').check();
    await rows.nth(1).getByRole('checkbox').check();
    await expect(page.getByText('选中 2 位客户')).toBeVisible();

    await page.getByRole('button', { name: '到期客户续 30 天' }).click();
    const ask = gate(page, /各自从今天和原到期日里靠后的那天起再加 30 天/);
    await ask.getByRole('button', { name: '到期客户续 30 天' }).click();
    await settle(page);
    // The dialog closes only when every customer in the cohort was moved.
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('改账务也要先说清楚改的是哪几项', async ({ page }, testInfo) => {
    const session = fresh('billing', testInfo);
    await open(page, '/customers/u-04', 'default', session);
    await page.getByRole('button', { name: /账务与用量/ }).click();
    await page.getByRole('button', { name: '改账务' }).click();

    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('套餐').selectOption('claude_20x');
    await drawer.getByLabel('联系方式').fill('wx: tao');
    await drawer.getByRole('button', { name: '保存' }).click();

    const ask = gate(page, /会改这位客户的/);
    await expect(ask).toContainText('套餐');
    await expect(ask).toContainText('联系方式');
    await ask.getByRole('button', { name: '保存' }).click();

    await settle(page);
    await expect(page.getByText('claude_20x')).toBeVisible();
  });

  test('头上四个按钮不再说接口未接入', async ({ page }) => {
    await open(page, '/customers/u-04');
    for (const label of ['发起远程诊断', '重发凭证', '改到期', '停用']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled();
    }
  });

  test('受保护路由证据和诊断报告都是折起来的事实', async ({ page }) => {
    await open(page, '/customers/u-04');
    await page.getByRole('button', { name: /受保护路由证据/ }).click();
    await expect(page.getByText('看到了独立的家宽路由')).toBeVisible();
    await expect(page.getByText('走家宽的连接')).toBeVisible();

    await page.getByRole('button', { name: /诊断报告/ }).click();
    await expect(page.getByText('DR-4471-0912')).toBeVisible();
  });
});
