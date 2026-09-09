export const NODE_SWITCH_FREQUENT_24H = 4;
export const NODE_SWITCH_HISTORY_LIMIT = 50;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export type NodeSwitchKind = 'nodeSwitch' | 'connectCatalogFailover';

export type NodeSwitchHop = {
  ts: number;
  from: string;
  to: string;
  kind: NodeSwitchKind;
  deviceId: string | null;
};

export type NodeSwitchHistory = {
  hops: NodeSwitchHop[];
  last24h: number;
  last7d: number;
  uniqueNodes: number;
  frequent: boolean;
};

const HOP_KINDS = new Set<NodeSwitchKind>(['nodeSwitch', 'connectCatalogFailover']);

function isHopKind(value: string): value is NodeSwitchKind {
  return HOP_KINDS.has(value as NodeSwitchKind);
}

function parsePayload(raw: unknown): { events: unknown[] } | null {
  if (typeof raw !== 'string' && raw !== undefined && raw !== null) return null;
  try {
    const parsed = raw ? JSON.parse(String(raw)) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const events = (parsed as { events?: unknown }).events;
    if (!Array.isArray(events)) return null;
    return { events };
  } catch {
    return null;
  }
}

/** Extract user and catalog-failover hops from stored periodic telemetry windows. */
export function nodeSwitchHistory(
  rows: Array<{ device_id?: unknown; payload_json?: unknown }>,
  nowMs: number,
): NodeSwitchHistory {
  const seen = new Set<string>();
  const hops: NodeSwitchHop[] = [];

  for (const row of rows) {
    const payload = parsePayload(row.payload_json);
    if (!payload) continue;
    const deviceId = row.device_id == null || row.device_id === ''
      ? null
      : String(row.device_id);

    for (const raw of payload.events) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const event = raw as Record<string, unknown>;
      if (typeof event.kind !== 'string' || !isHopKind(event.kind)) continue;
      if (typeof event.ts !== 'number' || !Number.isSafeInteger(event.ts) || event.ts < 0) continue;
      const from = typeof event.from === 'string' ? event.from : '';
      const to = typeof event.to === 'string' ? event.to : '';
      if (!to) continue;
      const key = `${event.ts}|${event.kind}|${from}|${to}|${deviceId ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hops.push({ ts: event.ts, from, to, kind: event.kind, deviceId });
    }
  }

  hops.sort((left, right) => right.ts - left.ts || left.from.localeCompare(right.from));

  const last24h = hops.filter((hop) => nowMs - hop.ts <= DAY_MS).length;
  const last7d = hops.filter((hop) => nowMs - hop.ts <= WEEK_MS).length;
  const uniqueNodes = new Set<string>();
  for (const hop of hops) {
    if (hop.from) uniqueNodes.add(hop.from);
    if (hop.to) uniqueNodes.add(hop.to);
  }

  return {
    hops: hops.slice(0, NODE_SWITCH_HISTORY_LIMIT),
    last24h,
    last7d,
    uniqueNodes: uniqueNodes.size,
    frequent: last24h >= NODE_SWITCH_FREQUENT_24H,
  };
}
