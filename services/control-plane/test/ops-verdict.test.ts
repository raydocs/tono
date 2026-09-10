import { describe, expect, it } from 'vitest';
import {
  type IncidentDesire,
  HYSTERESIS,
  PATH_SEVERE_MS,
  PATH_WARN_MS,
  VERDICT_LABELS,
  VERDICT_PRECEDENCE,
  evaluate,
  nextPathStreak,
  observedVerdict,
  pathStreakOpen,
  type CustomerVerdictInput,
  type NodePrior,
  type NodeVerdict,
  type NodeVerdictInput,
  type VerdictInput,
} from '../src/ops/verdict';

const NOW = 1_800_000_000;

function fails(over: Partial<NodeVerdictInput['fails30m']> = {}): NodeVerdictInput['fails30m'] {
  return { attempts: 0, failures: 0, distinctUsers: 0, handshakeDistinctUsers: 0, ...over };
}

function node(over: Partial<NodeVerdictInput> = {}): NodeVerdictInput {
  return {
    name: 'Tokyo · Test',
    catalogListed: true,
    ok: true,
    blockStatus: 'OK',
    agentObservedAt: NOW - 30,
    carriers: null,
    machine: null,
    occupancy: 0,
    profileStatus: 'active',
    prior: null,
    fails30m: fails(),
    lastCustomerOkAt: null,
    errorSpike: false,
    ...over,
  };
}

function customer(over: Partial<CustomerVerdictInput> = {}): CustomerVerdictInput {
  return {
    userId: 'u1',
    email: 'a@example.com',
    selectedServer: 'Tokyo · Test',
    lastSeenAt: NOW - 10,
    online: true,
    exitDelayMs: 80,
    tcpDelayMs: 40,
    exitDelayAtMs: (NOW - 10) * 1000,
    tcpDelayAtMs: (NOW - 10) * 1000,
    fails30m: { attempts: 0, failures: 0 },
    lastFailAt: null,
    lastOkAt: NOW - 10,
    switches24h: 0,
    priorPathStreak: 0,
    ...over,
  };
}

function world(over: Partial<VerdictInput> = {}): VerdictInput {
  return {
    nodes: [node()],
    customers: [],
    nowSec: NOW,
    qualitySweepAt: NOW - 60,
    agentsSnapshotAt: NOW - 60,
    maintenance: new Set(),
    ...over,
  };
}

function ctx(over: Partial<{ nowSec: number; qualitySweepAt: number | null; agentsSnapshotAt: number | null }> = {}) {
  return {
    nowSec: NOW,
    qualitySweepAt: NOW - 60,
    agentsSnapshotAt: NOW - 60,
    ...over,
  };
}

function priorFrom(result: { verdict: NodeVerdict; candidateVerdict: NodeVerdict; candidateStreak: number; changedAt: number }): NodePrior {
  return {
    verdict: result.verdict,
    candidateVerdict: result.candidateVerdict,
    candidateStreak: result.candidateStreak,
    changedAt: result.changedAt,
  };
}

