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

  /**
   * The handle is asked for at the one moment the operator is definitely
   * talking to the customer, and it has to survive the two-step onboarding —
   * the address is allow-listed on the first call and the record only exists
   * on the second, which is exactly where a field quietly gets dropped.
   */
  test('开通时填的微信号，客户 360 头上就写着', async ({ page }, testInfo) => {
    const session = fresh('onboard-wechat', testInfo);
    await open(page, '/customers', 'default', session);
    await page.getByRole('button', { name: '开通', exact: true }).click();

    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('客户邮箱').fill('qin.shu@example.com');
    await drawer.getByLabel('微信号').fill('wx_qin_shu');
    await drawer.getByRole('button', { name: '开通', exact: true }).click();
    await gate(page, /会进允许登录的名单/).getByRole('button', { name: '开通', exact: true }).click();
    await expect(page.getByText('还没登录，请客户先用这个邮箱在客户端收验证码')).toBeVisible();

    await page.getByRole('button', { name: '客户登录过了，再开通一次' }).click();
    await gate(page, /会进允许登录的名单/).getByRole('button', { name: '开通', exact: true }).click();
    await expect(page.getByText('已经在客户端登录过')).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();

    await settle(page);
    const row = page.locator('tbody tr').filter({ hasText: 'qin.shu@example.com' });
    await expect(row).toContainText('wx_qin_shu');
    await row.click();
    await expect(head(page)).toContainText('wx_qin_shu');
  });

  /** The 360 writes it, the list reads it: one value, both surfaces. */
  test('改了微信号，客户列表那一列跟着变', async ({ page }, testInfo) => {
    const session = fresh('wechat', testInfo);
    await open(page, '/customers/u-01', 'default', session);
    await expect(head(page)).toContainText('wx_chen_jie');
    await page.getByRole('button', { name: /账务与用量/ }).click();
    await page.getByRole('button', { name: '改账务' }).click();

    const drawer = page.getByRole('dialog');
    // The three operator-only fields read back now, so the form opens on what
    // is stored rather than on three empty boxes.
    await expect(drawer.getByLabel('微信号')).toHaveValue('wx_chen_jie');
    await drawer.getByLabel('微信号').fill('chenjie_2026');
    await drawer.getByRole('button', { name: '保存' }).click();

    const ask = gate(page, /会改这位客户的/);
    await expect(ask).toContainText('微信号');
    await ask.getByRole('button', { name: '保存' }).click();

    await settle(page);
    await expect(head(page)).toContainText('chenjie_2026');

    // The list belongs to the shell and is read once per load, so coming back
    // to it from the 360 is a reload — which is also the only way to prove the
    // hub kept the new handle rather than the page remembering it.
    await open(page, '/customers', 'default', session);
    await page.reload({ waitUntil: 'networkidle' });
    await settle(page);
    await expect(page.locator('tbody tr').filter({ hasText: 'chen.jie@example.com' }))
      .toContainText('chenjie_2026');
  });

  /** A customer nobody took a handle from says so, rather than showing a dash. */
  test('没留微信号的客户，头上写着找不到人', async ({ page }) => {
    await open(page, '/customers/u-09');
    await expect(head(page)).toContainText('没有微信号以后找不到人');
  });

  /**
   * The invite drawer is the whole of what exists for somebody who never
   * registered: three fields an operator fills in, and the two things that can
   * be done about them. Both writes go through the sign-up list, and both have
   * to survive the reload — a handle the next read does not carry is a handle
   * that was never saved.
   */
  test('名单上那一位的微信号改完，列表那一行跟着变', async ({ page }, testInfo) => {
    const session = fresh('invite', testInfo);
    await open(page, '/customers', 'default', session);
    const row = page.locator('tbody tr').filter({ hasText: 'tan.wei@example.com' });
    await expect(row).toContainText('未注册');
    await row.click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toContainText('开通 2 天还没注册');
    await drawer.getByLabel('微信号').fill('wx_tan_wei');
    await drawer.getByLabel('备注').fill('周三再催一次');
    await drawer.getByRole('button', { name: '保存' }).click();
    await settle(page);

    await expect(row).toContainText('wx_tan_wei');
    await page.reload({ waitUntil: 'networkidle' });
    await settle(page);
    await expect(page.locator('tbody tr').filter({ hasText: 'tan.wei@example.com' }))
      .toContainText('wx_tan_wei');
  });

  test('撤销开通之后这一行就不在表里了', async ({ page }, testInfo) => {
    const session = fresh('revoke', testInfo);
    await open(page, '/customers', 'default', session);
    await expect(page.getByRole('button', { name: '2 位开通了还没注册' })).toBeVisible();
    await page.locator('tbody tr').filter({ hasText: 'shu.qing@example.com' }).click();

    await page.getByRole('dialog').getByRole('button', { name: '撤销开通' }).click();
    const ask = gate(page, /再注册会被挡回去/);
    await ask.getByRole('button', { name: '撤销开通' }).click();
    await settle(page);

    await expect(page.locator('tbody tr').filter({ hasText: 'shu.qing@example.com' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '1 位开通了还没注册' })).toBeVisible();
  });

  /** The 360 leads with the step, not with 没连: this client never started. */
  test('还没连上过的客户，现在那一块写的是卡在哪一步', async ({ page }) => {
    await open(page, '/customers/u-06');
    const now = page.locator('section').filter({ hasText: '现在' }).first();
    await expect(now).toContainText('开通进度');
    await expect(now).toContainText('注册 5 天还没装客户端');
    await expect(now).not.toContainText('没连');
    // The header still carries the word, because what to think and what to do
    // are two different axes.
    await expect(head(page)).toContainText('还没用起来');
  });

  test('连上过的客户，画像里记着第一次连上是哪天', async ({ page }) => {
    await open(page, '/customers/u-04');
    await page.getByRole('button', { name: /账务与用量/ }).click();
    await expect(page.getByText('第一次连上')).toBeVisible();
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

/**
 * 跟进 and the draft: the two halves of answering a customer without starting
 * from nothing — the record of what was already said, and an answer assembled
 * from the fields rather than from memory.
 */
test.describe('客户回访与草稿', () => {
  test('记一条跟进之后客户列表那一列就写着它', async ({ page }, testInfo) => {
    const session = fresh('followup', testInfo);
    await open(page, '/customers/u-02', 'default', session);

    await page.getByLabel('这一条算什么').selectOption('callback');
    await page.getByLabel('写这次跟进').fill('周五回访，确认换线之后稳不稳');
    await page.getByLabel('什么时候回来看').fill('2026-09-11');
    await page.getByRole('button', { name: '记一条' }).click();
    await settle(page);
    await expect(page.getByText('周五回访，确认换线之后稳不稳')).toBeVisible();

    // The list is where the operator decides who to open next, so what is
    // still owed on somebody has to be visible without opening them.
    await open(page, '/customers', 'default', session);
    const row = page.locator('tbody tr').filter({ hasText: 'zhang.min@example.com' });
    await expect(row).toContainText('约定回访');
    await expect(row).toContainText('2026-09-11');
  });

  test('办结之后这一条不再挂在客户名下', async ({ page }, testInfo) => {
    const session = fresh('followup-done', testInfo);
    await open(page, '/customers/u-04', 'default', session);
    const owed = page.locator('div').filter({ hasText: /^等客户验证/ }).first();
    await expect(owed).toBeVisible();
    await page.getByRole('button', { name: '办结' }).first().click();
    await settle(page);
    await expect(page.getByRole('button', { name: '办结' })).toHaveCount(0);
  });

  test('重发凭证自己会在跟进里留一行', async ({ page }, testInfo) => {
    const session = fresh('auto-followup', testInfo);
    await open(page, '/customers/u-04', 'default', session);
    await head(page).getByRole('button', { name: '重发凭证' }).click();
    await gate(page, /台设备/).getByRole('button', { name: '重发凭证' }).click();
    await settle(page);
    await expect(page.getByText('已重发凭证')).toBeVisible();
  });

  /**
   * Every line of the draft is a field off this page: the attempt, the stage,
   * the code, the incident on that machine, a machine the engine still calls
   * healthy. Nothing in it is a cause the console decided on its own.
   */
  test('回复草稿逐句都能指回页面上的字段', async ({ page }) => {
    await open(page, '/customers/u-04');
    await page.getByRole('button', { name: '写一封回信' }).click();
    await settle(page);
    const draft = page.locator('textarea');
    await expect(draft).toHaveValue(/Los Angeles · Mesa/);
    await expect(draft).toHaveValue(/ECONNREFUSED/);
    await expect(draft).toHaveValue(/对方端口没人应答/);
    await expect(draft).toHaveValue(/这台机器现在有一条已登记的事故/);
    await expect(draft).toHaveValue(/建议先在客户端里换到 Tokyo · Fuji/);
    await expect(draft).toHaveValue(/想请您确认一件事/);
  });

  test('没有失败记录的客户不给草稿，只说为什么', async ({ page }) => {
    await open(page, '/customers/u-07');
    const button = page.getByRole('button', { name: '写一封回信' });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', /没有失败的连接记录/);
  });
});
