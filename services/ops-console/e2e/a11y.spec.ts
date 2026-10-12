import { expect, test } from '@playwright/test';
import { open } from './ops';

const NODE = 'Tokyo · Fuji';

test.describe('keyboard and screen reader paths', () => {
  test('the skip link is the first stop and Enter lands focus in main', async ({ page }) => {
    await open(page, '/nodes');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: '跳到内容' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    expect(page.url()).toContain('#/nodes');
  });

  test('navigating by keyboard retitles the document and moves focus to main', async ({ page }) => {
    await open(page, '/nodes');
    await expect(page).toHaveTitle(/节点 · Tono/);
    const link = page.getByRole('navigation', { name: '业务导航' }).getByRole('link', { name: '客户', exact: true });
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press('Tab');
      if (await link.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveTitle(/客户 · Tono/);
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('a drawer takes focus in and hands it back to its opener on Escape', async ({ page }) => {
    await open(page, '/settings/providers');
    const opener = page.getByRole('button', { name: '新建账号' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('a blocked action stays focusable and states its reason', async ({ page }) => {
    await open(page, `/nodes/${encodeURIComponent(NODE)}`, 'empty');
    const retire = page.getByRole('button', { name: '退役', exact: true });
    await expect(retire).toHaveAttribute('aria-disabled', 'true');
    const reason = await retire.getAttribute('title');
    expect(reason).toBeTruthy();
    await expect(retire).toHaveAccessibleDescription(reason ?? '');
  });
});

test.describe('phone dock', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('every dock stop shows a focus outline', async ({ page }) => {
    await open(page, '/nodes');
    const seen: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el?.closest('.shell-dock')) return null;
        const style = getComputedStyle(el);
        return { name: el.textContent ?? '', style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
      });
      if (stop === null) continue;
      seen.push(stop.name);
      expect(stop.style).not.toBe('none');
      expect(stop.width).toBeGreaterThan(0);
    }
    expect(seen).toHaveLength(5);
  });
});
