import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.describe('today page', () => {
  test('list', async ({ page }) => {
    await open(page, '/today');

    await expect(page.getByText('现在 2 个事故，影响 5 位客户')).toBeVisible();
    // Two open incidents, and exactly one primary action per row.
    await expect(page.locator('.incident-row')).toHaveCount(2);
    await expect(page.locator('.incident-row .ops-action-primary')).toHaveCount(2);

    // The primary is what moves the fault, by what broke; 认领 is beside it.
    const blocked = page.locator('.incident-row').first();
    await expect(blocked.getByRole('button', { name: '下架预览' })).toBeVisible();
    await expect(blocked.getByRole('button', { name: '认领' })).toBeVisible();
    await expect(page.locator('.incident-row').nth(1).getByRole('button', { name: '打开客户' }))
      .toBeVisible();
    await expect(page).toHaveScreenshot('list.png');
  });

  test('the resolved tab is a different list, not a filter on the same one', async ({ page }) => {
    await open(page, '/today');
    await page.getByRole('tab', { name: /最近恢复/ }).click();
    await settle(page);
    await expect(page.locator('.incident-row')).toHaveCount(5);
    // Nothing to act on: a recovered incident has no primary action.
    await expect(page.locator('.incident-row .ops-action-primary')).toHaveCount(0);
  });

  test('chores are counted apart from incidents and never coloured as one', async ({ page }) => {
    await open(page, '/today');
    await page.getByRole('tab', { name: /待办/ }).click();
    await settle(page);
    await expect(page.locator('.incident-row')).toHaveCount(0);
    await expect(page.locator('.ops-tag.tone-rem').first()).toBeVisible();
  });

  /**
   * The floor on the newest macOS release is 1.8.0, and five customers are
   * still on 1.7.9 — so the chore exists now that the release data does. It is
   * a chore and not an incident: nothing is broken and nobody gets cut off.
   */
  test('客户 below the supported floor become a 版本过旧 chore, not an incident', async ({ page }) => {
    await open(page, '/today');
    await page.getByRole('tab', { name: /待办/ }).click();
    await settle(page);

    const stale = page.locator('li').filter({ hasText: '版本过旧' });
    await expect(stale).toHaveCount(5);
    await expect(stale.first()).toContainText('还在跑 1.7.9');
    await expect(page.locator('.incident-row')).toHaveCount(0);
  });

  test('drawer', async ({ page }) => {
    await open(page, '/today');
    await page.locator('.incident-row').first().click();

    await expect(page).toHaveURL(/incident=inc-node-la/);
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    for (const block of ['证据', '受影响客户', '时间线', '推送记录', '动作']) {
      await expect(drawer.getByRole('heading', { name: block })).toBeVisible();
    }
    await settle(page);
    await expect(page).toHaveScreenshot('drawer.png');
  });

  /** The evidence is a measurement said out loud, never the engine's own key names. */
  test('the drawer explains itself without printing what it is made of', async ({ page }) => {
    await open(page, '/today?incident=inc-node-la');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toContainText('大陆扫描：疑似被墙');
    await expect(drawer).toContainText('联通回程丢包 10.4%');
    await expect(drawer).toContainText('30 分钟内 31 次失败');
    await expect(drawer).toContainText('负载 0.04，内存 12%');
    for (const leak of ['blockStatus', 'fails30m', 'LIKELY_BLOCKED', '{', '}']) {
      await expect(drawer, leak).not.toContainText(leak);
    }
  });

  test('a blocked node leads with the unlisting it is heading for', async ({ page }) => {
    await open(page, '/today');
    await page.locator('.incident-row').first()
      .getByRole('button', { name: '下架预览' }).click();
    await expect(page).toHaveURL(/#\/nodes\/.+/);
    await expect(page.getByRole('heading', { name: '这台机器' })).toBeVisible();
  });

  test('the drawer survives a reload, because it lives in the URL', async ({ page }) => {
    await open(page, '/today?incident=inc-node-la');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  /**
   * The write path end to end: the POST lands, the console refetches, and the
   * row comes back saying what the server now believes rather than what the
   * click hoped for.
   */
  test('acknowledging an incident changes what the next read returns', async ({ page }, testInfo) => {
    await open(page, '/today', 'default', `ack-${testInfo.project.name}`);
    const row = page.locator('.incident-row').first();
    await expect(row.getByRole('button', { name: '认领' })).toBeVisible();
    await row.getByRole('button', { name: '认领' }).click();
    await settle(page);
    await expect(page.locator('.incident-row').first().getByRole('button', { name: '标记已处理' }))
      .toBeVisible();
    // Still open — an ack is a claim, not a fix.
    await expect(page.getByText('现在 2 个事故，影响 5 位客户')).toBeVisible();
  });

  test('a quiet fleet says when the last one recovered', async ({ page }) => {
    await open(page, '/today', 'empty');
    await expect(page.getByText(/^现在没有事故。上次事故 .+ 已恢复。$/)).toBeVisible();
    await expect(page.locator('.incident-row')).toHaveCount(0);
    await expect(page).toHaveScreenshot('quiet.png');
  });
});
