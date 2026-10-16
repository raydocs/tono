import { expect, test } from '@playwright/test';
import { open } from './ops';

test.use({ viewport: { width: 390, height: 844 } });

const TAP_TARGET = 44;

for (const { name, hash } of [
  { name: 'clients', hash: '/clients' },
  { name: 'providers', hash: '/settings/providers' },
]) {
  test(`${name}: 重试 on a phone is a finger tall`, async ({ page }) => {
    await open(page, hash, 'error');

    const main = page.getByRole('main');
    await expect(main.getByRole('alert').first()).toBeVisible();
    await expect(main.getByText('载入中')).toHaveCount(0);
    const retry = main.getByRole('button', { name: '重试', exact: true }).first();
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
    const box = await retry.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(TAP_TARGET);
  });
}
