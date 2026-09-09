import { copy } from '@/copy/copy';
import type { FleetNodeDto } from './types';

export const HEALTH_WORDS = [
  copy.health.lost,
  copy.health.blocked,
  copy.health.degraded,
  copy.health.ok,
  copy.health.unmeasured,
] as const;

export type HealthWord = (typeof HEALTH_WORDS)[number];

const LOST_QUALITY = new Set(['DOWN', 'EDGE_FAIL']);
const BLOCKED_QUALITY = new Set(['LIKELY_BLOCKED']);
const DEGRADED_QUALITY = new Set(['DEGRADED']);
const OK_QUALITY = new Set(['OK', 'EDGE_OK']);

function flags(node: Pick<FleetNodeDto, 'qualityStatus' | 'agentStatus'>): Set<HealthWord> {
  const out = new Set<HealthWord>();
  const quality = node.qualityStatus;
  const agent = node.agentStatus;
  if (LOST_QUALITY.has(quality)) out.add(copy.health.lost);
  if (BLOCKED_QUALITY.has(quality)) out.add(copy.health.blocked);
  if (DEGRADED_QUALITY.has(quality) || agent === 'stale') out.add(copy.health.degraded);
  if (OK_QUALITY.has(quality) && agent === 'online') out.add(copy.health.ok);
  if (out.size === 0) out.add(copy.health.unmeasured);
  return out;
}

/** Precedence: 失联 > 被墙 > 劣化 > 正常 > 未测. */
export function mapFleetHealth(node: Pick<FleetNodeDto, 'qualityStatus' | 'agentStatus'>): HealthWord {
  const present = flags(node);
  for (const word of HEALTH_WORDS) {
    if (present.has(word)) return word;
  }
  return copy.health.unmeasured;
}
