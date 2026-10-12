import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { copy } from '@/copy/copy';
import { clusterStage, clusterStatus } from '@/copy/diagnostics';
import { ClusterRow } from './ClusterRow';
import type { FailureCluster } from './types';

const cluster: FailureCluster = {
  id: 'c1',
  code: 'TONO_NODE_OR_CORE_UNREACHABLE',
  stage: 'verifyingTraffic',
  appVersion: '0.0.75',
  platform: 'windows',
  node: 'Los Angeles · Marina',
  severity: 'p0',
  count: 4,
  users: 2,
  devices: 1,
  firstSeenMs: 1,
  lastSeenMs: 2,
  status: 'quiet',
  sample: null,
  detailPath: '/api/v1/diagnostics/clusters/c1',
};

/** The visible text of the first element carrying `cls`. */
function cell(root: HTMLElement, cls: string): string {
  return root.querySelector(`.${cls}`)?.textContent ?? '';
}

it('prints one cluster as four cells with the machine code on hover and the severe tag for p0', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToString(<ul><ClusterRow cluster={cluster} /></ul>);
  expect(cell(root, 'cluster-severity')).toBe(copy.severity.severe);
  expect(cell(root, 'cluster-sentence')).toBe(copy.codeWord.TONO_NODE_OR_CORE_UNREACHABLE);
  expect(root.querySelector('.cluster-detail')?.getAttribute('title')).toBe(`${clusterStage('verifyingTraffic')} · windows 0.0.75 · Los Angeles · Marina`);
  expect(cell(root, 'cluster-counts')).toBe(copy.diagnosticsPanel.clusterReach(2, 1));
  expect(cell(root, 'cluster-status')).toBe(clusterStatus('quiet'));
  expect(root.querySelector('.cluster-status')?.classList.contains('ops-tag')).toBe(true);
  expect(root.querySelector('[title="TONO_NODE_OR_CORE_UNREACHABLE"]')).not.toBeNull();
  expect(root.innerHTML).not.toContain('font-mono');
  expect(root.textContent).not.toContain('TONO_');
});

it('keeps the severity cell for every row but leaves it empty unless the cluster is p0', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToString(<ul><ClusterRow cluster={{ ...cluster, severity: 'normal' }} /></ul>);
  const severity = root.querySelector('.cluster-severity');
  expect(severity).not.toBeNull();
  expect(severity?.innerHTML).toBe('');
  expect(root.querySelector('.cluster-sentence')?.previousElementSibling).toBe(severity);
});

it('renders no severity element at all when showSeverity is false, even for a p0 row', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToString(<ul><ClusterRow cluster={{ ...cluster, severity: 'normal' }} showSeverity={false} /></ul>);
  expect(root.querySelector('.cluster-severity')).toBeNull();
  expect(root.querySelector('.cluster-sentence')?.previousElementSibling).toBeNull();
  expect(cell(root, 'cluster-sentence')).toBe(copy.codeWord.TONO_NODE_OR_CORE_UNREACHABLE);
});

it('puts the full meta text on the cell title and splits it into three flex items with no dot text', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToString(<ul><ClusterRow cluster={cluster} /></ul>);
  const meta = `${clusterStage('verifyingTraffic')} · windows 0.0.75 · Los Angeles · Marina`;
  expect(root.querySelector('.cluster-detail')?.getAttribute('title')).toBe(meta);
  const segments = [...root.querySelectorAll('.cluster-detail > .cluster-seg')].map((node) => node.textContent);
  expect(segments).toEqual([clusterStage('verifyingTraffic'), 'windows 0.0.75', 'Los AngelesMarina']);
  // The separators are CSS on items two and up, so no dot element or text is in the markup between them.
  expect(root.querySelector('.cluster-dot')).toBeNull();
  expect(root.querySelector('.cluster-detail')?.children).toHaveLength(3);
  expect(root.querySelector('.cluster-node')?.textContent).toBe('Los AngelesMarina');
});

it('splits the node into a city that can give way and a site that cannot, keeping the whole name on the title', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToString(<ul><ClusterRow cluster={cluster} /></ul>);
  const node = root.querySelector('.cluster-node');
  expect([...(node?.children ?? [])].map((child) => [child.className, child.textContent])).toEqual([
    ['cluster-node-city', 'Los Angeles'],
    ['cluster-node-site', 'Marina'],
  ]);
  // The dot between city and site is CSS on the site, never text.
  expect(node?.textContent).not.toContain('·');
  expect(root.querySelector('.cluster-detail')?.getAttribute('title')).toContain('Los Angeles · Marina');
});

it('renders only the city child for a node with no site and for a cluster that picked no node', () => {
  for (const [node, text] of [['Singapore', 'Singapore'], ['unselected', copy.diagnosticsPanel.clusterNoNode], ['', copy.diagnosticsPanel.clusterNoNode]] as const) {
    const root = document.createElement('div');
    root.innerHTML = renderToString(<ul><ClusterRow cluster={{ ...cluster, node }} /></ul>);
    const children = [...(root.querySelector('.cluster-node')?.children ?? [])];
    expect(children.map((child) => child.className)).toEqual(['cluster-node-city']);
    expect(children[0]?.textContent).toBe(text);
    expect(root.querySelector('.cluster-node-site')).toBeNull();
  }
});

it('marks a quiet row with is-quiet and leaves an open row without it', () => {
  const quiet = document.createElement('div');
  quiet.innerHTML = renderToString(<ul><ClusterRow cluster={cluster} /></ul>);
  expect(quiet.querySelector('li')?.classList.contains('is-quiet')).toBe(true);
  expect(quiet.querySelector('li')?.classList.contains('cluster-row')).toBe(true);
  const open = document.createElement('div');
  open.innerHTML = renderToString(<ul><ClusterRow cluster={{ ...cluster, status: 'open' }} /></ul>);
  expect(open.querySelector('li')?.classList.contains('is-quiet')).toBe(false);
  expect(cell(open, 'cluster-status')).toBe(clusterStatus('open'));
});
