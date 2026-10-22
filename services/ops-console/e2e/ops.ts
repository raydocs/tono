import { test, type Page } from '@playwright/test';

export type FixtureSet = 'default' | 'dense' | 'empty' | 'error';

/**
 * Open a console page against one of the dev server's fixture sets. The set
 * travels as a query parameter because `src/lib/api.ts` forwards it to the
 * fixture middleware — one dev server, four data shapes.
 */
export async function open(
  page: Page,
  hash: string,
  fixtures: FixtureSet = 'default',
  session?: string,
): Promise<void> {
  const params = new URLSearchParams();
  if (fixtures !== 'default') params.set('fixtures', fixtures);
  // Even opening inventory writes (automatic egress lookups). Isolate every
  // test, not just explicit write flows; keep the same store on navigation.
  params.set('session', session ?? sessionFor(`${test.info().testId}-${fixtures}`));
  const query = params.toString();
  await page.goto(`/ops/${query ? `?${query}` : ''}#${hash}`, { waitUntil: 'networkidle' });
  await settle(page);
}

/**
 * A fixture store of its own for one test, per project, repeat and retry: a
 * store left unlisted or edited by the previous run of the same test would
 * otherwise be what `--repeat-each` or a retry starts from.
 */
export function sessionFor(name: string): string {
  const info = test.info();
  return `${name}-${info.project.name}-${info.repeatEachIndex}-${info.retry}`;
}

/**
 * Wait for the things that would otherwise make a baseline flake: webfonts
 * swapping in, and the day bars taking their height from the layout.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const sparks = page.locator('[data-spark] .spark-bar');
  if (await sparks.count() > 0) await sparks.first().waitFor({ state: 'attached' });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

type Char = { char: string; top: number };

/** The visible, non-space characters under every match of `selector`, each with its line. */
async function visibleChars(page: Page, selector: string): Promise<Char[][]> {
  return page.locator(selector).evaluateAll((roots) => roots.map((root) => {
    const chars: { char: string; top: number }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (let i = 0; i < text.length; i += 1) {
        if (/\s/.test(text.charAt(i))) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const box = range.getBoundingClientRect();
        if (box.width > 0) chars.push({ char: text.charAt(i), top: box.top });
      }
    }
    return chars;
  }));
}

/**
 * The lines of `selector` that end in a middle dot: a separator whose next
 * visible character sits on a lower line is one that closes its line, which
 * reads as a typo. Measured per character, so it holds however the separator
 * and its neighbours are wrapped in markup.
 */
export async function linesEndingInDot(page: Page, selector: string): Promise<string[]> {
  return (await visibleChars(page, selector)).flatMap((chars) => chars.flatMap((entry, index) => {
    const next = chars[index + 1];
    return entry.char === '·' && next && next.top > entry.top + 2
      ? [`dot at y=${Math.round(entry.top)} closes its line before "${next.char}"`]
      : [];
  }));
}

/**
 * The lines of `selector` that begin with a middle dot: a separator whose
 * previous visible character sits on a higher line. Chinese layout forbids
 * this as much as a dot that ends a line.
 */
export async function linesStartingInDot(page: Page, selector: string): Promise<string[]> {
  return (await visibleChars(page, selector)).flatMap((chars) => chars.flatMap((entry, index) => {
    const before = chars[index - 1];
    return entry.char === '·' && (index === 0 || (before && before.top < entry.top - 2))
      ? [`dot at y=${Math.round(entry.top)} starts a line after "${before?.char ?? ''}"`]
      : [];
  }));
}

/** How many lines `phrase` occupies inside the first element matching `selector`. */
export async function phraseLines(page: Page, selector: string, phrase: string): Promise<number> {
  return page.locator(selector).first().evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(wanted);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      return new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size;
    }
    return -1;
  }, phrase);
}
