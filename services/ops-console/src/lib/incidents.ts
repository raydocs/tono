import type { CustomerSummaryDto, IncidentDto, Severity } from '@contract';

const SEVERITY_RANK: Record<Severity, number> = { severe: 0, warn: 1, notice: 2 };

/**
 * 进行中: anything the operator has not finished with. An acked incident is
 * still open — someone claimed it, the node is still blocked — and a snoozed
 * one is open too, just quiet. Only 已恢复 leaves this list, and it leaves it
 * because the engine measured the subject healthy again, not because a human
 * clicked something.
 */
export function openIncidents(rows: readonly IncidentDto[]): IncidentDto[] {
  return sortIncidents(rows.filter((row) => row.status !== 'resolved'));
}

export function resolvedIncidents(rows: readonly IncidentDto[]): IncidentDto[] {
  return rows
    .filter((row) => row.status === 'resolved')
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
}

/** Severity, then blast radius, then how long it has been going on. */
export function sortIncidents(rows: readonly IncidentDto[]): IncidentDto[] {
  return [...rows].sort((a, b) => (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || b.impactCount - a.impactCount
    || a.openedAt - b.openedAt
  ));
}

/**
 * How many customers are actually affected right now.
 *
 * Children are skipped: thirty customers behind one blocked node open thirty
 * incidents that all roll up to the node's, and adding their impact to its
 * own would report sixty-odd people hurt by a fault that hit thirty.
 */
export function impactedCustomers(rows: readonly IncidentDto[]): number {
  return openIncidents(rows)
    .filter((row) => row.parentIncidentId === null)
    .reduce((sum, row) => sum + row.impactCount, 0);
}

export function lastResolvedAt(rows: readonly IncidentDto[]): number | null {
  const [newest] = resolvedIncidents(rows);
  return newest?.resolvedAt ?? null;
}

/** The children of an open node incident — the 受影响客户 list in the drawer. */
export function childrenOf(rows: readonly IncidentDto[], id: string): IncidentDto[] {
  return sortIncidents(rows.filter((row) => row.parentIncidentId === id));
}

/**
 * What the row is about, in the words the operator uses for it.
 *
 * A node incident is about a node and its name is already the name; a customer
 * incident carries the internal user id, which nobody recognises. Resolving it
 * to the address — through the same masker the privacy toggle uses — is the
 * difference between "u-04 连不上" and a sentence someone can act on.
 */
export function incidentSubject(
  incident: IncidentDto,
  customers: readonly CustomerSummaryDto[],
  mask: (email: string) => string,
): string | null {
  if (incident.subjectType !== 'user' || !incident.subjectId) return incident.subjectId;
  const person = customers.find((row) => row.userId === incident.subjectId);
  return person ? mask(person.email) : incident.subjectId;
}
