import { describe, expect, it } from 'vitest';
import { foldFleetLoad, reportingBreakdown } from './fleet-load';
import type { FleetLoadWindow, LoadSample } from './node-legacy';

const SPAN = 96 * 60;

function sample(t: number, cpu: number | null, netIn: number | null = null): LoadSample {
  return { t, cpu, memUsed: null, memTotal: null, netIn, netOut: null, tcpConnections: null, load1: null };
}

function window(series: Record<string, LoadSample[]>): FleetLoadWindow {
  return { from: 0, to: SPAN, resolutionSeconds: 60, series: new Map(Object.entries(series)) };
}

describe('foldFleetLoad', () => {
  it('averages only the machines that reported in a column, and leaves a column nobody reported as a gap', () => {
    const load = foldFleetLoad(window({
      a: [sample(0, 10), sample(60, 30)],
      b: [sample(0, 50)],
    }));
    expect(load.cpu.mean[0]?.v).toBe(30);
    expect(load.cpu.max[0]?.v).toBe(50);
    expect(load.cpu.mean[1]?.v).toBe(30);
    expect(load.cpu.mean[2]?.v).toBeNull();
  });

  it('totals traffic as the sum of each machine’s rate, not of its counters', () => {
    const load = foldFleetLoad(window({
      a: [sample(0, null, 1_000), sample(60, null, 7_000)],
      b: [sample(0, null, 90_000), sample(60, null, 96_000)],
    }));
    expect(load.netIn[1]?.v).toBe(200);
  });
});

describe('reportingBreakdown', () => {
  const node = (name: string, lifecycle: 'listed' | 'retired' = 'listed') => ({ name, lifecycle });
  const nodes = [node('Tokyo · Fuji'), node('Seoul · Han'), node('Buffalo · Erie', 'retired')];

  it('matches a key by exact name and reports zeros when every key is a machine in service', () => {
    expect(reportingBreakdown(['Tokyo · Fuji', 'Seoul · Han'], nodes))
      .toEqual({ reporting: 2, retired: 0, unknown: 0, matched: 2, silent: 0 });
  });

  it('matches a key carrying the hy2 suffix to its base machine, and no other suffix', () => {
    const split = reportingBreakdown(['Tokyo · Fuji · hy2', 'Seoul · Han · other'], nodes);
    expect(split.matched).toBe(1);
    expect(split.unknown).toBe(1);
  });

  it('counts keys of retired machines and keys that match no machine apart', () => {
    const split = reportingBreakdown(['Tokyo · Fuji', 'Buffalo · Erie', 'Ghost · Box'], nodes);
    expect(split).toMatchObject({ reporting: 3, retired: 1, unknown: 1, matched: 2 });
  });

  it('counts in-service machines no key matches as silent, and not retired ones', () => {
    expect(reportingBreakdown(['Tokyo · Fuji'], nodes).silent).toBe(1);
  });
});
