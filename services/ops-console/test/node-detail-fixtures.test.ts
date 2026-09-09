import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertConnectionEvent,
  assertJob,
  assertList,
  assertNodeDetail,
  assertNodeErrorsMeasured,
  assertNodeHistoryEntry,
} from '@contract';
import { materializeOps } from '@/lib/ops-fixtures';

/**
 * The 节点详情 fixtures are hand-written, which is the only reason the page can
 * be looked at — the captured node has nothing behind it. Hand-written is not
 * a licence to invent a shape, so they are held to the same checkers the
 * Worker's responses are, before and after the clock shift the dev server
 * applies.
 */
const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

type NodeFile = {
  clock: number;
  detail: unknown;
  connections: unknown;
  errors: Record<string, unknown>;
  history: unknown;
  jobs: unknown;
  retirePreview: { canRetire: boolean; affectedUsers: unknown[]; warnings: string[] };
};

function read(name: string): NodeFile {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as NodeFile;
}

function check(file: NodeFile): number {
  assertNodeDetail(file.detail, 'detail');
  assertList(file.connections, assertConnectionEvent, 'connections');
  assertList(file.history, assertNodeHistoryEntry, 'history');
  assertList(file.jobs, assertJob, 'jobs');
  let checks = 4;
  for (const [range, body] of Object.entries(file.errors)) {
    assertNodeErrorsMeasured(body);
    expect(['7d', '30d']).toContain(range);
    checks += 1;
  }
  return checks;
}

const FILES = ['node-detail.json', 'node-detail.dense.json'];

describe('every committed 节点 fixture satisfies the contract', () => {
  for (const name of FILES) {
    it(name, () => {
      const file = read(name);
      expect(check(file)).toBeGreaterThan(4);
      expect(check(materializeOps(file, file.clock))).toBeGreaterThan(4);
    });
  }
});

describe('the normal set is the page the sections were written against', () => {
  const file = read('node-detail.json');
  const detail = assertNodeDetail(file.detail);

  it('is a machine with one thing wrong, not five', () => {
    expect(detail.health).toBe('劣化');
    expect(detail.reason).not.toBeNull();
    expect(detail.lifecycle).toBe('listed');
  });

  it('leaves exactly one of the five registrations undone, so 待办 has something to show', () => {
    const bindings = detail.bindings;
    const missing = [bindings.catalog, bindings.exitToken, bindings.komari, bindings.identitySync, bindings.metering]
      .filter((done) => !done);
    expect(missing.length).toBe(1);
    expect(bindings.identitySync).toBe(false);
  });

  it('disagrees between the two directions, which is the case the pair exists for', () => {
    const unicomOut = detail.forwardPath.value.find((row) => row.carrier === 'unicom');
    const telecomOut = detail.forwardPath.value.find((row) => row.carrier === 'telecom');
    expect(unicomOut?.successRate).toBeLessThan(0.8);
    expect(telecomOut?.successRate).toBeGreaterThan(0.9);
  });

  it('quotes one exhaustion date rather than leaving the page to guess', () => {
    expect(detail.quota.value.projectedExhaustAt).not.toBeNull();
    expect(detail.quota.value.cycleStart).not.toBeNull();
    expect(detail.quota.value.cycleEnd).not.toBeNull();
  });

  it('has people on it, and says who would be interrupted by a 退役', () => {
    expect(detail.occupancy.value.length).toBeGreaterThan(0);
    expect(file.retirePreview.affectedUsers.length).toBe(detail.occupancy.value.length);
    expect(file.retirePreview.canRetire).toBe(true);
  });
});

describe('the dense set is the one that has to survive its own length', () => {
  const file = read('node-detail.dense.json');
  const detail = assertNodeDetail(file.detail);

  it('carries a name long enough to break a header that does not truncate', () => {
    expect(detail.name.length).toBeGreaterThan(40);
  });

  it('fills every table the page has', () => {
    expect(detail.occupancy.value.length).toBeGreaterThan(10);
    expect(assertList(file.connections, assertConnectionEvent).items.length).toBeGreaterThan(50);
    expect(assertList(file.jobs, assertJob).items.length).toBeGreaterThan(5);
    expect(assertList(file.history, assertNodeHistoryEntry).items.length).toBeGreaterThan(5);
  });

  it('is over its quota, so the gauge has its severe case on screen', () => {
    expect(detail.quota.value.level).toBe('severe');
  });
});
