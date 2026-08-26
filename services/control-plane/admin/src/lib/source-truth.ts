import type { Live } from '../hooks';

export type OpsSourceTruth = {
  status: 'loading' | 'current' | 'stale' | 'unavailable';
  hasSnapshot: boolean;
  error: string | null;
  asOf: number | null;
};

export function resourceTruth(resource: Live<unknown>): OpsSourceTruth {
  if (resource.state === 'loading') {
    return { status: 'loading', hasSnapshot: false, error: null, asOf: null };
  }
  if (resource.state === 'error') {
    return { status: 'unavailable', hasSnapshot: false, error: resource.message, asOf: resource.refreshedAt || null };
  }
  if (resource.stale) {
    return { status: 'stale', hasSnapshot: true, error: resource.stale, asOf: resource.refreshedAt || null };
  }
  return { status: 'current', hasSnapshot: true, error: null, asOf: resource.refreshedAt || null };
}

/** Envelope can be ready while an inner source is missing. */
export function innerTruth(
  envelope: Live<unknown>,
  innerPresent: boolean,
  innerError: string | null | undefined,
): OpsSourceTruth {
  if (envelope.state === 'loading') {
    return { status: 'loading', hasSnapshot: false, error: null, asOf: null };
  }
  if (envelope.state === 'error') {
    return { status: 'unavailable', hasSnapshot: false, error: envelope.message, asOf: envelope.refreshedAt || null };
  }
  if (innerError && !innerPresent) {
    return { status: 'unavailable', hasSnapshot: false, error: innerError, asOf: envelope.refreshedAt || null };
  }
  if (envelope.stale) {
    return { status: 'stale', hasSnapshot: innerPresent, error: envelope.stale, asOf: envelope.refreshedAt || null };
  }
  return { status: 'current', hasSnapshot: innerPresent, error: innerError ?? null, asOf: envelope.refreshedAt || null };
}

export function canDeclareHealthy(sources: OpsSourceTruth[]): boolean {
  return sources.every((source) => source.status === 'current');
}
