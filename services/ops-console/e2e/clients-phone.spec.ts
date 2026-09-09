import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.use({ viewport: { width: 390, height: 844 } });

test('the version matrix survives a phone', async ({ page }) => {
  await open(page, '/clients');

  await expect(page.getByRole('heading', { name: '版本分布' })).toBeVisible();
  // The grid scrolls inside its own box; the page must not scroll sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await settle(page);
  await expect(page).toHaveScreenshot('clients.png');
});
