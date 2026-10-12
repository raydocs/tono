import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { copy } from '@/copy/copy';
import { nowSec } from '@/lib/clock';
import { PageNote } from './PageNote';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  act(() => { createRoot(host).render(node); });
  return host;
}

const backfill = { windowsTotal: 8640, windowsFlattened: 8640, windowsProjected: 3200 };

it('keeps the estimate as one unbreakable phrase, after the progress and its comma', () => {
  const host = mount(<PageNote fetchedAt={nowSec()} backfill={backfill} />);
  const eta = host.querySelector('span.whitespace-nowrap')!;
  expect(eta.textContent).toBe(copy.backfillEta('140'));
  expect(eta.parentElement?.textContent).toBe(
    copy.backfillProgress('3200', '8640') + copy.backfillEta('140'),
  );
  expect(eta.parentElement?.firstChild?.textContent?.endsWith('，')).toBe(true);
});

it('spaces the dot between the stamp and the backfill like the headline dots', () => {
  const host = mount(<PageNote fetchedAt={nowSec()} backfill={backfill} />);
  const dot = host.querySelector('[aria-hidden]')!;
  expect(dot.textContent).toBe('·');
  expect(dot.classList.contains('mx-[.35em]')).toBe(true);
  expect(host.querySelector('p')!.className).not.toContain('gap-x-2');
});
