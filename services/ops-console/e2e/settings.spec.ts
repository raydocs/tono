import { expect, test, type Page } from '@playwright/test';
import { open, settle } from './ops';

const SECTIONS = [
  'alerts', 'catalog', 'policy', 'homeinventory',
  'homelines', 'providers', 'candidates', 'audit',
] as const;

/**
 * 设置 is eight surfaces behind one rail, so every one of them gets a baseline
 * in both the ready and the empty case. The empty half is the half that
 * matters: a settings page that renders a zero-row table where it should say
 * "还没有告警规则" is the one that lets an operator believe alerting is
 * configured.
 *
 * The three publishing sections get flow tests on top of the baselines,
 * because a picture of an editor proves nothing about what pressing 发布 does.
 */

/**
 * `?fixtures=conflict` is not one of the four sets `open` knows; it is a
 * per-request flag the settings fixtures read, so this one goes direct.
 */
async function openConflicting(page: Page, hash: string, session: string): Promise<void> {
  await page.goto(`/ops2/?fixtures=conflict&session=${session}#${hash}`, { waitUntil: 'networkidle' });
  await settle(page);
}

/** Type into a document editor without losing what is already in it. */
async function append(page: Page, label: string, line: string): Promise<void> {
  const box = page.getByLabel(label);
  const text = await box.inputValue();
  await box.fill(`${text}${line}`);
}
test.describe('设置', () => {
  for (const section of SECTIONS) {
    test(`${section} 有数据`, async ({ page }) => {
      await open(page, `/settings/${section}`);
      await expect(page.getByRole('navigation', { name: '设置' })).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`${section}.png`);
    });

    test(`${section} 空`, async ({ page }) => {
      await open(page, `/settings/${section}`, 'empty');
      await expect(page.getByRole('navigation', { name: '设置' })).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`${section}-empty.png`);
    });
  }

  test('没写分节的链接落在告警上', async ({ page }) => {
    await open(page, '/settings');
    await expect(page.getByRole('heading', { name: '告警', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '告警', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('每个分节都是能贴出去的链接', async ({ page }) => {
    await open(page, '/settings');
    await page.getByRole('link', { name: '操作记录' }).click();
    await expect(page).toHaveURL(/#\/settings\/audit/);
    await page.reload();
    await expect(page.getByRole('link', { name: '操作记录' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('谁在什么时候动了什么。')).toBeVisible();
  });

  /** The write path: the POST lands, the console refetches, the row is there. */
  test('新建的规则下一次读就能看到', async ({ page }, testInfo) => {
    await open(page, '/settings/alerts', 'default', `rule-${testInfo.project.name}`);
    await page.getByRole('button', { name: '新建规则' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByLabel('名称', { exact: true }).fill('家宽掉线');
    await drawer.getByLabel(/^发到哪儿/).fill('https://hooks.example.test/new');
    await drawer.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('cell', { name: '家宽掉线' })).toBeVisible();
    await expect(page.getByText('2 条规则')).toBeVisible();
  });

  test('删除前先说清楚删完会怎样', async ({ page }, testInfo) => {
    await open(page, '/settings/alerts', 'default', `del-${testInfo.project.name}`);
    await page.getByRole('cell', { name: 'node down' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '删除' }).click();

    await expect(page.getByText(/删掉「node down」之后/)).toBeVisible();
    await page.getByRole('button', { name: '删除' }).click();
    await expect(page.getByText('还没有告警规则，出事没人会被叫醒')).toBeVisible();
  });

  test('发送测试会留下一条投递记录', async ({ page }, testInfo) => {
    await open(page, '/settings/alerts', 'default', `test-${testInfo.project.name}`);
    await expect(page.getByText('已发').first()).toBeVisible();
    await page.getByRole('button', { name: '发送测试' }).click();
    await expect(page.getByText('待发')).toBeVisible();
    await expect(page.getByText('排着，还没发')).toBeVisible();
  });

  test('接受一个域名之后草案里就有它', async ({ page }, testInfo) => {
    await open(page, '/settings/candidates', 'default', `draft-${testInfo.project.name}`);
    await page.getByRole('button', { name: '接受', exact: true }).click();
    await expect(page.getByText('已接受').first()).toBeVisible();

    await page.getByRole('button', { name: '生成分流草案' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('这里只出草案，不改线上的分流规则。装进编辑器之后还得自己按发布。')).toBeVisible();
    await expect(dialog.locator('pre')).toContainText('bilibili.com');
  });

  test('筛选的数目和列表来自同一份清单', async ({ page }) => {
    await open(page, '/settings/candidates');
    await page.getByRole('button', { name: /已拒绝/ }).click();
    await expect(page.getByText('没有待定的域名')).toBeVisible();
    await page.getByRole('button', { name: /全部/ }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });

  /** Every write on the other five sections has to show up here, or it is not a log. */
  test('别的分节动过什么，操作记录里看得到', async ({ page }, testInfo) => {
    const session = `audit-${testInfo.project.name}`;
    await open(page, '/settings/candidates', 'default', session);
    await page.getByRole('button', { name: '拒绝', exact: true }).click();
    await expect(page.getByText('已拒绝').first()).toBeVisible();

    await open(page, '/settings/audit', 'default', session);
    await expect(page.getByRole('cell', { name: 'direct-candidate.reject' })).toBeVisible();
  });

  test('点一行就只看这个对象', async ({ page }) => {
    await open(page, '/settings/audit');
    await page.locator('tbody tr').first().click();
    await expect(page.getByRole('button', { name: '不筛了' })).toBeVisible();
  });

  test('家宽线路的抽屉里有这一个月的形状', async ({ page }) => {
    await open(page, '/settings/homelines');
    await page.getByRole('cell', { name: 'Preview Home Alpha' }).first().click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('最近 30 天，每根一天')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('homelines-drawer.png');
  });

  test('商家账号只显示打过码的邮箱', async ({ page }) => {
    await open(page, '/settings/providers');
    await expect(page.getByText('b***@example.test')).toBeVisible();
    await page.getByRole('cell', { name: 'bandwagon' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('存进去之前就打过码，只用来认人，认不出来再去密码管理器翻。')).toBeVisible();
    await expect(drawer.getByText('这里只填凭据的名字，不要填内容本身。')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('providers-drawer.png');
  });
  /** The publish is a compare-and-swap; landing one has to move the version. */
  test('发出去之后线上版本就是新的那一版', async ({ page }, testInfo) => {
    await open(page, '/settings/catalog', 'default', `catalog-${testInfo.project.name}`);
    await page.getByRole('button', { name: '开始编辑' }).click();
    await append(page, '节点目录原文', '# checked by hand\n');

    await page.getByRole('button', { name: '发布', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/这会改变所有客户端下次拉取的节点单子/)).toBeVisible();
    await dialog.getByRole('button', { name: '发布', exact: true }).click();

    await expect(page.getByText('线上从 r37 变成了 r38')).toBeVisible();
    await expect(page.getByText('线上 r38').first()).toBeVisible();
  });

  /** The expensive bug: a publish that lands on top of somebody else's. */
  test('目录在别人手里动过了就不发，并且说清楚差在哪儿', async ({ page }, testInfo) => {
    await openConflicting(page, '/settings/catalog', `conflict-${testInfo.project.name}`);
    await page.getByRole('button', { name: '开始编辑' }).click();
    await append(page, '节点目录原文', '# my own change\n');

    await page.getByRole('button', { name: '发布', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '发布', exact: true }).click();

    await expect(page.getByText('线上目录在你改的这段时间里变过了')).toBeVisible();
    await expect(page.getByText(/线上现在是 r38/)).toBeVisible();
    await expect(page.getByText(/线上多了 1 行/)).toBeVisible();
  });

  test('试运行把服务端要存的那份原文摆出来', async ({ page }, testInfo) => {
    await open(page, '/settings/policy', 'default', `dry-${testInfo.project.name}`);
    await page.getByRole('button', { name: '开始编辑' }).click();
    await page.getByRole('button', { name: '试运行' }).click();

    await expect(page.getByText('服务端会存成这样')).toBeVisible();
    await expect(page.locator('pre').first()).toContainText('bilibili.com');
    await expect(page.getByText('这份不签名也能发')).toBeVisible();
  });

  test('把候选草案装进分流规则的编辑器', async ({ page }, testInfo) => {
    await open(page, '/settings/candidates', 'default', `hand-${testInfo.project.name}`);
    await page.getByRole('button', { name: '接受', exact: true }).click();
    await page.getByRole('button', { name: '生成分流草案' }).click();
    await page.getByRole('button', { name: '把草案装进编辑器' }).click();

    await expect(page).toHaveURL(/#\/settings\/policy/);
    await expect(page.getByText('直连候选的草案已经放进编辑框，还没发布')).toBeVisible();
    await expect(page.getByLabel('分流规则原文')).toHaveValue(/bilibili\.com/);
  });

  test('批量导入把加了几条、跳过几条都说出来', async ({ page }, testInfo) => {
    await open(page, '/settings/homeinventory', 'default', `import-${testInfo.project.name}`);
    await page.getByRole('button', { name: '批量导入' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('家宽线路，一行一条').fill(
      '203.0.113.90:41090:carol:hunter2\n198.51.100.24:41080:alpha:whatever',
    );
    await dialog.getByRole('button', { name: '加入库存' }).click();

    await expect(dialog.getByText('加了 1 条 · 跳过 1 条')).toBeVisible();
    await expect(dialog.getByText('已经在库存里了')).toBeVisible();
  });

  test('停用一条线路，下一次读就是停用的', async ({ page }, testInfo) => {
    await open(page, '/settings/homeinventory', 'default', `toggle-${testInfo.project.name}`);
    const row = page.locator('tbody tr').filter({ hasText: 'Preview Catalog Line' });
    await row.getByRole('button', { name: '停用' }).click();
    await expect(row.getByRole('button', { name: '启用' })).toBeVisible();
  });

  test('绑着客户的线路删不掉，并且说清楚为什么', async ({ page }) => {
    await open(page, '/settings/homeinventory');
    const row = page.locator('tbody tr').filter({ hasText: 'Preview Home Alpha' });
    await expect(row.getByRole('button', { name: '删除' })).toBeDisabled();
    await expect(row.getByText('2 人')).toBeVisible();
  });
});
