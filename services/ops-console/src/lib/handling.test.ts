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
  capNight,
  choresDueToday,
  closureWord,
  formatLife,
  groupNight,
  NIGHT_CAP,
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

/**
 * 早报 on a bad night. The morning that made this necessary the engine
 * returned thirty-nine opened rows and thirty-three recovered ones, and the
 * block printed every one of them: what follows is the arithmetic that turns
 * that into a page somebody reads.
 */
describe('the night, grouped', () => {
  const NIGHT = 1_788_895_426;

  /** One opening of one fault, in the night the digest is reading. */
  function opening(over: Partial<IncidentDto> & { id: string }): IncidentDto {
    return {
      ...degraded,
      kind: 'node_degraded',
      subjectType: 'node',
      subjectId: 'Tokyo · Fuji',
      severity: 'warn',
      status: 'resolved',
      title: 'Tokyo · Fuji 回程丢包，2 人在用',
      openedAt: NIGHT - 3_600,
      resolvedAt: NIGHT - 3_540,
      ...over,
    } as IncidentDto;
  }

  /** Ten openings of the same fault on the same machine, shortest 59 seconds. */
  const flapping = [59, 71, 96, 62, 143, 88, 67, 205, 74, 61].map((life, index) => opening({
    id: `flap-${String(index)}`,
    openedAt: NIGHT - 30_000 + index * 2_000,
    resolvedAt: NIGHT - 30_000 + index * 2_000 + life,
  }));

  it('says one thing once, however many times the engine said it', () => {
    const groups = groupNight(flapping, NIGHT);
    expect(groups.length).toBe(1);
    expect(groups[0].count).toBe(10);
    expect(groups[0].lead.id).toBe('flap-9');
  });

  it('keeps a different fault, and the same fault elsewhere, out of the group', () => {
    const groups = groupNight([
      ...flapping,
      opening({ id: 'other-node', subjectId: 'Hong Kong · Victoria' }),
      opening({ id: 'other-kind', kind: 'node_blocked' }),
    ], NIGHT);
    expect(groups.length).toBe(3);
    expect(groups.map((row) => row.count).sort((a, b) => b - a)).toEqual([10, 1, 1]);
  });

  it('reads the older underscore spelling of a kind as the same group', () => {
    const groups = groupNight([
      opening({ id: 'dashed', kind: 'node-degraded' }),
      opening({ id: 'scored', kind: 'node_degraded' }),
    ], NIGHT);
    expect(groups.length).toBe(1);
    expect(groups[0].count).toBe(2);
  });

  /** A group that ended two ways says so, or the line claims repairs it did not make. */
  it('counts the closure words one by one when they are not all the same', () => {
    const mixed = flapping.map((row, index) => (
      index === 0 ? withClosure(row, 'false_positive') : row
    ));
    const [group] = groupNight(mixed, NIGHT);
    expect(group.closures).toEqual([
      { closure: 'verified', count: 9 },
      { closure: 'false_positive', count: 1 },
    ]);
  });

  it('leaves the closure words off a group that has not ended', () => {
    const running = flapping.map((row) => ({ ...row, status: 'open' as const, resolvedAt: null }));
    const [group] = groupNight(running, NIGHT);
    expect(group.closures).toEqual([]);
    expect(group.severity).toBe('warn');
  });

  it('carries the worst severity in the group, not the newest one', () => {
    const [group] = groupNight([
      opening({ id: 'a', severity: 'notice' }),
      opening({ id: 'b', severity: 'severe' }),
      opening({ id: 'c', severity: 'notice' }),
    ], NIGHT);
    expect(group.severity).toBe('severe');
  });

  it('opens once and says nothing about flapping', () => {
    expect(groupNight(flapping.slice(0, 2), NIGHT)[0].flap).toBeNull();
  });

  /**
   * Three openings is where it stops being a coincidence, and the shortest
   * life is the number that makes the case: a minute is not an outage.
   */
  it('calls three openings flapping, and reports the shortest life', () => {
    const [group] = groupNight(flapping, NIGHT);
    expect(group.flap).toEqual({ times: 10, shortest: 59 });
    expect(formatLife(group.flap!.shortest)).toBe('59 秒');
    expect(copy.digestFlap(10, formatLife(59)))
      .toBe('反复开关 10 次，最短 59 秒，判定可能在抖动');
  });

  it('counts an opening that is still running as having lasted until now', () => {
    const [group] = groupNight(
      flapping.slice(0, 3).map((row) => ({ ...row, status: 'open' as const, resolvedAt: null })),
      NIGHT,
    );
    expect(group.flap?.shortest).toBe(NIGHT - flapping[2].openedAt);
  });

  it('says a life in the unit that is still honest about it', () => {
    expect(formatLife(0)).toBe('0 秒');
    expect(formatLife(59)).toBe('59 秒');
    expect(formatLife(60)).toBe('1 分钟');
    expect(formatLife(3_600)).toBe('1 小时');
    expect(formatLife(86_400)).toBe('1 天');
  });

  it('reads worst first, then the ones that happened most', () => {
    const groups = groupNight([
      ...flapping,
      opening({ id: 'bad', subjectId: 'Hong Kong · Victoria', severity: 'severe' }),
      opening({ id: 'quiet', subjectId: '香港 · 中环', severity: 'notice' }),
    ], NIGHT);
    expect(groups.map((row) => row.lead.id)).toEqual(['bad', 'flap-9', 'quiet']);
  });

  /**
   * Six lines a half. The rest are not hidden — they are counted, and the tab
   * behind the count is the same list they came from.
   */
  it('prints six groups and counts the rest', () => {
    const many = Array.from({ length: 21 }, (_, index) => opening({
      id: `g-${String(index)}`,
      subjectId: `node-${String(index)}`,
    }));
    const half = capNight(groupNight(many, NIGHT));
    expect(half.shown.length).toBe(NIGHT_CAP);
    expect(half.hidden).toBe(21 - NIGHT_CAP);
    expect(copy.digestMoreGroups(half.hidden)).toBe('还有 15 组');
  });

  it('caps nothing it does not have to', () => {
    const half = capNight(groupNight(flapping, NIGHT));
    expect(half.shown.length).toBe(1);
    expect(half.hidden).toBe(0);
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