describe('verdict precedence', () => {
  const rows: Array<{ name: string; over: Partial<NodeVerdictInput>; expected: NodeVerdict; ctxOver?: Parameters<typeof ctx>[0] }> = [
    { name: 'ok===false is down', over: { ok: false, agentObservedAt: NOW - 20 * 60 }, expected: 'down' },
    { name: 'blockStatus DOWN is down', over: { blockStatus: 'DOWN', agentObservedAt: NOW - 20 * 60 }, expected: 'down' },
    { name: 'blockStatus EDGE_FAIL is down', over: { blockStatus: 'EDGE_FAIL', agentObservedAt: NOW - 20 * 60 }, expected: 'down' },
    { name: 'LIKELY_BLOCKED with ok is blocked', over: { blockStatus: 'LIKELY_BLOCKED' }, expected: 'blocked' },
    {
      name: 'down beats LIKELY_BLOCKED when unreachable',
      over: { ok: false, blockStatus: 'LIKELY_BLOCKED', agentObservedAt: NOW - 20 * 60 },
      expected: 'down',
    },
    {
      name: 'unreachable in the sweep but agent fresh is unknown, never ok',
      over: { ok: false, agentObservedAt: NOW - 60 },
      expected: 'unknown',
    },
    { name: 'listed without an agent is no_probe', over: { agentObservedAt: null }, expected: 'no_probe' },
    {
      name: 'probed carrier loss ≥10 is degraded',
      over: { carriers: { unicom: { lossPct: 10, latencyMs: 40, samples: 3 } } },
      expected: 'degraded',
    },
    {
      name: 'customer fail ratio is degraded',
      over: { fails30m: fails({ attempts: 10, failures: 3, distinctUsers: 2 }) },
      expected: 'degraded',
    },
    { name: 'errorSpike is degraded', over: { errorSpike: true }, expected: 'degraded' },
    {
      name: 'cpu ≥90 is pressure',
      over: { machine: { cpu: 90, memRatio: 0.4, diskRatio: 0.4, load1: 1 } },
      expected: 'pressure',
    },
    {
      name: 'memRatio ≥0.95 is pressure',
      over: { machine: { cpu: 10, memRatio: 0.95, diskRatio: 0.4, load1: 1 } },
      expected: 'pressure',
    },
    {
      name: 'diskRatio ≥0.95 is pressure',
      over: { machine: { cpu: 10, memRatio: 0.4, diskRatio: 0.95, load1: 1 } },
      expected: 'pressure',
    },
    { name: 'healthy is ok', over: {}, expected: 'ok' },
    {
      name: 'quality sweep older than a missed twelve-hour cycle (26h) is unknown',
      over: {},
      expected: 'unknown',
      ctxOver: { qualitySweepAt: NOW - 26 * 3600 - 1 },
    },
    {
      name: 'a nineteen-hour-old sweep is still the latest cycle, so healthy stays ok',
      over: {},
      expected: 'ok',
      ctxOver: { qualitySweepAt: NOW - 19 * 3600 },
    },
    {
      name: 'agents snapshot older than 15min is unknown',
      over: {},
      expected: 'unknown',
      ctxOver: { agentsSnapshotAt: NOW - 15 * 60 - 1 },
    },
  ];

  it('matches the first-hit table', () => {
    expect(VERDICT_PRECEDENCE).toEqual([
      'down', 'blocked', 'no_probe', 'degraded', 'pressure', 'unknown', 'ok',
    ]);
    for (const row of rows) {
      expect(observedVerdict(node(row.over), ctx(row.ctxOver)), row.name).toBe(row.expected);
    }
  });

  it('does not invent a carrier that was never probed', () => {
    expect(observedVerdict(node({
      carriers: { unicom: { lossPct: 50, latencyMs: 10, samples: 0 } },
    }), ctx())).toBe('ok');
  });
});

