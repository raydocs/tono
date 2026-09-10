import { describe, expect, it } from 'vitest';
import { assertIncident, assertList, type IncidentDto } from '@contract';
import { copy } from '@/copy/copy';
import rawOpen from '../../fixtures/incidents.json';
import rawQuiet from '../../fixtures/incidents.empty.json';
import {
  childrenOf,
  evidenceSentence,
  impactedCustomers,
  incidentAction,
  lastResolvedAt,
  openIncidents,
  resolvedIncidents,
} from './incidents';

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


const base = rows[0];

function incident(patch: Partial<IncidentDto>): IncidentDto {
  return { ...base, ...patch };
}

/** What the engine actually writes into an incident, as it comes back out. */
function evidence(label: string, value: unknown) {
  return {
    label,
    value: typeof value === 'string' ? value : JSON.stringify(value),
    asOfSec: base.lastSeenAt,
    source: 'engine' as const,
  };
}

describe('the one thing worth doing about an incident', () => {
  it('leads a blocked node with the unlisting it is heading for', () => {
    const action = incidentAction(incident({ kind: 'node-blocked', subjectType: 'node', subjectId: 'Tokyo' }));
    expect(action?.label).toBe(copy.incidentAction.retirePreview);
    expect(action?.go).toBe('node');
    expect(action?.subjectId).toBe('Tokyo');
    expect(action?.blocked).toBeNull();
  });

  it('reads the older underscore spelling as the same kind', () => {
    const dashed = incidentAction(incident({ kind: 'node-down', subjectType: 'node', subjectId: 'Tokyo' }));
    const scored = incidentAction(incident({ kind: 'node_down', subjectType: 'node', subjectId: 'Tokyo' }));
    expect(scored?.id).toBe(dashed?.id);
    expect(scored?.jobType).toBe('node_probe');
  });

  it('asks a degraded machine for its own error log', () => {
    const action = incidentAction(incident({ kind: 'node_degraded', subjectType: 'node', subjectId: 'Tokyo' }));
    expect(action?.jobType).toBe('xray_dial_errors');
    expect(action?.consequence).toBe(copy.nodeActionConsequence.pullErrors);
  });

  it('sends a customer incident to that customer', () => {
    const action = incidentAction(incident({ kind: 'customer_unreachable', subjectType: 'user', subjectId: 'u-04' }));
    expect(action?.go).toBe('customer');
    expect(action?.subjectId).toBe('u-04');
  });

  /** A disabled button with no reason is what makes people reload the page. */
  it('says why, whenever it cannot be pressed', () => {
    const noNode = incidentAction(incident({ kind: 'node_down', subjectType: 'user', subjectId: 'u-04' }));
    expect(noNode?.blocked).toBe(copy.incidentActionBlocked.noNode);
    const noOne = incidentAction(incident({ kind: 'customer_unstable', subjectType: 'home_exit', subjectId: 'h-1' }));
    expect(noOne?.blocked).toBe(copy.incidentActionBlocked.noCustomer);
    const sources = incidentAction(incident({ kind: 'fleet-collector-stale', subjectType: 'fleet', subjectId: 'collector' }));
    expect(sources?.blocked).toBe(copy.incidentActionBlocked.noSourcesPage);
  });

  it('invents nothing for a kind nobody has mapped', () => {
    expect(incidentAction(incident({ kind: 'home_exit_down' }))).toBeNull();
  });
});

describe('the evidence, in the operator\'s language', () => {
  it('says what the mainland scan saw, not what the key was called', () => {
    expect(evidenceSentence(evidence('blockStatus', 'LIKELY_BLOCKED')))
      .toBe(copy.evidence.scan(copy.nodeVerdictWord.blocked));
  });

  it('names the carrier and the loss it measured', () => {
    expect(evidenceSentence(evidence('loss', [{ key: 'unicom', lossPct: 10 }])))
      .toBe(copy.evidence.lossOne(copy.nodeCarrier.unicom, '10%'));
    expect(evidenceSentence(evidence('loss', []))).toBe(copy.evidence.lossNone);
  });

  it('reads the machine as a load and a share, both rounded to something sayable', () => {
    const said = evidenceSentence(evidence('machine', {
      cpu: 12, memRatio: 0.12, diskRatio: 0.4, load1: 0.043,
    }));
    expect(said).toContain('0.04');
    expect(said).toContain('12%');
  });

  it('counts the half hour of failures in people, not in keys', () => {
    expect(evidenceSentence(evidence('fails30m', {
      attempts: 20, failures: 4, distinctUsers: 3, handshakeDistinctUsers: 2,
    }))).toBe(copy.evidence.fails('4', '20', '3'));
  });

  it('turns a stamp into how long ago it was', () => {
    expect(evidenceSentence(evidence('agentObservedAt', null))).toBe(copy.evidence.agentSilent);
    expect(evidenceSentence(evidence('qualitySweepAt', base.lastSeenAt)))
      .toContain(copy.evidence.scanAt('').trim());
  });

  /** The rule that matters most: no key the engine adds later can print braces. */
  it('falls back to the key and a readable value, never to raw notation', () => {
    const said = evidenceSentence(evidence('somethingNew', { a: 1, b: true }));
    expect(said).not.toContain('{');
    expect(said).not.toContain('}');
    expect(said).not.toContain('"');
    expect(said).toContain('somethingNew');
  });

  it('leaves a hand-written sentence alone', () => {
    const hand = rows[0].evidence.find((row) => row.label === '海外探测');
    expect(hand).toBeDefined();
    const said = evidenceSentence(hand!);
    expect(said).toContain(hand!.label);
    expect(said).toContain(hand!.value);
  });

  it('says every line of the open node incident without a brace in sight', () => {
    const said = rows[0].evidence.map(evidenceSentence);
    expect(said.length).toBeGreaterThan(4);
    for (const line of said) expect(line).not.toMatch(/[{}[\]"]/);
    expect(said).toContain(copy.evidence.scan(copy.nodeVerdictWord.blocked));
  });

  it('never prints a brace for anything the engine writes today', () => {
    const written = [
      evidence('observed', 'blocked'),
      evidence('ok', false),
      evidence('verdict', 'down'),
      evidence('occupancy', 5),
      evidence('catalogListed', true),
      evidence('errorSpike', true),
      evidence('handshakeDistinctUsers', 3),
      evidence('agentsSnapshotAt', base.lastSeenAt),
      evidence('delayMs', 820),
      evidence('pathStreak', 3),
      evidence('selectedServer', 'Tokyo · Fuji'),
      evidence('failures', 5),
      evidence('lastFailAt', base.lastSeenAt),
      evidence('lastOkAt', base.lastSeenAt),
      evidence('switches24h', 6),
    ];
    for (const row of written) {
      const said = evidenceSentence(row);
      expect(said, row.label).not.toMatch(/[{}[\]"]/);
      expect(said, row.label).not.toBe(row.label);
    }
  });
});
