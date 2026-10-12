import { expect, test, type Locator } from '@playwright/test';
import { open, sessionFor } from './ops';

test.use({ viewport: { width: 390, height: 844 } });

const TAP_TARGET = 44;
const NODE = 'Tokyo · Fuji';

/**
 * A control is pressed only after it has been measured: a thumb tall, and,
 * when the caller says so, already on screen. The desktop flows live in
 * node-detail.spec.ts and settings.spec.ts; this file is the same two paths
 * with the phone's two extra promises, that nothing pressed is under 44 px and
 * that the button which confirms is reachable.
 */
async function tap(control: Locator, options: { onScreen?: boolean } = {}): Promise<void> {
  await expect(control).toBeVisible();
  if (options.onScreen === true) await expect(control).toBeInViewport();
  const box = await control.boundingBox();
  expect(box, 'the control has a box').not.toBeNull();
  expect(box!.height, 'control height in px').toBeGreaterThanOrEqual(TAP_TARGET);
  await control.click();
}

test('下架 on a phone: every press is a thumb tall and the confirm is on screen', async ({ page }) => {
  await open(page, `/nodes/${encodeURIComponent(NODE)}`, 'default', sessionFor('phone-unlist'));

  await tap(page.getByRole('button', { name: '下架', exact: true }));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('现在连着的人会被换到别的节点');
  await dialog.getByRole('textbox').fill(NODE);

  const go = dialog.getByRole('button', { name: '就下架' });
  await expect(go).toBeEnabled();
  await tap(go, { onScreen: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(page.locator('.ops-tag').filter({ hasText: /^已下架$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '下架', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '上架', exact: true })).toBeEnabled();
});

test('新建商家账号 on a phone: every press is a thumb tall and 保存 is reachable', async ({ page }) => {
  await open(page, '/settings/providers', 'default', sessionFor('phone-provider'));

  await tap(page.getByRole('button', { name: '新建账号' }));
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('商家', { exact: true }).fill('vultr');
  await sheet.getByLabel(/^标签/).fill('Phone Edge');

  // The form is taller than the sheet; 保存 is reached by scrolling the sheet,
  // and has to be whole on screen once it has been.
  const save = sheet.getByRole('button', { name: '保存', exact: true });
  await save.scrollIntoViewIfNeeded();
  await tap(save, { onScreen: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(page.getByRole('cell', { name: 'Phone Edge' })).toBeVisible();
  await expect(page.getByText('2 个账号')).toBeVisible();
});
