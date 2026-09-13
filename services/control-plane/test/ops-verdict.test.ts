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
import { replayHistoryRow } from '../src/ops/replay';

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
    fails30m: { failures: 0 },
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

function priorFrom(result: {
  verdict: NodeVerdict;
  candidateVerdict: NodeVerdict;
  candidateStreak: number;
  candidateSince: number | null;
  changedAt: number;
}): NodePrior {
  return {
    verdict: result.verdict,
    candidateVerdict: result.candidateVerdict,
    candidateStreak: result.candidateStreak,
    candidateSince: result.candidateSince,
    changedAt: result.changedAt,
  };
}

function okPrior(): NodePrior {
  return {
    verdict: 'ok',
    candidateVerdict: 'ok',
    candidateStreak: 0,
    candidateSince: null,
    changedAt: NOW,
  };
}

function tick(t: number, over: Partial<NodeVerdictInput> = {}) {
  return evaluate(world({
    nowSec: t,
    qualitySweepAt: t - 60,
    agentsSnapshotAt: t - 60,
    nodes: [node({ agentObservedAt: t - 30, ...over })],
  })).nodes[0];
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
      name: 'unreachable in the sweep but agent fresh is probe_unreachable, never ok or unknown',
      over: { ok: false, agentObservedAt: NOW - 60 },
      expected: 'probe_unreachable',
    },
    {
      name: 'DOWN with a live agent is probe_unreachable',
      over: { ok: false, blockStatus: 'DOWN', agentObservedAt: NOW - 60 },
      expected: 'probe_unreachable',
    },
    {
      name: 'unreachable with a live agent still yields degraded on customer failures',
      over: {
        ok: false,
        blockStatus: 'DOWN',
        agentObservedAt: NOW - 60,
        fails30m: fails({ attempts: 40, failures: 40, distinctUsers: 6, handshakeDistinctUsers: 6 }),
      },
      expected: 'degraded',
    },
    {
      name: 'unreachable with a live agent still yields degraded on an error spike',
      over: { ok: false, agentObservedAt: NOW - 60, errorSpike: true },
      expected: 'degraded',
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
    {
      name: 'listed node absent from a fresh sweep is no_probe, never ok',
      over: { ok: null, blockStatus: null, catalogListed: true, agentObservedAt: NOW - 60 },
      expected: 'no_probe',
    },
    {
      name: 'unlisted node absent from a fresh sweep is unknown, never ok',
      over: { ok: null, blockStatus: null, catalogListed: false, agentObservedAt: NOW - 60 },
      expected: 'unknown',
    },
    {
      name: 'listing-unknown node absent from a fresh sweep is unknown, never ok',
      over: { ok: null, blockStatus: null, catalogListed: null, agentObservedAt: NOW - 60 },
      expected: 'unknown',
    },
  ];

  it('matches the first-hit table', () => {
    expect(VERDICT_PRECEDENCE).toEqual([
      'down', 'blocked', 'no_probe', 'degraded', 'probe_unreachable', 'pressure', 'unknown', 'ok',
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

  it('records that a fresh sweep never covered the machine', () => {
    const out = evaluate(world({
      nodes: [node({ ok: null, blockStatus: null, catalogListed: true, agentObservedAt: NOW - 60 })],
    }));
    expect(out.nodes[0].verdict).not.toBe('ok');
    expect(JSON.stringify(out.nodes[0].evidence)).toContain('大陆探测没有覆盖这台机器');
  });
});

describe('hysteresis table', () => {
  it('enumerates enter/exit seconds so tests can pin the promotion rules', () => {
    expect(Object.fromEntries(HYSTERESIS.map((rule) => [rule.verdict, {
      enterSeconds: rule.enterSeconds,
      exitSeconds: rule.exitSeconds,
      enterStreak: rule.enterStreak,
    }]))).toEqual({
      down: { enterSeconds: 0, exitSeconds: 0, enterStreak: 1 },
      blocked: { enterSeconds: 0, exitSeconds: 0, enterStreak: 2 },
      no_probe: { enterSeconds: 0, exitSeconds: 0, enterStreak: 1 },
      degraded: { enterSeconds: 600, exitSeconds: 900, enterStreak: 2 },
      probe_unreachable: { enterSeconds: 600, exitSeconds: 0, enterStreak: 2 },
      pressure: { enterSeconds: 900, exitSeconds: 900, enterStreak: 3 },
      unknown: { enterSeconds: 0, exitSeconds: 0, enterStreak: 1 },
      ok: { enterSeconds: 0, exitSeconds: 0, enterStreak: 1 },
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

  it('holds a degraded candidate for 600s and a clean candidate for 900s', () => {
    const loss = { unicom: { lossPct: 12, latencyMs: 80, samples: 4 } };
    const t0 = tick(NOW, { carriers: loss, prior: okPrior() });
    expect(t0.verdict).toBe('ok');
    expect(t0.candidateVerdict).toBe('degraded');
    expect(t0.candidateSince).toBe(NOW);

    const t60 = tick(NOW + 60, { carriers: loss, prior: priorFrom(t0) });
    expect(t60.verdict).toBe('ok');
    const t300 = tick(NOW + 300, { carriers: loss, prior: priorFrom(t60) });
    expect(t300.verdict).toBe('ok');

    const t600 = tick(NOW + 600, { carriers: loss, prior: priorFrom(t300) });
    expect(t600.verdict).toBe('degraded');
    expect(t600.label).toBe('回程丢包');
    expect(t600.candidateSince).toBeNull();

    const t700 = tick(NOW + 700, { prior: priorFrom(t600) });
    expect(t700.verdict).toBe('degraded');
    expect(t700.candidateVerdict).toBe('ok');
    expect(t700.candidateSince).toBe(NOW + 700);

    const t1500 = tick(NOW + 1500, { prior: priorFrom(t700) });
    expect(t1500.verdict).toBe('degraded');

    const t1600 = tick(NOW + 1600, { prior: priorFrom(t1500) });
    expect(t1600.verdict).toBe('ok');
  });

  it('holds a pressure candidate until 900s have elapsed', () => {
    const hot = { cpu: 91, memRatio: 0.2, diskRatio: 0.2, load1: 4 };
    const t0 = tick(NOW, { machine: hot, prior: okPrior() });
    expect(t0.verdict).toBe('ok');
    const t600 = tick(NOW + 600, { machine: hot, prior: priorFrom(t0) });
    expect(t600.verdict).toBe('ok');
    const t900 = tick(NOW + 900, { machine: hot, prior: priorFrom(t600) });
    expect(t900.verdict).toBe('pressure');
  });

  it('does not enter degraded at 600s with only one observation in the streak', () => {
    const loss = { unicom: { lossPct: 12, latencyMs: 80, samples: 4 } };
    const out = tick(NOW, {
      carriers: loss,
      prior: {
        verdict: 'ok',
        candidateVerdict: 'degraded',
        candidateStreak: 0,
        candidateSince: NOW - 600,
        changedAt: NOW - 600,
      },
    });
    expect(out.verdict).toBe('ok');
    expect(out.candidateVerdict).toBe('degraded');
    expect(out.candidateStreak).toBe(1);
  });

  const flapRows: Array<{
    name: NodeVerdict;
    over: Partial<NodeVerdictInput>;
    enterAt: number;
  }> = [
    { name: 'pressure', over: { machine: { cpu: 91, memRatio: 0.2, diskRatio: 0.2, load1: 4 } }, enterAt: 900 },
    { name: 'degraded', over: { carriers: { unicom: { lossPct: 12, latencyMs: 80, samples: 4 } } }, enterAt: 600 },
  ];

  it.each(flapRows)('lets $name exit after exitSeconds while ok/unknown flap', ({ name, over, enterAt }) => {
    const t0 = tick(NOW, { ...over, prior: okPrior() });
    const mid = tick(NOW + Math.floor(enterAt / 2), { ...over, prior: priorFrom(t0) });
    const entered = tick(NOW + enterAt, { ...over, prior: priorFrom(mid) });
    expect(entered.verdict).toBe(name);

    const exit0 = NOW + enterAt + 100;
    function step(t: number, observed: 'ok' | 'unknown', prior: NodePrior) {
      return evaluate(world({
        nowSec: t,
        qualitySweepAt: t - 60,
        agentsSnapshotAt: observed === 'unknown' ? t - 16 * 60 : t - 60,
        nodes: [node({ agentObservedAt: t - 30, prior })],
      })).nodes[0];
    }

    const a = step(exit0, 'ok', priorFrom(entered));
    expect(a.verdict).toBe(name);
    expect(a.candidateVerdict).toBe('ok');
    expect(a.candidateSince).toBe(exit0);

    const b = step(exit0 + 60, 'unknown', priorFrom(a));
    expect(b.verdict).toBe(name);
    expect(b.candidateVerdict).toBe('unknown');
    expect(b.candidateSince).toBe(exit0);

    const c = step(exit0 + 120, 'ok', priorFrom(b));
    expect(c.candidateSince).toBe(exit0);

    const done = step(exit0 + 900, 'ok', priorFrom(c));
    expect(done.verdict).toBe('ok');
  });

  it('enters probe_unreachable after 600s and leaves on one clean sweep', () => {
    const deadInbound = { ok: false as const, blockStatus: 'DOWN' };
    const t0 = tick(NOW, { ...deadInbound, prior: okPrior() });
    expect(t0.verdict).toBe('ok');
    expect(t0.candidateVerdict).toBe('probe_unreachable');
    const t600 = tick(NOW + 600, { ...deadInbound, prior: priorFrom(t0) });
    expect(t600.verdict).toBe('probe_unreachable');
    expect(t600.label).toBe('探测不通（机器在线）');
    expect(t600.reason).toBe('大陆探测不通，但机器在线；可能是入站挂了');
    const clean = tick(NOW + 601, { prior: priorFrom(t600) });
    expect(clean.verdict).toBe('ok');
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
    const opened = ticks.filter((row) => row.open).map((row) => row.tick);
    expect(opened[0]).toBe(5);
    expect(opened).toEqual([5, 6, 7]);
    expect(ticks[6]?.open).toBe(true);
    expect(ticks[6]?.severity).toBe('severe');
    expect(new Set(opened).size).toBe(3);
  });

  it('severe warn ok warn ok ok ok ok ok closes only after the clean streak', () => {
    const ticks = play(['severe', 'warn', 'ok', 'warn', 'ok', 'ok', 'ok', 'ok', 'ok'], 3);
    expect(ticks.map((row) => row.open)).toEqual([
      true, true, true, true, true, true, false, false, false,
    ]);
    expect(pathStreakOpen(nextPathStreak(3, false))).toBe(true);
    expect(pathStreakOpen(nextPathStreak(-2, false))).toBe(false);
  });
});

describe('customer desires', () => {
  it('opens repeat-fail at 3 connectFail with no later connectOk', () => {
    const out = evaluate(world({
      customers: [customer({
        fails30m: { failures: 3 },
        lastFailAt: NOW - 60,
        lastOkAt: NOW - 600,
      })],
    }));
    expect(out.desires.some((d) => d.kind === 'customer-repeat-fail')).toBe(true);
  });

  it('opens node-probe-unreachable as warn with a node_probe job and does not demote customers', () => {
    const deadInbound = { ok: false as const, blockStatus: 'DOWN' as const, occupancy: 6 };
    const t0 = tick(NOW, { ...deadInbound, prior: okPrior() });
    const committed = tick(NOW + 600, { ...deadInbound, prior: priorFrom(t0) });
    const out = evaluate(world({
      nowSec: NOW + 600,
      qualitySweepAt: NOW + 540,
      agentsSnapshotAt: NOW + 540,
      nodes: [node({
        ...deadInbound,
        agentObservedAt: NOW + 570,
        occupancy: 6,
        prior: priorFrom(committed),
      })],
      customers: [customer({
        fails30m: { failures: 40 },
        lastFailAt: NOW + 540,
        lastOkAt: NOW,
      })],
    }));
    const parent = out.desires.find((d) => d.kind === 'node-probe-unreachable');
    const child = out.desires.find((d) => d.kind === 'customer-repeat-fail');
    expect(parent).toMatchObject({
      kind: 'node-probe-unreachable',
      severity: 'warn',
      suggestedJob: 'node_probe',
      subjectId: 'Tokyo · Test',
    });
    expect(parent?.title).toContain('探测不通（机器在线）');
    expect(child?.severity).toBe('warn');
    expect(child?.parentDedupeKey).toBeUndefined();
  });

  it('demotes customer severity to notice when the selected node is a severe parent', () => {
    const out = evaluate(world({
      nodes: [node({
        blockStatus: 'LIKELY_BLOCKED',
        occupancy: 2,
        fails30m: fails({ handshakeDistinctUsers: 2 }),
      })],
      customers: [customer({
        fails30m: { failures: 4 },
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
        fails30m: { failures: 5 },
        lastFailAt: NOW - 10,
        lastOkAt: null,
      })],
      maintenance: new Set(['Tokyo · Test']),
    }));
    expect(out.nodes[0].verdict).toBe('down');
    expect(out.desires.filter((d) => d.kind !== 'fleet-collector-stale')).toEqual([]);
  });

  it('opens fleet-catalog-unavailable when the catalog cannot be read, and does not treat nodes as unlisted', () => {
    const out = evaluate(world({
      catalogAvailable: false,
      catalogErrorClass: 'decrypt',
      nodes: [node({ catalogListed: null })],
    }));
    const desire = out.desires.find((d) => d.kind === 'fleet-catalog-unavailable');
    expect(desire).toMatchObject({
      kind: 'fleet-catalog-unavailable',
      subjectType: 'fleet',
      subjectId: 'catalog',
      severity: 'severe',
    });
    expect(desire?.evidence).toMatchObject({ catalogAvailable: false, errorClass: 'decrypt' });
    expect(out.nodes[0].catalogListed).toBeNull();
    expect(out.desires.some((d) => d.kind === 'node-no-probe' && d.suggestedJob === 'catalog_retire')).toBe(false);
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

  it.each([
    {
      name: 'retired with occupants opens retire_pending',
      over: { profileStatus: 'retired' as const, catalogListed: false, occupancy: 2 },
      want: 2,
    },
    {
      name: 'retired empty closes (emits nothing)',
      over: { profileStatus: 'retired' as const, catalogListed: false, occupancy: 0 },
      want: 0,
    },
    {
      name: 'listed active does not open retire_pending',
      over: { profileStatus: 'active' as const, catalogListed: true, occupancy: 2 },
      want: 0,
    },
    {
      name: 'relist (active again) reopens nothing',
      over: { profileStatus: 'active' as const, catalogListed: true, occupancy: 0 },
      want: 0,
    },
  ])('$name', ({ over, want }) => {
    const out = evaluate(world({
      nodes: [node({
        name: 'Old · Box',
        ok: false,
        agentObservedAt: null,
        ...over,
      })],
    }));
    const pending = out.desires.filter((d) => d.kind === 'retire_pending');
    if (want === 0) {
      expect(pending).toEqual([]);
      return;
    }
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      dedupeKey: 'node:Old · Box:retire_pending',
      kind: 'retire_pending',
      subjectType: 'node',
      subjectId: 'Old · Box',
      severity: 'notice',
      impactCount: want,
    });
  });
});

describe('replay', () => {
  it('replays LIKELY_BLOCKED + ok + 5 handshake users as blocked / node-blocked', () => {
    const row = replayHistoryRow({
      at: NOW,
      node: 'Tokyo · Test',
      toVerdict: 'blocked',
      evidenceJson: JSON.stringify({
        ok: true,
        blockStatus: 'LIKELY_BLOCKED',
        fails30m: {
          attempts: 10,
          failures: 5,
          distinctUsers: 5,
          handshakeDistinctUsers: 5,
        },
      }),
    });
    expect(row).not.toBeNull();
    expect(row!.nowVerdict).toBe('blocked');
    expect(row!.wouldOpenKind).toBe('node-blocked');
  });
});
