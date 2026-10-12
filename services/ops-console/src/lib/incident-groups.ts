import type { IncidentDto, Severity } from '@contract';
import { copy } from '@/copy/copy';
import { kindOf, SEVERITY_RANK, sortIncidents } from './incidents';

/* ------------------------------------------------------------------ 归并 */

/** Three machines with the same fault are one piece of news, two are two. */
export const GROUP_MIN_MEMBERS = 3;

export type IncidentGroup = {
  kind: 'group';
  key: string;
  /** The normalised kind the members share, `node-blocked` for both spellings. */
  incidentKind: string;
  /** In the list's own order: most severe, widest, oldest first. */
  members: IncidentDto[];
  /** The members' impact added up, the way the hero adds the rows. */
  impactCount: number;
  /** The oldest member's start: how long the whole thing has been going on. */
  openedAt: number;
  /** The worst member's severity. */
  severity: Severity;
};

export type IncidentEntry = IncidentGroup | { kind: 'single'; row: IncidentDto };

function groupable(row: IncidentDto): boolean {
  return row.status !== 'resolved' && row.parentIncidentId === null && row.subjectType === 'node';
}

/**
 * The engine opens one incident per machine, so a wall that takes twelve of
 * them is twelve identical rows. Machines that share a kind and have no parent
 * fold into one entry once there are three; a customer, a child, a resolved
 * row or a lone machine stays the row it was.
 *
 * The group sits where its first member would have: members are taken from the
 * list in sorted order, so the position is that of the most severe, widest,
 * oldest one.
 */
export function groupIncidents(rows: readonly IncidentDto[]): IncidentEntry[] {
  const sorted = sortIncidents(rows);
  const byKind = new Map<string, IncidentDto[]>();
  for (const row of sorted) {
    if (!groupable(row)) continue;
    const kind = kindOf(row);
    byKind.set(kind, [...(byKind.get(kind) ?? []), row]);
  }
  const entries: IncidentEntry[] = [];
  const placed = new Set<string>();
  for (const row of sorted) {
    const members = groupable(row) ? byKind.get(kindOf(row)) : undefined;
    if (!members || members.length < GROUP_MIN_MEMBERS) {
      entries.push({ kind: 'single', row });
      continue;
    }
    const kind = kindOf(row);
    if (placed.has(kind)) continue;
    placed.add(kind);
    entries.push({
      kind: 'group',
      key: `group:${kind}`,
      incidentKind: kind,
      members,
      impactCount: members.reduce((sum, member) => sum + member.impactCount, 0),
      openedAt: Math.min(...members.map((member) => member.openedAt)),
      severity: members.reduce<Severity>(
        (worst, member) => (SEVERITY_RANK[member.severity] < SEVERITY_RANK[worst] ? member.severity : worst),
        'notice',
      ),
    });
  }
  return entries;
}

/**
 * What the machines have in common, in the words the operator uses: the title
 * they all carry when they carry the same one, otherwise the name of the kind.
 * Titles that mention how many people are on each machine differ, and a kind
 * nobody has named falls back to the first title rather than to a slug.
 */
export function groupLabel(group: IncidentGroup): string {
  const first = group.members.find(() => true)?.title ?? group.incidentKind;
  if (group.members.every((member) => member.title === first)) return first;
  return copy.todayGroupKinds[group.incidentKind] ?? first;
}

/** The members still waiting for someone to claim them. */
export function unclaimed(group: IncidentGroup): IncidentDto[] {
  return group.members.filter((member) => member.status === 'open');
}