describe('hysteresis table', () => {
  it('enumerates enter streaks so tests can pin the promotion rules', () => {
    expect(Object.fromEntries(HYSTERESIS.map((rule) => [rule.verdict, rule.enterStreak]))).toEqual({
      down: 1,
      blocked: 2,
      no_probe: 1,
      degraded: 2,
      pressure: 3,
      unknown: 1,
      ok: 1,
    });
  });

  it('promotes blocked on the second consecutive sweep', () => {
    const first = evaluate(world({ nodes: [node({ blockStatus: 'LIKELY_BLOCKED' })] })).nodes[0];
    expect(first.verdict).toBe('unknown');
    expect(first.candidateVerdict).toBe('blocked');
    expect(first.candidateStreak).toBe(1);
    const second = evaluate(world({
      nodes: [node({ blockStatus: 'LIKELY_BLOCKED', prior: priorFrom(first) })],
    })).nodes[0];
    expect(second.verdict).toBe('blocked');
    expect(second.label).toBe(VERDICT_LABELS.blocked);
  });

  it('opens blocked after one sweep when two users failed handshake/dial', () => {
    const out = evaluate(world({
      nodes: [node({
        blockStatus: 'LIKELY_BLOCKED',
        occupancy: 4,
        fails30m: fails({ handshakeDistinctUsers: 2 }),
      })],
    }));
    expect(out.nodes[0].verdict).toBe('blocked');
    expect(out.desires.some((d) => d.kind === 'node-blocked')).toBe(true);
    expect(out.desires.find((d) => d.kind === 'node-blocked')?.title).toContain('4 位客户仍在用');
  });

  it('never promotes an unreachable node to blocked', () => {
    const out = evaluate(world({
      nodes: [node({
        ok: false,
        blockStatus: 'LIKELY_BLOCKED',
        agentObservedAt: NOW - 20 * 60,
      })],
    }));
    expect(out.nodes[0].verdict).toBe('down');
    expect(out.desires.some((d) => d.kind === 'node-blocked')).toBe(false);
    expect(out.desires.some((d) => d.kind === 'node-down')).toBe(true);
  });

  it('holds down until a fresh agent sample, then leaves on one tick', () => {
    const down = evaluate(world({
      nodes: [node({ ok: false, agentObservedAt: NOW - 20 * 60 })],
    })).nodes[0];
    expect(down.verdict).toBe('down');
    const recovered = evaluate(world({
      nodes: [node({ ok: true, blockStatus: 'OK', agentObservedAt: NOW - 10, prior: priorFrom(down) })],
    })).nodes[0];
    expect(recovered.verdict).toBe('ok');
  });

  it('needs two evaluations to commit degraded and three to commit pressure', () => {
    const loss = { unicom: { lossPct: 12, latencyMs: 80, samples: 4 } };
    const d1 = evaluate(world({ nodes: [node({ carriers: loss })] })).nodes[0];
    expect(d1.verdict).toBe('unknown');
    const d2 = evaluate(world({ nodes: [node({ carriers: loss, prior: priorFrom(d1) })] })).nodes[0];
    expect(d2.verdict).toBe('degraded');
    expect(d2.label).toBe('回程丢包');

    const hot = { cpu: 91, memRatio: 0.2, diskRatio: 0.2, load1: 4 };
    let prior: NodePrior | null = null;
    const verdicts: NodeVerdict[] = [];
    for (let i = 0; i < 3; i++) {
      const result = evaluate(world({ nodes: [node({ machine: hot, prior })] })).nodes[0];
      verdicts.push(result.verdict);
      prior = priorFrom(result);
    }
    expect(verdicts).toEqual(['unknown', 'unknown', 'pressure']);
  });
});

describe('customer path hysteresis sequences', () => {
  const delay = { ok: 100, warn: PATH_WARN_MS, severe: PATH_SEVERE_MS };

  function play(seq: Array<keyof typeof delay>, startStreak = 0) {
    let streak = startStreak;
    return seq.map((band, index) => {
      const out = evaluate(world({
        customers: [customer({
          exitDelayMs: delay[band],
          tcpDelayMs: 10,
          priorPathStreak: streak,
        })],
      }));
      streak = out.pathStreaks.u1 ?? 0;
      const desire = out.desires.find((item) => item.kind === 'customer-path-slow') ?? null;
      return { tick: index + 1, band, streak, open: desire != null, severity: desire?.severity ?? null };
    });
  }

  it('ok ok warn warn severe severe severe opens once and is still open at tick 7', () => {
    const ticks = play(['ok', 'ok', 'warn', 'warn', 'severe', 'severe', 'severe']);
    const opened = ticks.filter((tick) => tick.open).map((tick) => tick.tick);
    expect(opened[0]).toBe(4);
    expect(opened).toEqual([4, 5, 6, 7]);
    expect(ticks[6]?.open).toBe(true);
    expect(ticks[6]?.severity).toBe('severe');
    expect(new Set(opened).size).toBe(4);
  });

  it('severe warn ok warn ok ok ok ok ok closes only after the clean streak', () => {
    const ticks = play(['severe', 'warn', 'ok', 'warn', 'ok', 'ok', 'ok', 'ok', 'ok'], 2);
    expect(ticks.map((tick) => tick.open)).toEqual([
      true, true, true, true, true, false, false, false, false,
    ]);
    expect(pathStreakOpen(nextPathStreak(2, false))).toBe(true);
    expect(pathStreakOpen(nextPathStreak(-1, false))).toBe(false);
  });
});

