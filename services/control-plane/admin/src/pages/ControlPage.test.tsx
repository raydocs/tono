import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ready = <T,>(data: T) => ({
  state: 'ready', data, message: '', reload: () => undefined, reloadNow: async () => data,
  refreshedAt: 0, stale: null, refreshing: false,
});

vi.mock('../api', () => ({
  operationsApi: { trafficPolicy: vi.fn(), catalogRevisions: vi.fn() },
}));
vi.mock('../ops-context', () => ({
  useOpsWorld: () => ({
    catalog: ready({ yaml: 'nodes: []\n', revision: 7, sha256: 'x', updatedAt: 1_800_000_000 }),
    activity: ready([]),
    people: [],
  }),
}));
vi.mock('../hooks', () => ({
  useRefresh: () => ({ refreshMs: 0, setRefreshMs: () => undefined }),
  useResource: () => ready({ policy: {}, revision: 3 }),
}));

import { ControlPage } from './ControlPage';

afterEach(cleanup);

describe('ControlPage', () => {
  it('reads catalog and policy only and sends edits to the one publisher in the new console', () => {
    render(<ControlPage />);
    expect(screen.queryByRole('textbox')).toBeNull();
    const links = screen.getAllByRole('link', { name: '去新后台编辑' }).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/ops2/#/settings/catalog', '/ops2/#/settings/policy']);
  });
});
