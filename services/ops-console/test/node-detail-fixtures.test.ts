import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertConnectionEvent,
  assertJob,
  assertList,
  assertNodeAcceptance,
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

/* ------------------------------------------------------- 可售验收单 */

type AcceptanceFile = {
  clock: number;
  sheets: Record<string, unknown>;
  nodes: Record<string, { sheet: string; lifecycle?: string; catalogListed?: boolean }>;
  bySet: Record<string, string>;
};

const acceptanceFile = JSON.parse(
  readFileSync(join(FIXTURES, 'node-acceptance.json'), 'utf8'),
) as AcceptanceFile;

/**
 * The sheet is a table with one rule the console leans on — `sellable` is true
 * exactly when nothing blocks it, and only 客户去程 and 容量 may be unknown and
 * still count. `assertNodeAcceptance` enforces the pair, which is why these
 * fixtures are generated rather than typed: a hand-edited one that broke it
 * would put 可以上架 above a list of blockers.
 */
describe('每张可售验收单都过合同', () => {
  for (const name of Object.keys(acceptanceFile.sheets)) {
    it(name, () => {
      const sheet = assertNodeAcceptance(acceptanceFile.sheets[name]);
      expect(sheet.items.length).toBe(12);
      assertNodeAcceptance(materializeOps(acceptanceFile.sheets[name], acceptanceFile.clock));
    });
  }

  it('covers the three shapes the section has to survive', () => {
    const sellable = assertNodeAcceptance(acceptanceFile.sheets.sellable);
    expect(sellable.sellable).toBe(true);
    expect(sellable.blockers).toEqual([]);
    // 容量 has no ceiling written down anywhere, so it stays unknown and
    // still lets the machine be sold — the one case the rule exists for.
    expect(sellable.items.find((row) => row.key === 'capacity')?.state).toBe('unknown');

    const blocked = assertNodeAcceptance(acceptanceFile.sheets.blocked);
    expect(blocked.sellable).toBe(false);
    expect(blocked.blockers).toContain('carriers');
    expect(blocked.blockers.length).toBeGreaterThan(3);

    const unknown = assertNodeAcceptance(acceptanceFile.sheets.unknown);
    expect(unknown.items.filter((row) => row.state === 'unknown').length).toBeGreaterThan(2);
    // All four states appear across the set, so no tone ships unlooked at.
    const states = new Set(Object.values(acceptanceFile.sheets)
      .flatMap((sheet) => assertNodeAcceptance(sheet).items.map((row) => row.state)));
    expect([...states].sort()).toEqual(['fail', 'pass', 'pending', 'unknown']);
  });

  it('names an unlisted machine for each of the two 上架 paths', () => {
    const named = Object.values(acceptanceFile.nodes);
    expect(named.length).toBeGreaterThan(1);
    for (const row of named) {
      expect(row.lifecycle).toBe('unlisted');
      expect(row.catalogListed).toBe(false);
      expect(Object.keys(acceptanceFile.sheets)).toContain(row.sheet);
    }
    expect(named.map((row) => row.sheet).sort()).toEqual(['blocked', 'sellable']);
  });
});

/**
 * The committed file is the generator's output and nothing else.
 *
 * It regenerates into a scratch directory rather than in place: running the
 * generator over `fixtures/` would rewrite every other set as a side effect of
 * checking this one.
 */
describe('the generator emits exactly the committed 可售验收 fixture', () => {
  it('byte for byte', () => {
    const out = mkdtempSync(join(tmpdir(), 'ops-fixtures-'));
    try {
      execFileSync(
        process.execPath,
        [join(import.meta.dirname, '..', 'scripts', 'generate-ops-fixtures.mjs'), '--out', out],
        { stdio: 'ignore' },
      );
      expect(readFileSync(join(out, 'node-acceptance.json'), 'utf8'))
        .toBe(readFileSync(join(FIXTURES, 'node-acceptance.json'), 'utf8'));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
