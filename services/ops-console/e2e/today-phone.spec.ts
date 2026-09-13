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

/**
 * The whole three-in-the-morning path, one thumb: the list, the incident, and
 * the press that ends it.
 *
 * The two assertions that matter are both about the fold. Every verb the sheet
 * offers has to be whole on screen the moment it opens — a bar that needs a
 * scroll first is a bar that gets missed at 03:00 — and the one that ends the
 * incident still has to ask how it ended rather than writing a recovery
 * nobody measured.
 */
test('the bar on the bottom edge can end the incident without a scroll', async ({ page }) => {
  await open(page, '/today');

  await page.locator('.incident-row').first().locator('p.text-row').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await settle(page);

  const close = sheet.getByRole('button', { name: '标记已处理' });
  for (const button of [sheet.getByRole('button', { name: '认领' }), sheet.getByRole('button', { name: '静默 4 小时' }), close]) {
    await expect(button).toBeInViewport({ ratio: 1 });
    expect(Math.round((await button.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  }

  await close.click();
  const closure = page.getByRole('dialog', { name: '这条事故怎么收尾' });
  await expect(closure).toBeVisible();
  await expect(closure.getByRole('radio')).toHaveCount(3);
});
