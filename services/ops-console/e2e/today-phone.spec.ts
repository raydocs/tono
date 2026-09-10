import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.use({ viewport: { width: 390, height: 844 } });

/**
 * This is the page the owner opens from a Telegram alert, on a phone, one
 * handed. If it scrolls sideways or hides the action behind the fold it has
 * failed at the only job it has.
 */
test('the incident page survives a phone', async ({ page }) => {
  await open(page, '/today');

  await expect(page.getByText('现在 2 个事故，影响 5 位客户')).toBeVisible();
  const first = page.locator('.incident-row').first();
  await expect(first).toBeVisible();
  await expect(first.getByRole('button', { name: '认领' })).toBeInViewport();

  // The rail keeps its icons and drops its words; the page must not scroll sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot('today.png');
});

test('the drawer comes up from the bottom with its actions pinned there', async ({ page }) => {
  await open(page, '/today?incident=inc-node-la');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await settle(page);

  // It is a bottom sheet: the panel sits on the bottom edge, not the right one.
  const sheet = await drawer.boundingBox();
  const view = page.viewportSize()!;
  expect(sheet!.x).toBeLessThanOrEqual(1);
  expect(Math.round(sheet!.y + sheet!.height)).toBe(view.height);

  // The reason anybody opened it is on screen without scrolling the timeline.
  await expect(drawer.getByRole('button', { name: '标记已处理' })).toBeInViewport();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot('drawer.png');
});
