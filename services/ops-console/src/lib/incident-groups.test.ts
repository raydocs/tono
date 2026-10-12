import { describe, expect, it } from 'vitest';
import { assertIncident, assertList, type IncidentDto } from '@contract';
import { copy } from '@/copy/copy';
import rawOpen from '../../fixtures/incidents.json';
import { groupIncidents, groupLabel, type IncidentEntry, type IncidentGroup } from './incident-groups';

const first = assertList((rawOpen as { list: unknown }).list, assertIncident).items.find(() => true);
if (first === undefined) throw new Error('the incident fixture is empty');
const base: IncidentDto = first;

function incident(patch: Partial<IncidentDto>): IncidentDto {
  return { ...base, ...patch };
}

/** Twelve of these were the same page, once. */
function node(n: number, patch: Partial<IncidentDto> = {}): IncidentDto {
  return incident({
    id: `inc-n${n}`,
    kind: 'node-blocked',
    subjectType: 'node',
    subjectId: `node-${n}`,
    severity: 'severe',
    status: 'open',
    parentIncidentId: null,
    impactCount: 0,
    openedAt: 1000 + n,
    title: 'same sentence',
    ...patch,
  });
}

/** The one group in the list, or a failure that says there was not exactly one. */
function onlyGroup(entries: readonly IncidentEntry[]): IncidentGroup {
  const groups = entries.filter((entry): entry is IncidentGroup => entry.kind === 'group');
  const found = groups.find(() => true);
  if (found === undefined || groups.length !== 1) throw new Error('expected exactly one group');
  return found;
}

describe('machines that fail the same way fold into one entry', () => {
  it('two are still two rows, three are one group', () => {
    expect(groupIncidents([node(1), node(2)]).map((entry) => entry.kind)).toEqual(['single', 'single']);
    const three = groupIncidents([node(1), node(2), node(3)]);
    expect(three).toHaveLength(1);
    const group = onlyGroup(three);
    expect(group.members.map((row) => row.id)).toEqual(['inc-n1', 'inc-n2', 'inc-n3']);
    expect(group.incidentKind).toBe('node-blocked');
  });

  it('adds the members up, takes the oldest start and the worst severity', () => {
    const group = onlyGroup(groupIncidents([
      node(1, { impactCount: 2, severity: 'warn', openedAt: 900 }),
      node(2, { impactCount: 3, severity: 'severe', openedAt: 1100 }),
      node(3, { impactCount: 4, severity: 'notice', openedAt: 1200 }),
    ]));
    expect(group).toMatchObject({ kind: 'group', impactCount: 9, openedAt: 900, severity: 'severe' });
  });

  it('counts each kind apart, folds both spellings together, and keeps the sort order', () => {
    const entries = groupIncidents([
      node(1, { kind: 'node_blocked', severity: 'warn' }),
      node(2, { kind: 'node-blocked', severity: 'warn' }),
      node(3, { kind: 'node_blocked', severity: 'warn' }),
      node(4, { kind: 'node-down', severity: 'severe' }),
      node(5, { kind: 'node-down', severity: 'severe' }),
      node(6, { kind: 'node-pressure', severity: 'notice' }),
    ]);
    expect(entries.map((entry) => (entry.kind === 'group' ? entry.members.length : 1))).toEqual([1, 1, 3, 1]);
    expect(entries.map((entry) => (entry.kind === 'group' ? entry.key : entry.row.id)))
      .toEqual(['inc-n4', 'inc-n5', 'group:node-blocked', 'inc-n6']);
  });

  it('never folds a resolved row, a child, or a row that is not about a machine', () => {
    const entries = groupIncidents([
      node(1),
      node(2),
      node(3, { status: 'resolved', resolvedAt: 2000 }),
      node(4, { parentIncidentId: 'inc-n1' }),
      node(5, { subjectType: 'user', subjectId: 'u-01' }),
    ]);
    expect(entries.every((entry) => entry.kind === 'single')).toBe(true);
    expect(entries).toHaveLength(5);
  });

  it('an acked machine is still open and still in the group', () => {
    const group = onlyGroup(groupIncidents([node(1), node(2, { status: 'acked', ackedAt: 1500 }), node(3)]));
    expect(group.members).toHaveLength(3);
  });

  it('is called by its members\' shared title, or by the kind when the titles differ', () => {
    const same = onlyGroup(groupIncidents([node(1), node(2), node(3)]));
    const mixed = onlyGroup(groupIncidents([node(1), node(2, { title: 'other' }), node(3)]));
    expect(groupLabel(same)).toBe('same sentence');
    expect(groupLabel(mixed)).toBe(copy.todayGroupKinds['node-blocked']);
  });
});
