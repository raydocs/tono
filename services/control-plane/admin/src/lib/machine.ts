import type { LiveAgentDto, NodeProfileDto } from '../api';

export function machineSignals(agent: LiveAgentDto, nowMs: number) {
  const signals: { label: string; severity: number }[] = [];
  const pct = (used: number | null, total: number | null) =>
    used != null && total != null && total > 0 ? (used / total) * 100 : null;

  const memPct = pct(agent.memUsed, agent.memTotal);
  const diskPct = pct(agent.diskUsed, agent.diskTotal);
  const perCore = agent.load1 != null && agent.cpuCores ? agent.load1 / agent.cpuCores : null;
  const ageSec = agent.observedAt ? Math.max(0, Math.round(nowMs / 1000) - agent.observedAt) : null;

  if (ageSec === null) signals.push({ label: '未上报', severity: 3 });
  else if (ageSec > 600) signals.push({ label: `失联 ${Math.round(ageSec / 60)} 分钟`, severity: 4 });
  else if (ageSec > 180) signals.push({ label: `${Math.round(ageSec / 60)} 分钟未更新`, severity: 2 });

  if (perCore != null && perCore >= 2) signals.push({ label: `负载 ${perCore.toFixed(1)}×核`, severity: 4 });
  else if (perCore != null && perCore >= 1) signals.push({ label: `负载 ${perCore.toFixed(1)}×核`, severity: 2 });

  if (memPct != null && memPct >= 92) signals.push({ label: `内存 ${memPct.toFixed(0)}%`, severity: 3 });
  if (diskPct != null && diskPct >= 90) signals.push({ label: `磁盘 ${diskPct.toFixed(0)}%`, severity: 3 });
  if (agent.swapUsed != null && agent.swapUsed > 0) {
    signals.push({ label: `swap ${formatSwap(agent.swapUsed)}`, severity: 2 });
  }
  return { signals, memPct, diskPct, perCore, ageSec };
}

function formatSwap(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 'B';
  for (const next of units) {
    if (size < 1024) break;
    size /= 1024;
    unit = next;
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${unit}`;
}

export type BillingView = {
  renewsAt: number | null;
  trafficQuotaBytes: number | null;
  trafficUsedBytes: number | null;
  price: number | null;
  currency: string | null;
  billingCycle: number | null;
  source: 'profile' | 'komari' | 'mixed' | 'none';
};

export function mergedBilling(
  profile: NodeProfileDto | undefined,
  agent: LiveAgentDto | undefined,
): BillingView {
  const renewsAt = profile?.renewsAt ?? agent?.expiredAt ?? null;
  const trafficQuotaBytes = profile?.trafficQuotaBytes ?? agent?.trafficLimit ?? null;
  const trafficUsedBytes = profile?.trafficUsedBytes ?? null;
  const price = agent?.price ?? null;
  const currency = agent?.currency ?? null;
  const billingCycle = agent?.billingCycle ?? null;
  const fromProfile = Boolean(profile?.renewsAt || profile?.trafficQuotaBytes);
  const fromKomari = Boolean(agent?.expiredAt || agent?.trafficLimit || agent?.price);
  let source: BillingView['source'] = 'none';
  if (fromProfile && fromKomari) source = 'mixed';
  else if (fromProfile) source = 'profile';
  else if (fromKomari) source = 'komari';
  return { renewsAt, trafficQuotaBytes, trafficUsedBytes, price, currency, billingCycle, source };
}

export function trafficRemaining(
  profile: NodeProfileDto | undefined,
  agent: LiveAgentDto | undefined,
) {
  const quota = profile?.trafficQuotaBytes ?? agent?.trafficLimit ?? null;
  if (quota == null) return null;
  if (profile?.trafficUsedBytes != null) return quota - profile.trafficUsedBytes;
  if (
    agent
    && profile?.cycleNetIn != null
    && profile?.cycleNetOut != null
  ) {
    const used = Math.max(0, (agent.netIn ?? 0) + (agent.netOut ?? 0) - profile.cycleNetIn - profile.cycleNetOut);
    return quota - used;
  }
  return null;
}
