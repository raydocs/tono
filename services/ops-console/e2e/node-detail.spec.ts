import { expect, test, type Page } from '@playwright/test';
import { open, settle } from './ops';

const NODE = 'Tokyo · Fuji';
const DENSE = 'Singapore · Harbour（新加坡海港 · 大陆直连 · CMIN2） · 副本 6 · 香港中转 · 移动优先 · 备用观测点 07';

const page1 = (name: string) => `/nodes/${encodeURIComponent(name)}`;

/**
 * The reviewable copy: the baselines above are viewport-sized like the rest of
 * the suite, and this page is four screens tall. Written once, from the light
 * project, so the two projects do not race for the same file.
 */
async function keep(page: Page, name: string) {
  if (test.info().project.name !== 'light') return;
  await page.screenshot({ path: `docs/screenshots/node-detail-${name}.png`, fullPage: true });
}

/** Every block the plan asks for, in the order the page puts them. */
const SECTIONS = [
  '这台机器',
  '五处登记',
  '本周期流量',
  '客户连得上吗',
  '大陆回得来吗',
  '现在谁在用',
  '后台报错',
  '最近连接',
  '任务',
  '变更记录',
];

test.describe('node detail page', () => {
  test('the whole page, one machine with one thing wrong', async ({ page }) => {
    await open(page, page1(NODE));

    await expect(page.getByRole('heading', { name: NODE, level: 1 })).toBeVisible();
    await expect(page.getByText('劣化').first()).toBeVisible();
    for (const heading of SECTIONS) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }

    // The one registration nobody did is a chore, not an incident.
    await expect(page.getByText('身份同步 还没登记')).toBeVisible();

    // The two directions disagree, and the page says both.
    await expect(page.getByRole('heading', { name: '客户连得上吗' })).toBeVisible();
    await expect(page.getByText('回程好不代表客户连得上')).toBeVisible();

    await settle(page);
    await expect(page).toHaveScreenshot('normal.png');
    await keep(page, 'normal');
  });

  test('a long name and a full page of rows still line up', async ({ page }) => {
    await open(page, page1(DENSE), 'dense');

    await expect(page.getByRole('heading', { name: DENSE, level: 1 })).toBeVisible();
    await expect(page.getByText('被墙').first()).toBeVisible();

    // The engine writes one word where 凭什么 goes; the page says the sentence
    // and never the word.
    await expect(page.getByText('大陆三网都握不上手，像是被墙了')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('likely_blocked');
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(15);
    await expect(page.locator('tbody tr').first()).toHaveCSS('height', '36px');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await settle(page);
    await expect(page).toHaveScreenshot('dense.png');
    await keep(page, 'dense');
  });

  test('a machine nobody has measured says so in every block', async ({ page }) => {
    await open(page, page1(NODE), 'empty');

    // R2: nothing measured is never a zero, and never a green word.
    await expect(page.getByText('未测').first()).toBeVisible();
    await expect(page.getByText('还没有客户从大陆连过这台机器')).toBeVisible();
    await expect(page.getByText('现在没人用这台机器')).toBeVisible();
    await expect(page.getByText('还没有给这台机器派过活')).toBeVisible();

    // Retired: every action is off, and each one says why.
    await expect(page.getByRole('button', { name: '重启 Xray' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '退役' })).toBeDisabled();

    await settle(page);
    await expect(page).toHaveScreenshot('empty.png');
    await keep(page, 'empty');
  });

  test('a failing hub is an error, not an empty machine', async ({ page }) => {
    await open(page, page1(NODE), 'error');

    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('正常');
    await expect(page).toHaveScreenshot('error.png');
  });

  test('the fleet drawer opens the page it summarises', async ({ page }) => {
    await open(page, '/nodes');
    await page.locator('.node-card').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: '打开详情' }).click();
    await expect(page).toHaveURL(/#\/nodes\/.+/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '这台机器' })).toBeVisible();
  });

  test('an action states its consequence, then shows up in the job table', async ({ page }) => {
    await open(page, page1(NODE), 'default', 'node-pull-errors');

    await page.getByRole('button', { name: '拉取报错', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('取回来就显示在这一页');
    await expect(dialog).toContainText(NODE);

    await dialog.getByRole('button', { name: '就拉取报错' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const row = page.locator('tbody tr').filter({ hasText: '拉取报错' }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('排队中');
  });

  test('anything that changes the machine wants the name typed back', async ({ page }) => {
    await open(page, page1(NODE), 'default', 'node-unlist');

    await page.getByRole('button', { name: '下架', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('现在连着的人会被换到别的节点');
    const go = dialog.getByRole('button', { name: '就下架' });
    await expect(go).toBeDisabled();

    await dialog.getByRole('textbox').fill('Tokyo');
    await expect(dialog.getByText('和节点名不一样')).toBeVisible();
    await expect(go).toBeDisabled();

    await dialog.getByRole('textbox').fill(NODE);
    await expect(go).toBeEnabled();
  });

  test('a rule name in the history is read out as a sentence', async ({ page }) => {
    await open(page, page1(NODE));
    await page.getByRole('button', { name: /变更记录/ }).click();
    await expect(page.getByText('回程丢包偏高')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('carrier_loss');
  });

  /**
   * The block that was nine dashes on production, and the form that fills it.
   * The write has to survive the read that follows it: the page refetches, so
   * anything that only changed in the browser would vanish here.
   */
  test('the hand-kept facts can be typed in, and come back from the next read', async ({ page }) => {
    await open(page, page1(NODE), 'default', 'node-profile');

    await page.getByRole('button', { name: '编辑' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('这一页的价格、续费和额度');

    await drawer.getByLabel('价格').fill('7.5');
    await drawer.getByLabel('账期').fill('90');
    await drawer.getByLabel('备注').fill('换过一次机房');
    await drawer.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('$7.5 / 90 天')).toBeVisible();
    await expect(page.getByText('换过一次机房')).toBeVisible();
  });

  test('an allowance can be taken off again, and the gauge stops claiming one', async ({ page }) => {
    await open(page, page1(NODE), 'default', 'node-quota');

    await page.getByRole('button', { name: '编辑' }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('本周期流量').selectOption({ label: '不登记额度' });
    await drawer.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('未设额度').first()).toBeVisible();
  });
});

test.describe('node detail on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the page an owner opens on the way to the machine', async ({ page }) => {
    await open(page, page1(NODE));

    await expect(page.getByRole('heading', { name: NODE, level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await settle(page);
    await expect(page).toHaveScreenshot('phone.png');
    await keep(page, 'phone');
  });
});
