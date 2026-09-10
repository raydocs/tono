import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertActivityHour,
  assertAdoptionMatrix,
  assertConnectionEvent,
  assertCustomerDetail,
  assertCustomerSummary,
  assertDestinationRow,
  assertIncident,
  assertIncidentDetail,
  assertList,
  assertRelease,
  assertServiceUsage,
} from '@contract';
import { bucketFor, publishedVersions } from '@/lib/releases';
import { materializeOps } from '@/lib/ops-fixtures';

/**
 * The fixtures are the only thing standing between these pages and a Worker
 * nobody has pointed them at yet, so they are held to the contract the Worker
 * is held to: the same `assert*` checkers, run over every committed file.
 *
 * They run twice — once on the file as written, once after the clock shift the
 * dev server applies — because the shift is arithmetic on timestamps, and
 * arithmetic that turns an `asOfSec` into a float or a zero would ship a page
 * full of 1970 without either half failing on its own.
 */
const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

type CustomerFile = {
  clock: number;
  list: unknown;
  details: Record<string, {
    detail: unknown;
    connections: unknown;
    activity: unknown;
    destinations: unknown;
    services: unknown;
  }>;
};

type IncidentFile = {
  clock: number;
  list: unknown;
  details: Record<string, unknown>;
};

type ReleaseFile = {
  clock: number;
  list: unknown;
  adoption: unknown;
};

function read<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

const CUSTOMER_FILES = ['customers.json', 'customers.dense.json', 'customers.empty.json'];
const INCIDENT_FILES = ['incidents.json', 'incidents.dense.json', 'incidents.empty.json'];
const RELEASE_FILES = ['releases.json', 'releases.dense.json', 'releases.empty.json'];

/** One assertion per checker run, so a failure names the file and the section. */
function checkCustomers(file: CustomerFile): number {
  let checks = 0;
  const list = assertList(file.list, assertCustomerSummary, 'customers');
  checks += 1;
  const ids = list.items.map((row) => row.userId);
  expect(Object.keys(file.details).sort()).toEqual([...ids].sort());
  for (const id of ids) {
    const entry = file.details[id];
    assertCustomerDetail(entry.detail, `${id}.detail`);
    assertList(entry.connections, assertConnectionEvent, `${id}.connections`);
    assertList(entry.activity, assertActivityHour, `${id}.activity`);
    assertList(entry.destinations, assertDestinationRow, `${id}.destinations`);
    assertList(entry.services, assertServiceUsage, `${id}.services`);
    checks += 5;
  }
  return checks;
}

function checkReleases(file: ReleaseFile): number {
  assertList(file.list, assertRelease, 'releases');
  assertAdoptionMatrix(file.adoption, 'adoption');
  return 2;
}

function checkIncidents(file: IncidentFile): number {
  let checks = 0;
  const list = assertList(file.list, assertIncident, 'incidents');
  checks += 1;
  const ids = list.items.map((row) => row.id);
  expect(Object.keys(file.details).sort()).toEqual([...ids].sort());
  for (const id of ids) {
    assertIncidentDetail(file.details[id], id);
    checks += 1;
  }
  return checks;
}

describe('every committed ops fixture satisfies the contract', () => {
  let total = 0;

  for (const name of CUSTOMER_FILES) {
    it(name, () => {
      const file = read<CustomerFile>(name);
      total += checkCustomers(file);
      total += checkCustomers(materializeOps(file, file.clock));
    });
  }

  for (const name of INCIDENT_FILES) {
    it(name, () => {
      const file = read<IncidentFile>(name);
      total += checkIncidents(file);
      total += checkIncidents(materializeOps(file, file.clock));
    });
  }

  for (const name of RELEASE_FILES) {
    it(name, () => {
      const file = read<ReleaseFile>(name);
      total += checkReleases(file);
      total += checkReleases(materializeOps(file, file.clock));
    });
  }

  it('checked more than the six files it opened', () => {
    expect(total).toBeGreaterThan(6);
  });
});

