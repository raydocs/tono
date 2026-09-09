import { copy } from '@/copy/copy';
import type { FleetDto, LiveDto } from './types';

export class SessionExpiredError extends Error {
  constructor() {
    super(copy.sessionExpired);
    this.name = 'SessionExpiredError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

const REQUEST_TIMEOUT_MS = 15_000;

function requestSignal(external: AbortSignal | undefined): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return external;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!external) return timeout;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([external, timeout]) : external;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

/**
 * The fixture dev server picks its data set from `?fixtures=`; forwarding it
 * lets one server serve the ready, empty, dense and failing cases to the
 * screenshot suite. `MODE` is replaced at build time, so this whole branch is
 * dropped from the production bundle.
 */
function fixtureQuery(): string {
  if (import.meta.env.MODE !== 'fixtures') return '';
  const set = new URLSearchParams(window.location.search).get('fixtures');
  return set ? `?fixtures=${encodeURIComponent(set)}` : '';
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/ops/${path}${fixtureQuery()}`, {
      credentials: 'same-origin',
      signal: requestSignal(signal),
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(copy.loadError);
    }
    throw error;
  }
  if (response.status === 401 || response.status === 403) throw new SessionExpiredError();
  const contentType = response.headers.get('content-type');
  if (!contentType?.toLowerCase().includes('application/json')) {
    throw new SessionExpiredError();
  }
  if (!response.ok) {
    let message: string = copy.loadError;
    try {
      const envelope = await response.json() as ErrorEnvelope;
      message = envelope.error?.message || message;
    } catch {
      // Keep the generic load error for non-JSON bodies.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const opsApi = {
  fleetNodes: (signal?: AbortSignal) => getJson<FleetDto>('fleet-nodes', signal),
  live: async (signal?: AbortSignal) => (await getJson<{ live: LiveDto }>('live', signal)).live,
};
