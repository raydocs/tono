import { nowSec } from './clock';
import type { FleetDto, FleetFixtureFile, LiveDto, LiveFixtureFile } from './types';

const TIME_KEYS = new Set([
  'updatedAt',
  'createdAt',
  'observedAt',
  'agentObservedAt',
  'renewsAt',
  'expiredAt',
  'lastSeenAt',
  'fetchedAt',
  'agentsReceivedAt',
  'qualityReceivedAt',
  'trafficCycleStart',
  'trafficCycleEnd',
  'exitDelayAtMs',
  'tcpDelayAtMs',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shiftValue(key: string, value: unknown, shiftSec: number): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  if (key.endsWith('AtMs') || key === 'exitDelayAtMs' || key === 'tcpDelayAtMs') {
    return value + shiftSec * 1000;
  }
  if (TIME_KEYS.has(key) || key.endsWith('At')) return value + shiftSec;
  return value;
}

function shiftUnknown(value: unknown, shiftSec: number, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => shiftUnknown(item, shiftSec));
  if (!isRecord(value)) return shiftValue(key, value, shiftSec);
  const out: Record<string, unknown> = {};
  for (const [next, nested] of Object.entries(value)) {
    out[next] = shiftUnknown(nested, shiftSec, next);
  }
  return out;
}

export function materializeFleet(raw: FleetFixtureFile): FleetDto {
  const shiftSec = nowSec() - raw.clock;
  const shifted = shiftUnknown({ nodes: raw.nodes, sources: raw.sources }, shiftSec) as FleetDto;
  return shifted;
}

export function materializeLive(raw: LiveFixtureFile): LiveDto {
  const shiftSec = nowSec() - raw.clock;
  return shiftUnknown(raw.live, shiftSec) as LiveDto;
}
