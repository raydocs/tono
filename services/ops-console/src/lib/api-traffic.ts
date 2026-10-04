import { copy } from '@/copy/copy';
import { getJson } from './api';

export const TRAFFIC_RANGES = ['24h', '7d', '90d'] as const;
export type TrafficRange = (typeof TRAFFIC_RANGES)[number];
export type NetworkPoint = { t: number; netIn: number | null; netOut: number | null };
export type NetworkWindow = { range: TrafficRange; from: number; to: number; resolutionSeconds: number; series: Record<string, NetworkPoint[]> };
export type UsageWindow = { range: TrafficRange; from: number; to: number; resolutionSeconds: number; fleet: Array<{ t: number; bytes: number | null }> };

export function trafficRange(value: string | null): TrafficRange {
  return TRAFFIC_RANGES.find((range) => range === value) ?? '24h';
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(copy.loadError);
  return value as Record<string, unknown>;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(copy.loadError);
  return value;
}
function nullable(value: unknown): number | null { return value === null ? null : number(value); }
function windowOf(row: Record<string, unknown>) {
  const from = number(row.from);
  const to = number(row.to);
  const resolutionSeconds = number(row.resolutionSeconds);
  if (to < from || resolutionSeconds === 0) throw new Error(copy.loadError);
  return { from, to, resolutionSeconds };
}
function points<T>(value: unknown, read: (row: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) throw new Error(copy.loadError);
  return value.map((point: unknown) => read(object(point)));
}

// Pre-contract endpoints, read through the same session/timeout boundary as
// every other console read. Lifetime counters are not converted on the wire.
export const trafficApi = {
  metrics: async (range: TrafficRange, signal: AbortSignal): Promise<NetworkWindow> => {
    const body = object(await getJson<unknown>('metrics', signal, { range, fields: 'netIn,netOut' }));
    const row = object(body.metrics);
    const series = Object.fromEntries(Object.entries(object(row.series)).map(([name, value]) => [name,
      points(value, (point) => ({ t: number(point.t), netIn: nullable(point.netIn), netOut: nullable(point.netOut) })),
    ]));
    return { range, ...windowOf(row), series };
  },
  usage: async (range: TrafficRange, signal: AbortSignal): Promise<UsageWindow> => {
    const body = object(await getJson<unknown>('usage-hours', signal, { range }));
    const row = object(body.usageHours);
    return { range, ...windowOf(row), fleet: points(row.fleet, (point) => ({ t: number(point.t), bytes: nullable(point.bytes) })) };
  },
};
