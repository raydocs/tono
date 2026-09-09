import { expect, test } from '@playwright/test';
import { open } from './ops';

test.use({ viewport: { width: 390, height: 844 } });

test('the incident page placeholder survives a phone', async ({ page }) => {
  await open(page, '/today');

  // The rail keeps its icons and drops its words; the page must not scroll sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot('today.png');
});
