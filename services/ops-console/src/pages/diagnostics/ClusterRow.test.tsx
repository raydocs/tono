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
  expect(cell(root, 'cluster-detail')).toBe(`${clusterStage('verifyingTraffic')} · windows 0.0.75 · Los Angeles · Marina`);
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

it('puts the full meta text on the cell title and splits it into three segments with hidden dots', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToString(<ul><ClusterRow cluster={cluster} /></ul>);
  const meta = `${clusterStage('verifyingTraffic')} · windows 0.0.75 · Los Angeles · Marina`;
  expect(root.querySelector('.cluster-detail')?.getAttribute('title')).toBe(meta);
  expect(cell(root, 'cluster-detail')).toBe(meta);
  const segments = [...root.querySelectorAll('.cluster-seg')].map((node) => node.textContent);
  expect(segments).toEqual([clusterStage('verifyingTraffic'), 'windows 0.0.75', 'Los Angeles · Marina']);
  const dots = [...root.querySelectorAll('.cluster-dot')];
  expect(dots).toHaveLength(2);
  for (const dot of dots) expect(dot.getAttribute('aria-hidden')).toBe('true');
});
