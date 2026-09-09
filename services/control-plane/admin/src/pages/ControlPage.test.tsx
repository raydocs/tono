import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `ControlPage` pulls many contexts (ops world, privacy, refresh) and an API
// client. Mock the seams so only the page + the real presentational `ui` +
// pure `lib/*` helpers run. The point under test is the beforeunload guard:
// it must arm on `hasUnpublishedDraft` (draft !== base), not on the phase
// label, so it stays armed through 'publishing'/'conflict'/'error' when a
// dirty draft is stranded, and releases the instant baseText := draft.

const mocks = vi.hoisted(() => ({
  operationsApi: {
    replaceCatalog: vi.fn(),
    replaceTrafficPolicy: vi.fn(),
    trafficPolicy: vi.fn(),
    catalogRevisions: vi.fn(),
  },
  // Reassigned per test via `setWorld`/`setPolicy`.
  worldHolder: { current: null as unknown as Record<string, unknown> },
  policyHolder: { current: null as unknown as Record<string, unknown> },
}));

vi.mock('../api', () => ({ operationsApi: mocks.operationsApi }));
vi.mock('../ops-context', () => ({
  useOpsWorld: () => mocks.worldHolder.current,
}));
vi.mock('../privacy', () => ({
  usePrivacy: () => ({
    privacy: false,
    setPrivacy: () => undefined,
    email: (v: string) => v,
    ip: (v: string | null | undefined) => v || '—',
    money: (v: string) => v,
    secret: (v: string | null | undefined) => v || '—',
  }),
}));
vi.mock('../hooks', () => ({
  useRefresh: () => ({ refreshMs: 0, setRefreshMs: () => undefined }),
  useResource: (load: unknown) => {
    if (load === mocks.operationsApi.trafficPolicy) return mocks.policyHolder.current;
    if (load === mocks.operationsApi.catalogRevisions) {
      return { state: 'ready', data: [], message: '', reload: () => undefined, reloadNow: async () => [], refreshedAt: 0, stale: null, refreshing: false };
    }
    return { state: 'loading' };
  },
}));

import { ControlPage } from './ControlPage';

// ---- test infra helpers ------------------------------------------------

function createDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const ONLINE_YAML = 'nodes:\n  - a\n  - b\n';
const ONLINE_POLICY = '{"webDomains":[],"tcpEndpoints":[],"homeExits":[]}';

function makeCatalogLive(opts: { revision?: number; yaml?: string; reloadNow?: () => Promise<unknown>; reload?: () => void } = {}) {
  return {
    state: 'ready' as const,
    data: { revision: opts.revision ?? 5, yaml: opts.yaml ?? ONLINE_YAML, updatedAt: 1_700_000_000 },
    reload: opts.reload ?? vi.fn(),
    reloadNow: opts.reloadNow ?? vi.fn(async () => ({ revision: 5, yaml: ONLINE_YAML, updatedAt: 1_700_000_000 })),
    refreshedAt: 0,
    stale: null,
    refreshing: false,
  };
}

function makePolicyLive(opts: { revision?: number; json?: string; reloadNow?: () => Promise<unknown> } = {}) {
  return {
    state: 'ready' as const,
    data: { revision: opts.revision ?? 3, json: opts.json ?? ONLINE_POLICY, updatedAt: 1_700_000_000 },
    reload: vi.fn(),
    reloadNow: opts.reloadNow ?? vi.fn(async () => ({ revision: 3, json: ONLINE_POLICY, updatedAt: 1_700_000_000 })),
    refreshedAt: 0,
    stale: null,
    refreshing: false,
  };
}

let beforeUnloadHandlers: Array<(e: Event) => void>;
let realAdd: typeof window.addEventListener;
let realRemove: typeof window.removeEventListener;

function setupGuard() {
  beforeUnloadHandlers = [];
  realAdd = window.addEventListener.bind(window);
  realRemove = window.removeEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    if (type === 'beforeunload') beforeUnloadHandlers.push(listener as (e: Event) => void);
    else realAdd(type, listener, opts);
  }) as typeof window.addEventListener);
  vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | EventListenerOptions) => {
    if (type === 'beforeunload') {
      const i = beforeUnloadHandlers.indexOf(listener as (e: Event) => void);
      if (i >= 0) beforeUnloadHandlers.splice(i, 1);
    } else realRemove(type, listener, opts);
  }) as typeof window.removeEventListener);
}

function guardArmed(): boolean {
  return beforeUnloadHandlers.length > 0;
}

