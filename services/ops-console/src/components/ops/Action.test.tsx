import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Action } from './Action';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  act(() => { createRoot(host).render(node); });
  return host;
}

it('keeps a blocked action focusable and links its reason through aria-describedby', () => {
  const host = mount(<Action reason="no endpoint yet">Restart</Action>);
  const button = host.querySelector('button');
  const described = button?.getAttribute('aria-describedby');
  expect(button?.getAttribute('aria-disabled')).toBe('true');
  expect(button?.hasAttribute('disabled')).toBe(false);
  expect(button?.getAttribute('title')).toBe('no endpoint yet');
  expect(described).toBeTruthy();
  expect(host.querySelector(`[id="${String(described)}"]`)?.textContent).toBe('no endpoint yet');
});

it('does not call onClick while the action is blocked', () => {
  const onClick = vi.fn();
  const blocked = mount(<Action reason="no endpoint yet" onClick={onClick}>Restart</Action>);
  act(() => { blocked.querySelector('button')?.click(); });
  expect(onClick).not.toHaveBeenCalled();
  const open = mount(<Action onClick={onClick}>Restart</Action>);
  act(() => { open.querySelector('button')?.click(); });
  expect(onClick).toHaveBeenCalledTimes(1);
});
