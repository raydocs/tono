import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { DotJoined } from './DotJoined';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  act(() => { createRoot(host).render(node); });
  return host;
}

it('puts each separator in its own aria-hidden span, hidden at phone width', () => {
  const host = mount(<DotJoined parts={['20 customers', '4 well', '1 down']} />);
  const seps = [...host.querySelectorAll('.dot-joined-sep')];
  expect(seps).toHaveLength(2);
  for (const sep of seps) {
    expect(sep.textContent).toBe('·');
    expect(sep.getAttribute('aria-hidden')).toBe('true');
    expect(sep.classList.contains('max-[640px]:hidden')).toBe(true);
    // The gap is margin, the same on both sides, not literal spaces.
    expect(sep.classList.contains('mx-[.35em]')).toBe(true);
  }
});

it('keeps every part whole, with no literal spaces around the dots', () => {
  const host = mount(<DotJoined parts={['11 current', '10 behind']} />);
  const parts = [...host.querySelectorAll('.whitespace-nowrap')].map((part) => part.textContent);
  expect(parts).toEqual(['11 current', '10 behind']);
  expect(host.textContent).toBe('11 current·10 behind');
});

it('wraps the parts as a gapped flex line at phone width', () => {
  const host = mount(<DotJoined parts={['a', 'b']} />);
  const line = host.querySelector('.dot-joined')!;
  for (const name of ['max-[640px]:flex', 'max-[640px]:flex-wrap', 'max-[640px]:gap-x-3', 'max-[640px]:gap-y-[2px]']) {
    expect(line.classList.contains(name), name).toBe(true);
  }
});

it('takes controls as parts, not only strings', () => {
  const host = mount(<DotJoined parts={[<button key="a" type="button">one</button>, <button key="b" type="button">two</button>]} />);
  expect(host.querySelectorAll('button')).toHaveLength(2);
  expect(host.querySelectorAll('.dot-joined-sep')).toHaveLength(1);
});
