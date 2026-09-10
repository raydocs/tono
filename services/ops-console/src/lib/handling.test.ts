import { describe, expect, it } from 'vitest';
import {
  assertCustomerSummary,
  assertIncident,
  assertList,
  type CustomerSummaryDto,
  type IncidentDto,
} from '@contract';
import { copy } from '@/copy/copy';
import rawIncidents from '../../fixtures/incidents.json';
import rawCustomers from '../../fixtures/customers.json';
import { handlingOf } from './api-followups';
import {
  choresDueToday,
  closureWord,
  nextSteps,
  recheckSpec,
  recoveredCount,
  recoveryProof,
  unconfirmedImpact,
} from './handling';

const incidents: IncidentDto[] = assertList(
  (rawIncidents as { list: unknown }).list,
  assertIncident,
).items;
const customers: CustomerSummaryDto[] = assertList(
  (rawCustomers as { list: unknown }).list,
  assertCustomerSummary,
).items;

const blocked = incidents.find((row) => row.id === 'inc-node-la')!;
const degraded = incidents.find((row) => row.id === 'inc-r1')!;

/** The two fields the Worker is growing, on a row that does not carry them yet. */
function withClosure(row: IncidentDto, closure: string): IncidentDto {
  return { ...row, closure } as IncidentDto;
}

describe('who is actually affected', () => {
  /**
   * The node incident counts five. Twenty customers are on the fleet and more
   * than five of them are parked on that machine with nothing reported since
   * the fault opened — those are the people the old page left out of the story
   * altogether.
   */
  it('separates the customers the engine measured from the ones it did not', () => {
    const split = unconfirmedImpact(blocked, incidents, customers);
    expect(split.sure).toBe(1);
    expect(split.maybe.length).toBeGreaterThan(0);
    for (const row of split.maybe) {
      expect(row.selectedServer).toBe(blocked.subjectId);
      expect(row.connected.asOfSec === null || row.connected.asOfSec < blocked.openedAt).toBe(true);
    }
  });

  it('never counts a customer as both confirmed and possible', () => {
    const split = unconfirmedImpact(blocked, incidents, customers);
    const counted = new Set(
      incidents.filter((row) => row.parentIncidentId === blocked.id).map((row) => row.subjectId),
    );
    for (const row of split.maybe) expect(counted.has(row.userId)).toBe(false);
  });

  it('says so rather than guessing when the incident is not about a machine', () => {
    const fleet = incidents.find((row) => row.subjectType === 'fleet')!;
    const split = unconfirmedImpact(fleet, incidents, customers);
    expect(split.maybe).toEqual([]);
    expect(split.why).toBe(copy.incidentMaybeNotNode);
  });
});

describe('what to do next', () => {
  it('gives the degraded machine the sequence the review wrote, and nothing else invents one', () => {
    expect(nextSteps(degraded)).toEqual(copy.incidentDegradedSteps);
    expect(nextSteps(blocked)).toEqual([]);
  });

  it('re-measures a blocked machine from the mainland and a slow one by its own errors', () => {
    expect(recheckSpec(blocked)?.jobType).toBe('node_probe');
    expect(recheckSpec(degraded)?.jobType).toBe('xray_dial_errors');
  });

  it('offers no re-measure where there is no machine to measure', () => {
    const person = incidents.find((row) => row.subjectType === 'user')!;
    expect(recheckSpec(person)).toBeNull();
  });
});

describe('closing an incident', () => {
  /**
   * The blocked machine's newest reading still says 疑似被墙, so a verified
   * recovery is refused — and refused with the reading, not with a shrug.
   */
  it('refuses a verified recovery while the measurement is still an alarm', () => {
    const proof = recoveryProof(blocked);
    expect(proof.ok).toBe(false);
    expect(proof.reason).toBe(copy.incidentClosureBlocked.alarming(copy.nodeVerdictWord.blocked));
  });

  it('refuses a verified recovery when the newest reading predates the fault', () => {
    const stale = { ...blocked, lastSeenAt: blocked.openedAt - 60 };
    expect(recoveryProof(stale).ok).toBe(false);
    expect(recoveryProof(stale).reason).toContain(copy.incidentClosureBlocked.stale('').slice(0, 6));
  });

  it('allows one once the machine has been measured well again', () => {
    const better = {
      ...blocked,
      evidence: blocked.evidence.map((row) => (
        row.label === 'blockStatus' ? { ...row, value: '"OK"' } : row
      )),
    };
    expect(recoveryProof(better).ok).toBe(true);
    expect(recoveryProof(better).reason).toBeNull();
  });

  it('refuses one on an incident that left no reading to re-check', () => {
    const bare = { ...blocked, evidence: [] };
    expect(recoveryProof(bare).reason).toBe(copy.incidentClosureBlocked.unmeasured);
  });

  /** A rule that fired wrongly is not a repair, and must never be counted as one. */
  it('keeps a false alarm out of the recovered count and out of the recovery word', () => {
    const resolved = incidents.filter((row) => row.status === 'resolved');
    expect(recoveredCount(resolved)).toBe(resolved.length);
    const mistaken = resolved.map((row, index) => (
      index === 0 ? withClosure(row, 'false_positive') : row
    ));
    expect(recoveredCount(mistaken)).toBe(resolved.length - 1);
    expect(closureWord(mistaken[0])).toBe(copy.incidentClosureWord.false_positive);
    expect(closureWord(mistaken[1])).toBe(copy.incidentClosureWord.verified);
  });

  it('never says a manually dropped incident recovered', () => {
    expect(closureWord(withClosure(blocked, 'manual')))
      .toBe(copy.incidentClosureWord.manual);
  });

  it('reads a closure the Worker has not sent yet as absent rather than as a word', () => {
    expect(handlingOf(blocked).closure).toBeNull();
    expect(handlingOf(blocked).nextCheckAt).toBeNull();
    expect(handlingOf(withClosure(blocked, 'nonsense')).closure).toBeNull();
  });
});

describe('what falls due today', () => {
  const now = 1_788_895_426;
  const endOfToday = new Date(now * 1_000);
  endOfToday.setHours(23, 0, 0, 0);
  const tonight = Math.floor(endOfToday.getTime() / 1_000);

  it('keeps the undated chores out and the late ones in', () => {
    const chores = [
      { id: 'a', kind: 'renew' as const, summary: 'a', dueAt: null },
      { id: 'b', kind: 'expiry' as const, summary: 'b', dueAt: tonight },
      { id: 'c', kind: 'expiry' as const, summary: 'c', dueAt: now + 40 * 86_400 },
    ];
    expect(choresDueToday(chores, now).map((row) => row.id)).toEqual(['b']);
  });
});