function fireBeforeUnload(): Event {
  const ev = new Event('beforeunload', { cancelable: true });
  for (const h of [...beforeUnloadHandlers]) (h as (e: Event) => void)(ev);
  return ev;
}

// Click the YAML editor's "开始编辑" button. There are two such buttons
// (yaml + policy); index 0 is the catalog card.
function clickStartYaml() {
  fireEvent.click(screen.getAllByRole('button', { name: '开始编辑' })[0]);
}

function yamlTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText('节点目录 YAML 原文') as HTMLTextAreaElement;
}

function setYamlDraft(text: string) {
  fireEvent.change(yamlTextarea(), { target: { value: text } });
}

function clickPublishYaml() {
  fireEvent.click(screen.getByRole('button', { name: '对照 diff 发布' }));
}

function clickReloadYaml() {
  fireEvent.click(screen.getByRole('button', { name: '重新加载线上版' }));
}

function clickConfirm() {
  fireEvent.click(screen.getByText('确认'));
}

function clickCancel() {
  fireEvent.click(screen.getByText('取消'));
}

function setWorld(catalog: ReturnType<typeof makeCatalogLive>) {
  mocks.worldHolder.current = {
    catalog,
    people: [],
    activity: { state: 'loading' },
  };
}

function setPolicy(policy: ReturnType<typeof makePolicyLive>) {
  mocks.policyHolder.current = policy;
}

// ---- tests -------------------------------------------------------------