describe('customer desires', () => {
  it('opens repeat-fail at 3 connectFail with no later connectOk', () => {
    const out = evaluate(world({
      customers: [customer({
        fails30m: { attempts: 3, failures: 3 },
        lastFailAt: NOW - 60,
        lastOkAt: NOW - 600,
      })],
    }));
    expect(out.desires.some((d) => d.kind === 'customer-repeat-fail')).toBe(true);
  });

  it('demotes customer severity to notice when the selected node is a severe parent', () => {
    const out = evaluate(world({
      nodes: [node({
        blockStatus: 'LIKELY_BLOCKED',
        occupancy: 2,
        fails30m: fails({ handshakeDistinctUsers: 2 }),
      })],
      customers: [customer({
        fails30m: { attempts: 4, failures: 4 },
        lastFailAt: NOW - 20,
        lastOkAt: NOW - 400,
        exitDelayMs: PATH_SEVERE_MS,
      })],
    }));
    const parent = out.desires.find((d) => d.kind === 'node-blocked');
    const child = out.desires.find((d) => d.kind === 'customer-repeat-fail');
    expect(parent?.severity).toBe('severe');
    expect(child?.severity).toBe('notice');
    expect(child?.parentDedupeKey).toBe(parent?.dedupeKey);
  });

  it('emits switch-churn at 4 switches in 24h', () => {
    const out = evaluate(world({ customers: [customer({ switches24h: 4 })] }));
    expect(out.desires.find((d) => d.kind === 'customer-switch-churn')?.severity).toBe('notice');
  });
});

describe('maintenance and fleet collector', () => {
  it('suppresses node and customer incidents while the node is in maintenance', () => {
    const out = evaluate(world({
      nodes: [node({
        ok: false,
        agentObservedAt: NOW - 20 * 60,
        occupancy: 3,
      })],
      customers: [customer({
        fails30m: { attempts: 5, failures: 5 },
        lastFailAt: NOW - 10,
        lastOkAt: null,
      })],
      maintenance: new Set(['Tokyo · Test']),
    }));
    expect(out.nodes[0].verdict).toBe('down');
    expect(out.desires.filter((d) => d.kind !== 'fleet-collector-stale')).toEqual([]);
  });

  it('raises fleet-collector-stale on a silent agent copy (20 min) or a missed sweep cycle (26 h)', () => {
    const stale = (d: IncidentDesire) => d.kind === 'fleet-collector-stale' && d.severity === 'severe';
    expect(evaluate(world({ agentsSnapshotAt: NOW - 21 * 60 })).desires.some(stale)).toBe(true);
    expect(evaluate(world({ qualitySweepAt: NOW - 19 * 3600 })).desires.some(stale)).toBe(false);
    expect(evaluate(world({ qualitySweepAt: NOW - 27 * 3600 })).desires.some(stale)).toBe(true);
  });

  it('a retired machine is expected to be unreachable and opens no incident', () => {
    const out = evaluate(world({
      nodes: [node({ name: 'Old · Box', ok: false, agentObservedAt: null, catalogListed: false, profileStatus: 'retired' })],
    }));
    expect(out.nodes[0].verdict).toBe('down');
    expect(out.desires.filter((d) => d.subjectType === 'node')).toEqual([]);
  });
});
