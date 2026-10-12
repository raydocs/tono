import { expect, test } from '@playwright/test';
import { copy } from '../src/copy/copy';
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
    // Node, failure and service cells stay on their line, so every row is 36 px.
    const heights = await page.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.getBoundingClientRect().height));
    expect(heights.slice(0, 8)).toEqual(Array(8).fill(36));
    expect(heights.filter((height) => height !== 36)).toEqual([]);
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
    await expect(page.locator('tbody tr').first().locator('td').nth(2).locator('div[title]'))
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
   * The production page showed "Los Angeles ·" (the site cut off) in the node
   * cell and "12 小…" over "TONO_S…" in the failure cell. Both cells now keep
   * each line on one line: a text too long for its column ends in its own
   * ellipsis (never a clipped glyph, never a taller row), the node never ends
   * on the separator, a known code reads as its Chinese sentence with the raw
   * code on the hover, and the first service name is never the part that is cut.
   */
  test('the node, failure and service cells are cut only by their own ellipsis', async ({ page }) => {
    await open(page, '/customers', 'dense');
    const cells = await page.evaluate(() => {
      const column = (name: string) => {
        const index = [...document.querySelectorAll('thead th')].findIndex((th) => th.textContent?.trim() === name);
        return [...document.querySelectorAll('tbody tr')].map((row) => row.querySelectorAll('td')[index]!);
      };
      /** Wider than what shows: only a span that ends in an ellipsis may be. */
      const ellipsis = (span: Element) => {
        const style = getComputedStyle(span);
        return style.textOverflow === 'ellipsis' && style.overflow === 'hidden' && style.whiteSpace === 'nowrap';
      };
      const clipped = (cell: Element) => cell.scrollWidth > cell.clientWidth + 1
        || [...cell.querySelectorAll('span')].some((span) => span.scrollWidth > span.clientWidth + 1 && !ellipsis(span));
      const read = (cell: Element) => ({
        text: (cell.textContent ?? '').trim(),
        lines: [...cell.querySelectorAll('span > span')].map((line) => (line.textContent ?? '').trim()),
        title: cell.querySelector('[title]')?.getAttribute('title') ?? null,
        clipped: clipped(cell),
        height: cell.getBoundingClientRect().height,
        first: cell.querySelector('span span')?.getBoundingClientRect().width ?? 0,
        firstNatural: (cell.querySelector('span span') as HTMLElement | null)?.scrollWidth ?? 0,
      });
      return {
        node: column('当前节点').map(read),
        failure: column('最近失败').map(read),
        services: column('服务使用').map(read),
      };
    });

    const named = cells.node.filter((cell) => cell.text !== '—');
    expect(named.length).toBeGreaterThan(20);
    for (const cell of cells.node) {
      expect(cell.text.endsWith('·')).toBe(false);
      expect(cell.clipped, cell.text).toBe(false);
      // Each line is a whole segment: no line ends in a separator or carries a cut one.
      for (const line of cell.lines) {
        expect(line.endsWith('·'), line).toBe(false);
        expect(line, line).not.toContain('· …');
      }
    }
    // The upper line is only the first segment of the name, never the middle ones too.
    for (const cell of named) {
      expect(cell.lines.length, cell.text).toBeLessThanOrEqual(2);
      if (cell.lines.length === 2) expect(cell.lines[0], cell.text).not.toContain(' · ');
      expect(cell.title!.startsWith(cell.lines[0]!), cell.text).toBe(true);
    }

    const failed = cells.failure.filter((cell) => cell.text !== '—');
    expect(failed.length).toBeGreaterThan(3);
    for (const cell of cells.failure) expect(cell.clipped, cell.text).toBe(false);
    for (const cell of failed) {
      expect(cell.text).toContain(copy.codeWord[cell.title as keyof typeof copy.codeWord]);
      expect(cell.text).not.toContain(cell.title!);
    }

    const served = cells.services.filter((cell) => cell.text !== '—');
    expect(served.length).toBeGreaterThan(10);
    for (const cell of cells.services) {
      expect(cell.clipped, cell.text).toBe(false);
      // 其他 leads only when it is the only service.
      if (cell.text.startsWith(copy.serviceName.other)) expect(cell.title).toBe(copy.serviceName.other);
      // The first name is whole; only what follows it may end in an ellipsis.
      expect(cell.first, cell.text).toBeGreaterThanOrEqual(cell.firstNatural - 1);
    }
  });

  test('expiry dates fit their cell content box without taking identity space', async ({ page }) => {
    await open(page, '/customers');
    const geometry = await page.evaluate(() => {
      const index = [...document.querySelectorAll('thead th')]
        .findIndex((th) => th.textContent?.trim() === '到期');
      const dates = [...document.querySelectorAll('tbody tr')].flatMap((row) => {
        const cell = row.querySelectorAll('td')[index];
        if (!cell || !/^\d{4}-\d{2}-\d{2}$/.test(cell.textContent?.trim() ?? '')) return [];
        const range = document.createRange();
        range.selectNodeContents(cell);
        const text = range.getBoundingClientRect();
        const box = cell.getBoundingClientRect();
        const style = getComputedStyle(cell);
        return [{
          textLeft: text.left, textRight: text.right,
          contentLeft: box.left + parseFloat(style.paddingLeft),
          contentRight: box.right - parseFloat(style.paddingRight),
        }];
      });
      return { dates, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    expect(geometry.dates.length).toBeGreaterThan(0);
    for (const date of geometry.dates) {
      expect(date.textLeft).toBeGreaterThanOrEqual(date.contentLeft - 1);
      expect(date.textRight).toBeLessThanOrEqual(date.contentRight + 1);
    }
    expect(geometry.overflow).toBe(0);
  });

  /**
   * The handle is the quiet second line of the customer cell, under the
   * address: the two answer the same question, and a column of its own cost the
   * failure sentence and the follow-up date the width they needed.
   * The search box still matches it.
   */
  test('the WeChat id is the second line of the customer cell, not a column', async ({ page }) => {
    await open(page, '/customers');
    await expect(page.getByRole('columnheader', { name: '微信' })).toHaveCount(0);
    const first = page.locator('tbody tr').first().locator('td').nth(2);
    await expect(first).toContainText('chen.jie@example.com');
    await expect(first.locator('span[title="wx_chen_jie"]')).toBeVisible();
    await expect(first.locator('span[title="wx_chen_jie"]')).toHaveText('wx_chen_jie');

    const geometry = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('thead th')]
        .map((th) => ({ head: th.textContent ?? '', width: th.getBoundingClientRect().width }));
      const ids = [...document.querySelectorAll('tbody tr td:nth-child(3) span[title^="wx_"]')]
        .map((span) => span.scrollWidth - span.clientWidth);
      return { widest: heads.reduce((a, b) => (b.width > a.width ? b : a)).head, ids };
    });
    expect(geometry.widest).not.toBe('');
    expect(geometry.ids.length).toBeGreaterThan(10);
    // The whole id is there; the ellipsis is only a safety net.
    for (const over of geometry.ids) expect(over).toBeLessThanOrEqual(0);

    await page.getByRole('searchbox').fill('wx_wang_tao');
    await settle(page);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('wang.tao@example.com');
  });

  /**
   * A service list is the first name whole and a count of the rest, never a
   * partial name or a trailing dot; the follow-up date is never cut; and the
   * longest failure sentence has the column it needs.
   */
  test('the service, follow-up and failure cells never show a cut value', async ({ page }) => {
    await open(page, '/customers');
    const cells = await page.evaluate(() => {
      const index = (name: string) => [...document.querySelectorAll('thead th')]
        .findIndex((th) => th.textContent?.trim() === name);
      const cell = (row: number, name: string) => document.querySelectorAll('tbody tr')[row]!
        .querySelectorAll('td')[index(name)]!;
      const text = [...document.querySelectorAll('tbody td')].map((td) => (td.textContent ?? '').trim());
      /** How far the text itself reaches past the right edge of the cell's content box. */
      const reach = (span: Element, td: Element) => {
        const range = document.createRange();
        range.selectNodeContents(span);
        const style = getComputedStyle(td);
        return range.getBoundingClientRect().right - (td.getBoundingClientRect().right - parseFloat(style.paddingRight));
      };
      const failure = cell(0, '最近失败');
      const sentence = [...failure.querySelectorAll('span')].at(-1)!;
      const followup = cell(3, '跟进');
      const date = [...followup.querySelectorAll('span')].at(-1)!;
      const services = cell(3, '服务使用');
      return {
        text,
        services: { text: (services.textContent ?? '').trim(), title: services.querySelector('[title]')?.getAttribute('title') ?? '' },
        sentence: { text: sentence.textContent, over: Math.max(sentence.scrollWidth - sentence.clientWidth, reach(sentence, failure)) },
        date: { text: date.textContent, over: Math.max(date.scrollWidth - date.clientWidth, reach(date, followup)), nowrap: getComputedStyle(date).whiteSpace },
      };
    });
    for (const text of cells.text) {
      expect(text, text).not.toContain('· …');
      expect(text.endsWith('·'), text).toBe(false);
    }
    // Row 4 uses four services: the first by name, the other three as a count, all four on the hover.
    const named = cells.services.title.split(' · ');
    expect(named).toHaveLength(4);
    expect(cells.services.text).toBe(`${named[0]}+3`);
    expect(cells.sentence.text).toBe(copy.codeWord.CATALOG_STALE);
    expect(cells.sentence.over).toBeLessThanOrEqual(0.5);
    expect(cells.date.text).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(cells.date.nowrap).toBe('nowrap');
    expect(cells.date.over).toBeLessThanOrEqual(0.5);
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
