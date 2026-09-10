import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.describe('customers page', () => {
  test('table', async ({ page }) => {
    await open(page, '/customers');

    // The sentence the whole page is built around.
    await expect(page.getByRole('button', { name: '20 位客户' })).toBeVisible();
    await expect(page.getByRole('button', { name: '4 位正常' })).toBeVisible();
    await expect(page.getByRole('button', { name: '1 位连不上' })).toBeVisible();

    // R4 in the browser: the fragment, the rows it filters to, and the word
    // each of those rows carries all have to be the same answer. The count used
    // to read a connected flag the health word did not, and said 位在线 over a
    // table where not one row agreed.
    const well = page.getByRole('button', { name: /位正常$/ });
    await well.click();
    await settle(page);
    const claimed = Number((await well.textContent())?.match(/\d+/)?.[0]);
    const rows = page.locator('tbody tr');
    expect(await rows.count()).toBe(claimed);
    expect(await rows.filter({ hasText: '正常' }).count()).toBe(claimed);
    await well.click();
    await settle(page);

    // Three platforms have shipped nothing; they are shown, greyed, and say so.
    await expect(page.getByRole('button', { name: /Linux 未发布/ })).toBeDisabled();
    await expect(page.locator('tbody tr').first()).toHaveCSS('height', '36px');
    await expect(page).toHaveScreenshot('table.png');
  });

  test('privacy masks the addresses without hiding the rows', async ({ page }) => {
    await open(page, '/customers');
    const before = await page.locator('tbody tr').count();
    // The mask lives in the avatar menu now: it is a preference, not a fact.
    await page.getByRole('button', { name: '偏好' }).click();
    await page.getByRole('menuitemcheckbox', { name: '隐私' }).click();
    await settle(page);
    expect(await page.locator('tbody tr').count()).toBe(before);
    await expect(page.locator('tbody')).not.toContainText('wang.tao@example.com');
  });

  test('detail', async ({ page }) => {
    await open(page, '/customers/u-04');

    await expect(page.getByRole('heading', { name: 'wang.tao@example.com' })).toBeVisible();
    // The health word, and the four header actions, all of them now wired.
    await expect(page.getByText('连不上').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '发起远程诊断' }).first()).toBeEnabled();

    // Every block the plan asks for, in the plan's order.
    for (const heading of ['现在', '连接时间线', '使用时段', '流量去向', '服务使用', '按运营商的路径', '设备', '家宽', 'Claude 号']) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
    await settle(page);
    await expect(page).toHaveScreenshot('detail.png');
  });

  test('the timeline filters down to the failures that explain the word', async ({ page }) => {
    await open(page, '/customers/u-04');
    const before = await page.getByText('没连上').count();
    expect(before).toBeGreaterThan(0);
    await page.getByRole('button', { name: '只看失败' }).click();
    await settle(page);
    // Nothing but failures survives, and the successes are gone.
    await expect(page.getByText('连上', { exact: true })).toHaveCount(0);
    expect(await page.getByText('没连上').count()).toBe(before);
  });

  /**
   * The address is the row's name and the column that carries it is the one
   * with room to spare, so nothing is cut off at the width the console is read
   * at — and the whole address is on the element either way, for the hover.
   */
  test('the addresses are not clipped, and the whole one is there to read', async ({ page }) => {
    await open(page, '/customers');
    // The first cell is the selection box; the address is the one after it.
    await expect(page.locator('tbody tr').first().locator('td').nth(2).locator('div'))
      .toHaveAttribute('title', /@/);

    const table = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('thead th')]
        .map((th) => ({ head: th.textContent ?? '', width: th.getBoundingClientRect().width }));
      const clipped = [...document.querySelectorAll('tbody tr')]
        .map((tr) => {
          const span = tr.querySelectorAll('td')[2].querySelector('span');
          return span ? span.scrollWidth - span.clientWidth : 0;
        })
        .reduce((worst, over) => Math.max(worst, over), 0);
      return { heads, clipped };
    });
    const widest = table.heads.reduce((a, b) => (b.width > a.width ? b : a));
    expect(widest.head).toBe('客户');
    expect(table.clipped).toBeLessThanOrEqual(0);
  });

  /**
   * The handle sits beside the address because the two answer the same
   * question — which person is this row — and it hides as a group the way the
   * last three columns do, so a fleet where nobody gave one keeps its width.
   */
  test('微信号 has a column of its own, and the addresses still fit', async ({ page }) => {
    await open(page, '/customers');
    await expect(page.getByRole('columnheader', { name: '微信' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'chen.jie@example.com' }))
      .toContainText('wx_chen_jie');

    const widest = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('thead th')]
        .map((th) => ({ head: th.textContent ?? '', width: th.getBoundingClientRect().width }));
      return heads.reduce((a, b) => (b.width > a.width ? b : a)).head;
    });
    expect(widest).toBe('客户');
  });

  /**
   * ⌘K is where an operator lands who knows this person by their handle and
   * not by the address they signed up with. It matches on the real id — that
   * is what gets typed — and still prints it masked once privacy is on.
   */
  test('⌘K finds a customer by 微信号', async ({ page }) => {
    await open(page, '/nodes');
    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox').fill('wx_wang_tao');
    const found = dialog.getByRole('option').first();
    await expect(found).toContainText('wang.tao@example.com');
    await found.click();
    await expect(page).toHaveURL(/#\/customers\/u-04/);
  });

  test('⌘K still finds them by 微信号 with the addresses masked', async ({ page }) => {
    await open(page, '/customers');
    await page.getByRole('button', { name: '偏好' }).click();
    await page.getByRole('menuitemcheckbox', { name: '隐私' }).click();
    await settle(page);

    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox').fill('wx_wang_tao');
    const found = dialog.getByRole('option').first();
    // Matched on the real handle, printed with its middle taken out.
    await expect(found).toContainText('wx***ao');
    await expect(found).not.toContainText('wx_wang_tao');
  });

  /**
   * 开通漏斗: the second sentence on the page, and the one an operator reads in
   * the morning. R4 in the browser again — press a segment, and the rows you
   * get are the people it just counted.
   */
  test('漏斗的每一段点下去，表里就是这一段数出来的人', async ({ page }) => {
    await open(page, '/customers');
    await expect(page.getByRole('button', { name: '2 位开通了还没注册' })).toBeVisible();
    await expect(page.getByRole('button', { name: '17 位连上过' })).toBeVisible();

    const stuck = page.getByRole('button', { name: /位注册了还没装客户端$/ });
    await stuck.click();
    await settle(page);
    const claimed = Number((await stuck.textContent())?.match(/\d+/)?.[0]);
    const rows = page.locator('tbody tr');
    expect(await rows.count()).toBe(claimed);
    await expect(rows.first()).toContainText('还没用起来');

    // The invited people are rows of the same table, with a neutral tag where
    // a health word would be and their handle beside the address.
    await page.getByRole('button', { name: /位开通了还没注册$/ }).click();
    await settle(page);
    await expect(page.locator('tbody tr')).toHaveCount(2);
    const invited = page.locator('tbody tr').filter({ hasText: 'shu.qing@example.com' });
    await expect(invited).toContainText('未注册');
    await expect(invited).toContainText('wx_shu_qing');
  });

  /** 还没用起来 is a chore, not a fault: it never wears an incident's colour. */
  test('还没用起来 从来不当事故上色', async ({ page }) => {
    await open(page, '/customers');
    await expect(page.getByRole('button', { name: '3 位还没用起来' })).toBeVisible();
    const row = page.locator('tbody tr').filter({ hasText: 'sun.yan@example.com' });
    await expect(row).toContainText('还没用起来');
    await expect(row.locator('.tone-sev, .tone-warn')).toHaveCount(0);
  });

  /**
   * Somebody who was opened and never registered has no 360 to open, so ⌘K
   * lands on the only thing there is of them: the invite drawer.
   */
  test('⌘K 用微信号找得到名单上还没注册的人', async ({ page }) => {
    await open(page, '/nodes');
    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox').fill('wx_shu_qing');
    const found = dialog.getByRole('option').first();
    await expect(found).toContainText('shu.qing@example.com');
    await found.click();
    await expect(page).toHaveURL(/invite=shu\.qing%40example\.com/);
    await expect(page.getByRole('dialog')).toContainText('开通 6 天还没注册');
  });

  test('a row opens its own page, not a drawer', async ({ page }) => {
    await open(page, '/customers');
    await page.locator('tbody tr').first().click();
    await expect(page).toHaveURL(/#\/customers\/u-/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
