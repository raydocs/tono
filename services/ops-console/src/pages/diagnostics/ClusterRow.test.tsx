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
  status: 'open',
  sample: null,
  detailPath: '/api/v1/diagnostics/clusters/c1',
};

it('prints one cluster in Chinese with the machine code on hover and the severe tag for p0', () => {
  const html = renderToString(<ul><ClusterRow cluster={cluster} /></ul>);
  const text = html.replace(/<[^>]*>/g, '').replace(/<!-- -->/g, '');
  const line = [
    copy.codeWord.TONO_NODE_OR_CORE_UNREACHABLE,
    clusterStage('verifyingTraffic'),
    'windows 0.0.75',
    'Los Angeles · Marina',
    copy.diagnosticsPanel.clusterReach(2, 1),
    clusterStatus('open'),
  ].join(' · ');
  expect(text).toBe(`${copy.severity.severe} ${line}`);
  expect(html).toContain('title="TONO_NODE_OR_CORE_UNREACHABLE"');
  expect(text).not.toContain('TONO_');
  expect(html).not.toContain('font-mono');
});