describe('ControlPage beforeunload guard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.operationsApi.replaceCatalog.mockReset();
    mocks.operationsApi.replaceTrafficPolicy.mockReset();
    setWorld(makeCatalogLive());
    setPolicy(makePolicyLive());
    setupGuard();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not arm on a fresh mount (no draft, G4)', () => {
    render(<ControlPage />);
    expect(guardArmed()).toBe(false);
  });

  it('does not arm after "开始编辑" with a clean draft (G1)', () => {
    render(<ControlPage />);
    clickStartYaml();
    expect(guardArmed()).toBe(false);
  });

  it('arms when the yaml draft diverges from its baseline and reverts when cleaned (G1)', async () => {
    render(<ControlPage />);
    clickStartYaml();
    expect(guardArmed()).toBe(false);
    setYamlDraft(ONLINE_YAML + '\n# edited\n');
    await waitFor(() => expect(guardArmed()).toBe(true));
    // dispatching warns
    const ev = fireBeforeUnload();
    expect(ev.defaultPrevented).toBe(true);
    // revert to baseline -> releases
    setYamlDraft(ONLINE_YAML);
    await waitFor(() => expect(guardArmed()).toBe(false));
  });

  it('keeps exactly one listener across many keystrokes (no stacking, G7)', async () => {
    render(<ControlPage />);
    clickStartYaml();
    setYamlDraft(ONLINE_YAML + '1');
    await waitFor(() => expect(guardArmed()).toBe(true));
    for (let i = 2; i <= 10; i++) setYamlDraft(ONLINE_YAML + i);
    await waitFor(() => expect(guardArmed()).toBe(true));
    expect(beforeUnloadHandlers.length).toBe(1);
  });

  it('stays armed while the publish is in flight (publishing phase, G2)', async () => {
    const pending = createDeferred<{ revision: number }>();
    mocks.operationsApi.replaceCatalog.mockReturnValue(pending.promise);
    const catalog = makeCatalogLive();
    setWorld(catalog);
    render(<ControlPage />);
    clickStartYaml();
    setYamlDraft(ONLINE_YAML + '\n# publish-me\n');
    await waitFor(() => expect(guardArmed()).toBe(true));
    clickPublishYaml();
    clickConfirm();
    // publishing phase begins; guard must remain armed during the in-flight call
    await waitFor(() => expect(screen.getByText('发布中…')).toBeTruthy());
    expect(guardArmed()).toBe(true);
    // resolve to success and confirm release
    await act(async () => { pending.resolve({ revision: 6 }); await Promise.resolve(); });
    await waitFor(() => expect(guardArmed()).toBe(false));
  });

  it('stays armed after a 409 conflict (conflict phase, G2) and after dismissing the modal', async () => {
    const pending = createDeferred<{ revision: number }>();
    mocks.operationsApi.replaceCatalog.mockReturnValue(pending.promise);
    setWorld(makeCatalogLive());
    render(<ControlPage />);
    clickStartYaml();
    setYamlDraft(ONLINE_YAML + '\n# conflict-me\n');
    await waitFor(() => expect(guardArmed()).toBe(true));
    clickPublishYaml();
    clickConfirm();
    await waitFor(() => expect(screen.getByText('发布中…')).toBeTruthy());
    expect(guardArmed()).toBe(true);
    // server returns 409 -> throws -> catch matches /\(409\)|revision|冲突/ -> 'conflict'
    await act(async () => { pending.reject(new Error('版本冲突 (409)')); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText('版本冲突 409')).toBeTruthy());
    // draft untouched, base untouched -> guard still armed (the bug would have disarmed)
    expect(guardArmed()).toBe(true);
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
    // the Confirm modal stays open with the error message (setConfirm(null) is success-only)
    expect(screen.getByText(/草稿和冻结的基线还在/)).toBeTruthy();
    // dismissing the modal keeps the guard armed (draft still diverges)
    clickCancel();
    await waitFor(() => expect(screen.queryByRole('button', { name: '取消' })).toBeNull());
    expect(guardArmed()).toBe(true);
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('stays armed after a generic publish error (error phase, G2)', async () => {
    const pending = createDeferred<{ revision: number }>();
    mocks.operationsApi.replaceCatalog.mockReturnValue(pending.promise);
    setWorld(makeCatalogLive());
    render(<ControlPage />);
    clickStartYaml();
    setYamlDraft(ONLINE_YAML + '\n# err-me\n');
    await waitFor(() => expect(guardArmed()).toBe(true));
    clickPublishYaml();
    clickConfirm();
    await waitFor(() => expect(screen.getByText('发布中…')).toBeTruthy());
    // generic error that does NOT match the conflict regex -> 'error' phase
    await act(async () => { pending.reject(new Error('boom network down')); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText('发布失败')).toBeTruthy());
    expect(guardArmed()).toBe(true);
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('does NOT arm on a clean-draft reload failure (no false positive, G3)', async () => {
    // operator reverted to baseline -> 'editing-clean' -> click 重新加载线上版
    // (no confirm). catalog.reloadNow rejects -> phase 'error' while draft === base.
    const catalog = makeCatalogLive({ reloadNow: vi.fn(async () => { throw new Error('network down'); }) });
    setWorld(catalog);
    render(<ControlPage />);
    clickStartYaml();
    setYamlDraft(ONLINE_YAML); // equal to baseline => editing-clean
    await waitFor(() => expect(guardArmed()).toBe(false));
    clickReloadYaml();
    await waitFor(() => expect(screen.getByText('发布失败')).toBeTruthy());
    // draft === baseText still holds -> guard must remain disarmed
    expect(guardArmed()).toBe(false);
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it('releases the moment a reload success overwrites the draft (G5)', async () => {
    const catalog = makeCatalogLive({ reloadNow: vi.fn(async () => ({ revision: 7, yaml: 'nodes:\n  - fresh\n', updatedAt: 1_700_000_001 })) });
    setWorld(catalog);
    render(<ControlPage />);
    clickStartYaml();
    setYamlDraft(ONLINE_YAML + '\n# dirty\n');
    await waitFor(() => expect(guardArmed()).toBe(true));
    // dirty draft -> reload goes through the confirm flow
    clickReloadYaml();
    clickConfirm();
    // fetchOnline sets draft=baseText=fresh text -> equal -> guard releases
    await waitFor(() => expect(guardArmed()).toBe(false));
  });

  it('arms on policy-side divergence and keeps armed through policy error (G2 policy, G1 cross-side)', async () => {
    const pending = createDeferred<{ revision: number }>();
    mocks.operationsApi.replaceTrafficPolicy.mockReturnValue(pending.promise);
    setWorld(makeCatalogLive());
    setPolicy(makePolicyLive());
    render(<ControlPage />);
    fireEvent.click(screen.getAllByRole('button', { name: '开始编辑' })[1]);
    const policyArea = screen.getByLabelText('国内直连规则 JSON 原文') as HTMLTextAreaElement;
    fireEvent.change(policyArea, { target: { value: ONLINE_POLICY + ' ' } });
    await waitFor(() => expect(guardArmed()).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '对照 diff 保存' }));
    clickConfirm();
    await waitFor(() => expect(screen.getByText('发布中…')).toBeTruthy());
    expect(guardArmed()).toBe(true);
    await act(async () => { pending.reject(new Error('boom')); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText('发布失败')).toBeTruthy());
    expect(guardArmed()).toBe(true);
  });
});
