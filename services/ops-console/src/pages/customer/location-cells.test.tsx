import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { copy } from '@/copy/copy';
import { nowSec } from '@/lib/clock';
import { FailureCell, NodeCell } from './location-cells';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  act(() => { createRoot(host).render(node); });
  return host;
}

it('puts the city above the site and keeps the whole node name on the hover', () => {
  const name = 'Los Angeles · Pacific-Coast-Highway-Backhaul-01';
  const host = mount(<NodeCell name={name} />);
  const lines = [...host.querySelectorAll('span > span')].map((line) => line.textContent);
  expect(lines).toEqual(['Los Angeles', 'Pacific-Coast-Highway-Backhaul-01']);
  expect(host.firstElementChild?.getAttribute('title')).toBe(name);
});

it('reads a known failure code as its Chinese sentence, with the raw code on the hover', () => {
  const host = mount(<FailureCell failure={{ at: nowSec() - 3600, node: 'Tokyo · Fuji', stage: 'dial', code: 'ETIMEDOUT' }} />);
  const lines = [...host.querySelectorAll('span > span')].map((line) => line.textContent);
  expect(lines[1]).toBe(copy.codeWord.ETIMEDOUT);
  expect(host.firstElementChild?.getAttribute('title')).toBe('ETIMEDOUT');
});

it('prints a failure code the map has no sentence for as it came', () => {
  const host = mount(<FailureCell failure={{ at: nowSec() - 3600, node: 'Tokyo · Fuji', stage: 'dial', code: 'TONO_SOMETHING_NEW' }} />);
  const lines = [...host.querySelectorAll('span > span')].map((line) => line.textContent);
  expect(lines[1]).toBe('TONO_SOMETHING_NEW');
  expect(host.firstElementChild?.getAttribute('title')).toBe('TONO_SOMETHING_NEW');
});
