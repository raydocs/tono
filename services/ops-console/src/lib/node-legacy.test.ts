import { describe, expect, it } from 'vitest';
import { foldLoad, hasLoad, type LoadSample, type NodeLoadWindow } from './node-legacy';

const MINUTE = 60;
const GIB = 1_073_741_824;

function sample(index: number, over: Partial<LoadSample> = {}): LoadSample {
  return {
    t: index * MINUTE,
    cpu: 10,
    memUsed: GIB / 2,
    memTotal: GIB,
    netIn: index * 60 * MINUTE,
    netOut: index * 30 * MINUTE,
    tcpConnections: 10,
    ...over,
  };
}

function windowOf(samples: LoadSample[]): NodeLoadWindow {
  return {
    from: samples.length === 0 ? 0 : samples[0].t,
    to: samples.length === 0 ? MINUTE : samples[samples.length - 1].t,
    resolutionSeconds: MINUTE,
    samples,
  };
}

function drawn(points: Array<{ t: number; v: number | null }>): number[] {
  return points.map((point) => point.v).filter((value): value is number => value !== null);
}

describe('foldLoad', () => {
  it('turns the byte counters into a rate, not a running total', () => {
    const charts = foldLoad(windowOf([sample(0), sample(1), sample(2)]));
    // 60 bytes a second for a minute, read off two counters a minute apart.
    expect(drawn(charts.netIn).every((value) => Math.round(value) === 60)).toBe(true);
    expect(drawn(charts.netOut).every((value) => Math.round(value) === 30)).toBe(true);
  });

  it('leaves a hole where a counter went backwards rather than a negative spike', () => {
    const charts = foldLoad(windowOf([
      sample(0, { netIn: 100_000, netOut: 50_000 }),
      sample(1, { netIn: 400_000, netOut: 200_000 }),
      // The machine rebooted: both counters start again from nothing.
      sample(2, { netIn: 900, netOut: 300 }),
      sample(3, { netIn: 60_900, netOut: 30_300 }),
    ]));
    expect(drawn(charts.netIn).every((value) => value >= 0)).toBe(true);
    expect(drawn(charts.netIn).length).toBe(2);
  });

  it('reads memory as a share of the machine, and refuses to guess without both halves', () => {
    const full = foldLoad(windowOf([sample(0), sample(1, { memUsed: GIB * 0.75 })]));
    expect(drawn(full.memory)).toContain(75);
    const half = foldLoad(windowOf([sample(0, { memTotal: null }), sample(1, { memTotal: null })]));
    expect(drawn(half.memory)).toEqual([]);
  });

  it('quotes the 95th percentile of in plus out, which drops the loudest minute', () => {
    // Twenty measured minutes, nineteen of them quiet and one very loud. That
    // is exactly what 95th-percentile billing throws away, so the number the
    // block prints is the quiet rate and not the spike.
    const samples: LoadSample[] = [sample(0, { netIn: 0, netOut: 0 })];
    let counter = 0;
    for (let index = 1; index <= 20; index += 1) {
      counter += (index === 20 ? 9_000 : 60) * MINUTE;
      samples.push(sample(index, { netIn: counter, netOut: 0 }));
    }
    const charts = foldLoad(windowOf(samples));
    expect(charts.bandwidth95).toBe(60);
    expect(Math.max(...drawn(charts.netIn))).toBe(9_000);
  });

  it('names the busiest moment the box held, and when it was last heard from', () => {
    const charts = foldLoad(windowOf([
      sample(0, { tcpConnections: 12 }),
      sample(1, { tcpConnections: 140 }),
      sample(2, { tcpConnections: 30 }),
    ]));
    expect(charts.peakConnections).toBe(140);
    expect(charts.asOfSec).toBe(2 * MINUTE);
    expect(hasLoad(charts)).toBe(true);
  });

  it('says nothing at all about a machine nobody measured', () => {
    const charts = foldLoad(windowOf([]));
    expect(charts.asOfSec).toBeNull();
    expect(charts.bandwidth95).toBeNull();
    expect(charts.peakConnections).toBeNull();
    expect(hasLoad(charts)).toBe(false);
    expect(drawn(charts.cpu)).toEqual([]);
  });
});
