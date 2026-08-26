export type OpsSourceTruth = {
  status: 'loading' | 'current' | 'stale' | 'unavailable';
  hasSnapshot: boolean;
  error: string | null;
  asOf: number | null;
};

// Agent inventory normally arrives every minute; fifteen missed uploads is a
// source outage, not a quiet fleet. Full quality scans run every twelve hours,
// so two missed scans is the corresponding honest boundary there.
export const AGENT_SNAPSHOT_STALE_SECONDS = 15 * 60;
export const QUALITY_SNAPSHOT_STALE_SECONDS = 24 * 60 * 60;

type InnerTruthOptions = {
  /** Unix seconds when the Worker accepted this inner snapshot. */
  asOfSec?: number | null;
  staleAfterSeconds?: number;
  nowSec?: number;
};

type TruthResource = {
  state: 'loading' | 'error' | 'ready';
  message?: string;
  refreshedAt: number;
  stale: string | null;
};

export function resourceTruth(resource: TruthResource): OpsSourceTruth {
  if (resource.state === 'loading') {
    return { status: 'loading', hasSnapshot: false, error: null, asOf: null };
  }
  if (resource.state === 'error') {
    return { status: 'unavailable', hasSnapshot: false, error: resource.message ?? '数据加载失败', asOf: resource.refreshedAt || null };
  }
  if (resource.stale) {
    return { status: 'stale', hasSnapshot: true, error: resource.stale, asOf: resource.refreshedAt || null };
  }
  return { status: 'current', hasSnapshot: true, error: null, asOf: resource.refreshedAt || null };
}

/** Envelope can be ready while an inner source is missing. */
export function innerTruth(
  envelope: TruthResource,
  innerPresent: boolean,
  innerError: string | null | undefined,
  options: InnerTruthOptions = {},
): OpsSourceTruth {
  const sourceAsOfSec = options.asOfSec != null &&
    Number.isFinite(options.asOfSec) && options.asOfSec > 0
    ? options.asOfSec
    : null;
  const sourceAsOf = sourceAsOfSec === null ? null : sourceAsOfSec * 1_000;
  const asOf = (sourceAsOf ?? envelope.refreshedAt) || null;
  if (envelope.state === 'loading') {
    return { status: 'loading', hasSnapshot: false, error: null, asOf: null };
  }
  if (envelope.state === 'error') {
    return { status: 'unavailable', hasSnapshot: false, error: envelope.message ?? '数据加载失败', asOf: envelope.refreshedAt || null };
  }
  if (innerError && !innerPresent) {
    return { status: 'unavailable', hasSnapshot: false, error: innerError, asOf };
  }
  if (envelope.stale) {
    return { status: 'stale', hasSnapshot: innerPresent, error: envelope.stale, asOf };
  }
  if (innerPresent && options.staleAfterSeconds) {
    if (sourceAsOfSec === null) {
      return { status: 'stale', hasSnapshot: true, error: '采集快照时间未知', asOf: null };
    }
    const nowSec = options.nowSec ?? Math.floor(Date.now() / 1_000);
    if (nowSec - sourceAsOfSec > options.staleAfterSeconds) {
      return { status: 'stale', hasSnapshot: true, error: '采集快照已过期', asOf: sourceAsOf };
    }
  }
  return { status: 'current', hasSnapshot: innerPresent, error: innerError ?? null, asOf };
}

export function canDeclareHealthy(sources: OpsSourceTruth[]): boolean {
  return sources.every((source) => source.status === 'current');
}
