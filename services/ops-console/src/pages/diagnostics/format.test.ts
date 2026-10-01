import { describe, expect, it } from 'vitest';
import { clusterLine } from './format';
import type { FailureCluster } from './types';

const cluster: FailureCluster = {
  id: 'c1',
  code: 'TONO_CONNECT_TLS',
  stage: 'tls',
  appVersion: '0.0.74',
  platform: 'windows',
  node: 'Tokyo',
  count: 4,
  users: 2,
  devices: 2,
  firstSeenMs: 1,
  lastSeenMs: 2,
  status: 'open',
  sample: null,
  detailPath: '/api/v1/diagnostics/clusters/c1',
};

describe('clusterLine', () => {
  it('names the outage without a person or an address', () => {
    expect(clusterLine(cluster)).toBe('TONO_CONNECT_TLS · tls · windows 0.0.74 · Tokyo · 4');
  });
});
