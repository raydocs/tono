import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { assertCustomerSummary, type FunnelDto } from '@contract';
import captured from '../../fixtures/customers.json';
import { PrivacyProvider } from '@/lib/privacy';
import { CommandPalette } from './CommandPalette';

it('opens the selected invite when its private label matches a customer', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  const previousScroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = () => undefined;
  const previousUrl = window.location.href;
  localStorage.setItem('tono-ops-privacy', '1');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const customer = assertCustomerSummary({
    ...captured.list.items[0], userId: 'customer-alice', email: 'alice-one@example.test', wechatId: null,
  });
  const funnel: FunnelDto = { stages: [], updatedAt: 1, items: [{
    key: 'invite:alice-two@example.test', userId: null, email: 'alice-two@example.test',
    wechatId: null, contact: null, notes: null, stage: 'invited', stageSinceAt: 1, lastSeenAt: null,
  }] };
  try {
    await act(async () => root.render(
      <PrivacyProvider><CommandPalette customers={[customer]} funnel={funnel} nodes={[]} incidents={[]} /></PrivacyProvider>,
    ));
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })));
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]'))
      .filter((item) => item.textContent === 'al***@example.test');
    expect(rows).toHaveLength(2);
    await act(async () => rows[1].dispatchEvent(new MouseEvent('pointermove', { bubbles: true })));
    await act(async () => document.querySelector('[cmdk-root]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    ));
    expect(new URL(window.location.href).searchParams.get('invite')).toBe('alice-two@example.test');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.removeItem('tono-ops-privacy');
    window.history.replaceState({}, '', previousUrl);
    HTMLElement.prototype.scrollIntoView = previousScroll;
    vi.unstubAllGlobals();
  }
});
