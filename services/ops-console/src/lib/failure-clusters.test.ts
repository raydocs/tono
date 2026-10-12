import { expect, it } from 'vitest';
import type { FailureCluster } from '@/pages/diagnostics/types';
import { sortClusters } from './failure-clusters';

function cluster(id: string, patch: Partial<FailureCluster> = {}): FailureCluster {
  return {
    id,
    code: 'TONO_A',
    stage: 'connect',
    appVersion: '1.0.0',
    platform: 'windows',
    node: 'Tokyo · Fuji',
    severity: 'normal',
    count: 1,
    users: 1,
    devices: 1,
    firstSeenMs: 1,
    lastSeenMs: 2,
    status: 'open',
    sample: null,
    detailPath: `/api/v1/diagnostics/clusters/${id}`,
    ...patch,
  };
}

const ids = (rows: FailureCluster[]) => rows.map((row) => row.id);

it('puts a p0 first even when it reached the fewest people', () => {
  const rows = sortClusters([cluster('wide', { users: 50 }), cluster('p0', { severity: 'p0', users: 1 })]);
  expect(ids(rows)).toEqual(['p0', 'wide']);
});

it('puts open before quiet, and a quiet p0 still before an open normal', () => {
  const rows = sortClusters([
    cluster('quiet-wide', { status: 'quiet', users: 90 }),
    cluster('open-small', { users: 2 }),
    cluster('quiet-p0', { status: 'quiet', severity: 'p0', users: 1 }),
  ]);
  expect(ids(rows)).toEqual(['quiet-p0', 'open-small', 'quiet-wide']);
});

it('orders by people, then devices, then code, descending reach first', () => {
  const rows = sortClusters([
    cluster('few-people', { users: 2, devices: 40 }),
    cluster('more-devices', { users: 5, devices: 9 }),
    cluster('more-people', { users: 6, devices: 1 }),
    cluster('b-code', { users: 5, devices: 8, code: 'TONO_B' }),
    cluster('a-code', { users: 5, devices: 8, code: 'TONO_A' }),
  ]);
  expect(ids(rows)).toEqual(['more-people', 'more-devices', 'a-code', 'b-code', 'few-people']);
});

it('is stable for identical clusters and leaves the input untouched', () => {
  const input = [cluster('x'), cluster('y'), cluster('z')];
  const before = ids(input);
  expect(ids(sortClusters(input))).toEqual(['x', 'y', 'z']);
  expect(ids(input)).toEqual(before);
});
