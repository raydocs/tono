import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/pages/CustomerDetail';
import { App } from '@/app/App';
import { copy } from '@/copy/copy';

const api = vi.hoisted(() => ({
  detail: vi.fn(), patch: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  const list = async () => ({ items: [] });
  return { ...original, opsApi: { customer: api.detail, customerConnections: list,
    customerActivity: list, customerDestinations: list, customerServices: list,
    nodes: list, customers: list, funnel: async () => ({}), incidents: list, releases: list, systemHealth: async () => ({}) } };
});
vi.mock('@/lib/api-customer-actions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api-customer-actions')>(),
  customerApi: { accountDetail: async () => null, homeBinding: async () => null,
    patchUser: api.patch },
}));
vi.mock('@/lib/api-ledger', () => ({ ledgerApi: { month: () => new Promise(() => {}) } }));
vi.mock('@/app/Shell', () => ({ Shell: ({children}: { children?: ReactNode }) => children }));
vi.mock('@/lib/use-fleet', () => ({ useFleet: () => ({ status: 'loading' }) }));
vi.mock('@/lib/use-poll', () => ({ useBeat: () => 0 }));
vi.mock('@/lib/privacy', () => ({ usePrivacy: () => ({ email: (v: string) => v }) }));
vi.mock('@/components/ops/DetailDrawer', () => ({
  Fact: () => null, DetailDrawer: ({open, children}: { open: boolean; children?: ReactNode }) => open ? children : null,
}));
vi.mock('@/components/ops/Action', () => ({
  Action: ({children, onClick, reason, pending}: { children?: ReactNode; onClick?: () => void; reason?: string | null; pending?: boolean }) => <button disabled={!!reason || !!pending} onClick={onClick}>{children}</button>,
  ActionRow: ({children}: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ops/ConfirmDialog', () => ({
  ConfirmDialog: ({open, consequence, confirm, onConfirm}: { open: boolean; consequence: string; confirm: string; onConfirm: () => void }) => open ? <div><p>{consequence}</p><button onClick={onConfirm}>{confirm}</button></div> : null,
}));
vi.mock('@/components/ops/Section', () => ({
  Section: ({children}: { children?: ReactNode }) => <div>{children}</div>,
  FoldedSection: ({children}: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ops/Empty', () => ({
  Empty: ({message}: { message: string }) => <p>{message}</p>, EmptyLine: ({message}: { message: string }) => <p>{message}</p>,
}));
vi.mock('@/components/ops/HeatStrip', () => ({ HeatStrip: () => null }));
vi.mock('@/components/ops/StatusWord', () => ({ StatusWord: () => null }));
vi.mock('@/pages/customer/Header', () => ({ CustomerHeader: () => null, CustomerWechat: () => null }));
vi.mock('@/pages/customer/ChoreList', () => ({ CustomerChores: () => null }));
vi.mock('@/pages/customer/CarrierMatrix', () => ({ CarrierMatrix: () => null }));
vi.mock('@/pages/customer/ClaudeAccount', () => ({ ClaudeAccount: () => null }));
vi.mock('@/pages/customer/Destinations', () => ({ Destinations: () => null }));
vi.mock('@/pages/customer/Devices', () => ({ Devices: () => null }));
vi.mock('@/pages/customer/Followups', () => ({ Followups: () => null }));
vi.mock('@/pages/customer/HomeLine', () => ({ HomeLine: () => null }));
vi.mock('@/pages/customer/now-facts', () => ({ nowFacts: () => [] }));
vi.mock('@/pages/customer/Proof', () => ({ Proof: () => null }));
vi.mock('@/pages/customer/Quota', () => ({ Quota: () => null }));
vi.mock('@/pages/customer/ReplyDraft', () => ({ ReplyDraft: () => null }));
vi.mock('@/pages/customer/Services', () => ({ ServiceUsage: () => null }));
vi.mock('@/pages/customer/Timeline', () => ({ Timeline: () => null }));
vi.mock('@/pages/diagnostics/CustomerDiagnostics', () => ({ CustomerDiagnostics: () => null }));

const customerA = {
  userId: 'customer-a', email: 'customer-a@example.com', lifecycle: 'active', health: 'ok',
  reason: null, wechatId: null, contact: null, notes: null, devices: [], chores: [],
  firstConnectedAt: null, updatedAt: 1,
  billing: { plan: null, deviceLimit: 1, quotaBytes: null,
    usageBytes: { value: 12345, asOfSec: 1, source: 'profile' }, expiresAt: null,
    firstEntitledAt: null, createdAt: 1 },
};

it('clears the previous customer and billing actions when navigation to a new customer fails', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.patch.mockClear();
  api.detail.mockClear();
  let rejectB!: (error: Error) => void;
  api.detail.mockImplementation((id: string) => id === 'customer-a' ? Promise.resolve(customerA) : new Promise((_r, reject) => { rejectB = reject; }));
  window.history.replaceState(null, '', '#/customers/customer-a');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<App />); });
    expect(host.querySelector('h1')?.textContent).toBe('customer-a@example.com');
    await act(async () => {
      window.history.replaceState(null, '', '#/customers/customer-b');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(api.detail.mock.calls.map(([id]) => id)).toEqual(['customer-a', 'customer-b']);
    await act(async () => { rejectB(new Error('Transient read failure')); });
    const reset = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === copy.resetUsage);
    if (reset) {
      await act(async () => { reset.click(); });
      const confirm = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === copy.resetUsageConfirm)!;
      await act(async () => { confirm.click(); });
    }
    expect(api.patch).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('customer-a@example.com');
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    window.history.replaceState(null, '', '#/today');
  }
});
