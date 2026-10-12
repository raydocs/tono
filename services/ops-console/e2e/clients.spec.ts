import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.describe('clients page', () => {
  test('matrix and releases', async ({ page }) => {
    await open(page, '/clients');

    // 未上报 stopped being zero when the funnel arrived: two customers have a
    // macOS client that was installed and has never reported a version.
    await expect(page.getByText('11 位在最新版 · 10 位落后 · 2 位未上报')).toBeVisible();
    // Three platforms have shipped nothing: they get no row of zeros to
    // misread, one sentence names them instead.
    await expect(page.getByText('Linux · Android · iOS 还没有发布过客户端')).toBeVisible();
    await expect(page.getByRole('heading', { name: '版本分布' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '发布' })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('clients.png');
  });

  /**
   * R4 across two machines: the Worker counted the cell, the browser filters
   * the list, and a cell claiming five people that produces four rows is the
   * old "高丢包 2 / 高丢包 8" bug one page apart.
   */
  test('a cell hands over exactly the customers it counted', async ({ page }) => {
    await open(page, '/clients');
    const cell = page.locator('a[href="#/customers?platform=macos&bucket=behind_more"]');
    const claimed = Number(await cell.textContent());
    await cell.click();

    await expect(page).toHaveURL(/#\/customers\?platform=macos&bucket=behind_more/);
    // The chips arrive already pressed, so the filter can be undone.
    await expect(page.getByRole('button', { name: /^macOS/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^落后两版以上/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tbody tr')).toHaveCount(claimed);
    await settle(page);
    await expect(page).toHaveScreenshot('customers-bucket.png');
  });

  test('the version bands only appear once a platform is chosen', async ({ page }) => {
    await open(page, '/customers');
    await expect(page.getByRole('button', { name: /^最新/ })).toHaveCount(0);
    await page.getByRole('button', { name: /^macOS/ }).click();
    await settle(page);
    await expect(page.getByRole('button', { name: /^最新/ })).toBeVisible();
  });

  /**
   * The write path end to end: the PATCH lands, the console refetches, and the
   * row comes back saying what the server now believes.
   */
  test('withdrawing a release changes what the next read returns', async ({ page }, testInfo) => {
    await open(page, '/clients', 'default', `release-${testInfo.project.name}`);
    const row = page.locator('tbody tr').filter({ hasText: '1.8.1' }).first();
    await row.getByRole('button', { name: '撤回' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('这只在后台把 1.8.1 标记为已撤回');
    await expect(dialog).toContainText('不会修改客户端更新源');
    await dialog.getByRole('button', { name: '撤回' }).click();

    await expect(row).toContainText('已撤回');
    await expect(row.getByRole('button', { name: '撤回' })).toHaveCount(0);
  });

  test('setting the floor repeats what it does and what it does not', async ({ page }, testInfo) => {
    await open(page, '/clients', 'default', `floor-${testInfo.project.name}`);
    const row = page.locator('tbody tr').filter({ hasText: '1.9.0-rc1' }).first();
    await row.getByRole('button', { name: '设最低支持版本' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('1.8.0');
    await expect(dialog).toContainText('不会被停用');
    await dialog.getByRole('button', { name: '设最低支持版本' }).click();
    await expect(row).toContainText('1.8.0');
  });

  /**
   * Register release end to end: the bucket's files are listed with the registered one
   * last and tagged, picking one pre-fills the form from its file name, and
   * saving makes the draft row appear in the table after the refetch.
   */
  test('registering a bucket file pre-fills the form and adds a draft row', async ({ page }, testInfo) => {
    const session = `register-${testInfo.project.name}-${testInfo.repeatEachIndex}-${testInfo.retry}`;
    await open(page, '/clients', 'default', session);
    await page.getByRole('button', { name: '登记发布' }).click();

    const drawer = page.getByRole('dialog');
    const files = drawer.getByRole('listitem');
    await expect(files).toHaveCount(3);
    await expect(files.first()).toContainText('Tono-1.9.0-build1900-arm64.zip');
    await expect(files.last()).toContainText('clients/macos/1.8.1.zip');
    await expect(files.last()).toContainText('已登记');

    await files.first().getByRole('button').click();
    await expect(drawer.getByLabel(/^平台/)).toHaveValue('macos');
    await expect(drawer.getByLabel(/^版本/)).toHaveValue('1.9.0');
    await expect(drawer.getByLabel(/^构建号/)).toHaveValue('1900');
    await drawer.getByRole('button', { name: '保存' }).click();

    await expect(drawer).toBeHidden();
    const draft = page.locator('tbody tr')
      .filter({ hasText: /(?<![\d.])1\.9\.0(?![-\d.])/ })
      .filter({ hasText: '待发布' });
    await expect(draft).toHaveCount(1);
  });

  test('a cut-short scan of the bucket says so', async ({ page }, testInfo) => {
    await page.route('**/api/v1/ops/releases/objects*', async (route) => {
      const response = await route.fetch();
      const body = await response.json() as Record<string, unknown>;
      await route.fulfill({ response, json: { ...body, truncated: true } });
    });
    await open(page, '/clients', 'default', `register-cut-${testInfo.project.name}-${testInfo.repeatEachIndex}-${testInfo.retry}`);
    await page.getByRole('button', { name: '登记发布' }).click();
    await expect(page.getByRole('dialog').getByText('只读了前 2000 个文件，没读到的可能有更新的')).toBeVisible();
  });

  test('a file with no stored digest asks for one', async ({ page }, testInfo) => {
    await open(page, '/clients', 'default', `register-sha-${testInfo.project.name}-${testInfo.repeatEachIndex}-${testInfo.retry}`);
    await page.getByRole('button', { name: '登记发布' }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('listitem').filter({ hasText: 'Tono-1.8.3-setup.exe' }).getByRole('button').click();
    await expect(drawer.getByLabel(/^平台/)).toHaveValue('windows');
    await expect(drawer.getByText('这个文件在存储里没有记校验值')).toBeVisible();
    await drawer.getByRole('button', { name: '保存' }).click();
    await expect(drawer.getByText('校验值要 64 位小写十六进制')).toBeVisible();
  });

  test('a fleet with no releases says so instead of showing an empty grid', async ({ page }) => {
    await open(page, '/clients', 'empty');
    await expect(page.getByText('还没有发布过客户端')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('位在最新版');
    await expect(page).toHaveScreenshot('empty.png');
  });

  test('the dense set keeps five platforms in one grid', async ({ page }) => {
    await open(page, '/clients', 'dense');
    // Every platform has shipped, so there is nobody for the sentence to name.
    await expect(page.getByText('还没有发布过客户端')).toHaveCount(0);
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(20);
    await settle(page);
    await expect(page).toHaveScreenshot('dense.png');
  });
});
