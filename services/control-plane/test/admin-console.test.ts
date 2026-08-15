import { describe, expect, it } from 'vitest';
import { catalogProxyNames } from '../admin/src/lib/catalog';
import { formatBytes } from '../admin/src/lib/format';
import { machineSignals, mergedBilling, trafficRemaining } from '../admin/src/lib/machine';
import type { LiveAgentDto, NodeProfileDto } from '../admin/src/api';

const agent = (over: Partial<LiveAgentDto> = {}): LiveAgentDto => ({
  name: 'n',
  os: null,
  arch: null,
  cpuName: null,
  cpu: 12,
  memTotal: 100,
  memUsed: 50,
  diskTotal: 100,
  diskUsed: 10,
  netIn: 20,
  netOut: 5,
  uptime: 60,
  cpuCores: 2,
  load1: 1,
  load5: 1,
  load15: 1,
  swapTotal: 0,
  swapUsed: 0,
  tcpConnections: 3,
  processes: 10,
  observedAt: 1_700_000_000,
  price: 4,
  currency: '$',
  billingCycle: 30,
  expiredAt: 1_800_000_000,
  trafficLimit: 1_000,
  trafficLimitType: 'sum',
  ...over,
});

describe('admin console helpers', () => {
  it('extracts clash proxy names', () => {
    expect(catalogProxyNames('proxies:\n  - name: "Los Angeles"\n    type: ss\n')).toEqual(['Los Angeles']);
  });

  it('formats byte counts without inventing units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('ranks a silent agent above a busy one', () => {
    const observedAt = Math.floor(Date.now() / 1000);
    const nowMs = observedAt * 1000;
    const quiet = machineSignals(agent({ observedAt: observedAt - 700, load1: 0.1 }), nowMs);
    const busy = machineSignals(agent({ observedAt, load1: 3 }), nowMs);
    const worst = (signals: { severity: number }[]) => signals.reduce((m, s) => Math.max(m, s.severity), 0);
    expect(worst(quiet.signals)).toBeGreaterThan(worst(busy.signals));
  });

  it('fills empty nodeProfiles from Komari inventory', () => {
    const billing = mergedBilling(undefined, agent());
    expect(billing.renewsAt).toBe(1_800_000_000);
    expect(billing.trafficQuotaBytes).toBe(1_000);
    expect(billing.price).toBe(4);
    expect(billing.source).toBe('komari');
  });

  it('lets a filled profile win over Komari quota', () => {
    const profile = {
      trafficQuotaBytes: 500,
      trafficUsedBytes: 100,
      renewsAt: 1_750_000_000,
    } as NodeProfileDto;
    expect(mergedBilling(profile, agent()).trafficQuotaBytes).toBe(500);
    expect(trafficRemaining(profile, agent())).toBe(400);
  });
});