describe('the normal set is the one the pages were written against', () => {
  const file = read<CustomerFile>('customers.json');
  const list = assertList(file.list, assertCustomerSummary);

  it('has twenty customers, four of them measured online', () => {
    expect(list.items.length).toBe(20);
    const online = list.items.filter((row) => row.connected.value && row.connected.asOfSec !== null);
    expect(online.length).toBe(4);
  });

  it('spreads the health words across all five verdicts', () => {
    const seen = new Set(list.items.map((row) => row.verdict));
    expect([...seen].sort()).toEqual(['offline', 'ok', 'unreachable', 'unreported', 'unstable']);
  });

  it('never reports a platform the client has not shipped for', () => {
    for (const row of list.items) {
      for (const platform of row.platforms) {
        expect(['macos', 'windows']).toContain(platform);
      }
    }
  });

  it('leaves the unreported customers with no freshness stamp at all', () => {
    for (const row of list.items) {
      if (row.verdict !== 'unreported') continue;
      expect(row.connected.asOfSec, row.userId).toBeNull();
    }
  });
});

/**
 * R4 across two machines.
 *
 * The adoption matrix is counted by the Worker over devices; the 客户 page
 * buckets the rows it already holds in the browser. A cell that claims five
 * customers and a filter that produces four is the "高丢包 2 / 高丢包 8" bug
 * again, one page apart — so the normal fixtures are held to agreeing.
 */
describe('a matrix cell and the customer list it links to hold the same people', () => {
  const releases = read<ReleaseFile>('releases.json');
  const customers = read<CustomerFile>('customers.json');
  const rows = assertList(releases.list, assertRelease).items;
  const people = assertList(customers.list, assertCustomerSummary).items;
  const matrix = assertAdoptionMatrix(releases.adoption);

  it('counts the same users per platform and bucket', () => {
    for (const platform of matrix.released) {
      const published = publishedVersions(rows, platform);
      const onPlatform = people.filter((row) => row.platforms.includes(platform));
      for (const cell of matrix.cells.filter((row) => row.platform === platform)) {
        const counted = onPlatform.filter(
          (row) => bucketFor(row.minAppVersion, published) === cell.bucket,
        ).length;
        expect(counted, `${platform} ${cell.bucket}`).toBe(cell.users);
      }
    }
  });

  it('never claims a number for a platform nothing has shipped for', () => {
    const shipped = new Set(rows.map((row) => row.platform));
    for (const platform of matrix.released) expect(shipped.has(platform)).toBe(true);
  });

  it('leaves somebody below the floor, so the version chore has something to find', () => {
    const floor = rows.find((row) => row.minSupportedVersion !== null);
    expect(floor?.minSupportedVersion).toBeTruthy();
    const behind = people.filter(
      (row) => row.platforms.includes(floor!.platform)
        && row.minAppVersion !== null
        && row.minAppVersion < floor!.minSupportedVersion!,
    );
    expect(behind.length).toBeGreaterThan(0);
  });
});

describe('the incident fixtures carry the story the page tells', () => {
  const open = read<IncidentFile>('incidents.json');
  const list = assertList(open.list, assertIncident);

  it('has two open incidents, one of them rolled up under the other', () => {
    const live = list.items.filter((row) => row.status !== 'resolved');
    expect(live.length).toBe(2);
    expect(live.filter((row) => row.parentIncidentId !== null).length).toBe(1);
  });

  it('has five resolved ones to fill the 7-day tab', () => {
    expect(list.items.filter((row) => row.status === 'resolved').length).toBe(5);
  });

  it('the empty set still knows when the last incident recovered', () => {
    const quiet = read<IncidentFile>('incidents.empty.json');
    const rows = assertList(quiet.list, assertIncident);
    expect(rows.items.filter((row) => row.status !== 'resolved').length).toBe(0);
    expect(rows.items.filter((row) => row.resolvedAt !== null).length).toBeGreaterThan(0);
  });
});
