import { describe, expect, it } from 'vitest';
import { assertIncident, assertList, type IncidentDto } from '@contract';
import { copy } from '@/copy/copy';
import rawOpen from '../../fixtures/incidents.json';
import rawQuiet from '../../fixtures/incidents.empty.json';
import { childrenOf, impactedCustomers, lastResolvedAt, openIncidents, resolvedIncidents } from './incidents';

function load(file: unknown): IncidentDto[] {
  return assertList((file as { list: unknown }).list, assertIncident).items;
}

const rows = load(rawOpen);
const quiet = load(rawQuiet);

describe('incident selectors', () => {
  it('the verdict sentence and the 进行中 tab count the same list', () => {
    const open = openIncidents(rows);
    expect(copy.todayVerdict(open.length, impactedCustomers(rows)))
      .toBe('现在 2 个事故，影响 5 位客户');
  });

  /**
   * The child incident's single customer is already inside the node
   * incident's five. Counting both would report six people hurt by a fault
   * that hit five — which is the arithmetic that made the old 故障 page
   * unbelievable.
   */
  it('does not count a rolled-up incident twice', () => {
    const open = openIncidents(rows);
    const naive = open.reduce((sum, row) => sum + row.impactCount, 0);
    expect(naive).toBeGreaterThan(impactedCustomers(rows));
    expect(impactedCustomers(rows)).toBe(5);
  });

  it('an acked incident is still open; only a resolved one leaves', () => {
    const acked = rows.map((row) => (row.id === openIncidents(rows)[0].id
      ? { ...row, status: 'acked' as const, ackedAt: row.openedAt }
      : row));
    expect(openIncidents(acked).length).toBe(openIncidents(rows).length);
  });

  it('sorts by severity, then blast radius, then age', () => {
    const open = openIncidents(rows);
    expect(open[0].severity).toBe('severe');
    expect(open[0].impactCount).toBeGreaterThanOrEqual(open[1].impactCount);
  });

  it('splits the two tabs without losing or duplicating a row', () => {
    expect(openIncidents(rows).length + resolvedIncidents(rows).length).toBe(rows.length);
  });

  it('names the parent an affected customer hangs off', () => {
    const parent = openIncidents(rows).find((row) => row.parentIncidentId === null);
    expect(parent).toBeDefined();
    expect(childrenOf(rows, parent!.id).length).toBe(1);
  });

  it('a quiet fleet still says when the last one recovered', () => {
    expect(openIncidents(quiet).length).toBe(0);
    const at = lastResolvedAt(quiet);
    expect(at).not.toBeNull();
    expect(resolvedIncidents(quiet)[0].resolvedAt).toBe(at);
  });
});
