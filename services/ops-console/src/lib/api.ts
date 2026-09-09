import type {
  ActivityHourDto,
  ConnectionEventDto,
  CustomerDetailDto,
  CustomerSummaryDto,
  DestinationRowDto,
  IncidentDetailDto,
  IncidentDto,
  ListDto,
  RangeKey,
  ServiceUsageDto,
} from '@contract';
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
 * dropped from the production bundle. It goes through `URLSearchParams`
 * rather than string concatenation because half these endpoints carry a
 * `range` of their own, and two `?` in one URL is a 404 nobody reads twice.
 */
function urlFor(path: string, query?: Record<string, string>): string {
  const params = new URLSearchParams(query);
  if (import.meta.env.MODE === 'fixtures') {
    const asked = new URLSearchParams(window.location.search);
    // `session` names an isolated copy of the mutable fixture store, so the
    // screenshot suite and the test that actually acknowledges an incident can
    // share one dev server without editing each other's data.
    for (const key of ['fixtures', 'session']) {
      const value = asked.get(key);
      if (value) params.set(key, value);
    }
  }
  const search = params.toString();
  return `/api/v1/ops/${path}${search ? `?${search}` : ''}`;
}

async function getJson<T>(
  path: string,
  signal?: AbortSignal,
  query?: Record<string, string>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(urlFor(path, query), {
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

/**
 * The write half. The console never patches its own copy of an incident after
 * one of these: the Worker owns the state machine (an ack on an already
 * resolved incident is a no-op there), so the page refetches and shows what
 * actually happened rather than what it hoped would.
 */
async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(urlFor(path), {
      method: 'POST',
      credentials: 'same-origin',
      signal: requestSignal(signal),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(copy.actionFailed);
  }
  if (response.status === 401 || response.status === 403) throw new SessionExpiredError();
  if (!response.ok) {
    let message: string = copy.actionFailed;
    try {
      const envelope = await response.json() as ErrorEnvelope;
      message = envelope.error?.message || message;
    } catch {
      // Keep the generic failure for non-JSON bodies.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

const SNOOZE_SECONDS = 4 * 60 * 60;

export const opsApi = {
  fleetNodes: (signal?: AbortSignal) => getJson<FleetDto>('fleet-nodes', signal),
  live: async (signal?: AbortSignal) => (await getJson<{ live: LiveDto }>('live', signal)).live,

  customers: (signal?: AbortSignal) => getJson<ListDto<CustomerSummaryDto>>('customers', signal),
  customer: (id: string, signal?: AbortSignal) =>
    getJson<CustomerDetailDto>(`customers/${encodeURIComponent(id)}`, signal),
  customerConnections: (id: string, signal?: AbortSignal) =>
    getJson<ListDto<ConnectionEventDto>>(`customers/${encodeURIComponent(id)}/connections`, signal),
  customerActivity: (id: string, range: RangeKey, signal?: AbortSignal) =>
    getJson<ListDto<ActivityHourDto>>(`customers/${encodeURIComponent(id)}/activity`, signal, { range }),
  customerDestinations: (id: string, range: RangeKey, signal?: AbortSignal) =>
    getJson<ListDto<DestinationRowDto>>(`customers/${encodeURIComponent(id)}/destinations`, signal, { range }),
  customerServices: (id: string, range: RangeKey, signal?: AbortSignal) =>
    getJson<ListDto<ServiceUsageDto>>(`customers/${encodeURIComponent(id)}/services`, signal, { range }),

  incidents: (signal?: AbortSignal) => getJson<ListDto<IncidentDto>>('incidents', signal),
  incident: (id: string, signal?: AbortSignal) =>
    getJson<IncidentDetailDto>(`incidents/${encodeURIComponent(id)}`, signal),
  ackIncident: (id: string) => postJson<IncidentDto>(`incidents/${encodeURIComponent(id)}/ack`, {}),
  snoozeIncident: (id: string) =>
    postJson<IncidentDto>(`incidents/${encodeURIComponent(id)}/snooze`, { seconds: SNOOZE_SECONDS }),
  resolveIncident: (id: string) => postJson<IncidentDto>(`incidents/${encodeURIComponent(id)}/resolve`, {}),
  noteIncident: (id: string, note: string) =>
    postJson<IncidentDto>(`incidents/${encodeURIComponent(id)}/notes`, { note }),
};
