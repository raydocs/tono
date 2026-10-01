import { describe, expect, it } from 'vitest';
import { foldFleetLoad } from './fleet-load';
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
