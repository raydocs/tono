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

test('every cell of the version matrix sits inside its card', async ({ page }) => {
  await open(page, '/clients');

  const card = page.locator('.clients-matrix');
  await expect(card).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  const cardRight = cardBox.x + cardBox.width;
  const cells = page.locator('.clients-matrix :is(th, td)');
  const count = await cells.count();
  // Platform plus the four bands, a header row and the released platforms.
  expect(count).toBeGreaterThanOrEqual(10);
  for (let i = 0; i < count; i += 1) {
    const cell = cells.nth(i);
    const box = (await cell.boundingBox())!;
    const label = (await cell.textContent()) ?? `cell ${i}`;
    expect(box.x + box.width, `${label} must end inside the card`).toBeLessThanOrEqual(cardRight + 0.5);
    const fit = await cell.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(fit.scroll, `${label} must not be clipped`).toBeLessThanOrEqual(fit.client);
  }
  // No sideways scroll inside the card either, and the third column's header shows whole.
  const inner = await card.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(inner.scroll).toBeLessThanOrEqual(inner.client);
  const behindOne = page.getByRole('columnheader', { name: '落后一版' });
  await expect(behindOne).toBeInViewport({ ratio: 1 });
});
