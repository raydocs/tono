import type {
  ActivityHourDto,
  AdoptionMatrixDto,
  ConnectionEventDto,
  CustomerDetailDto,
  CustomerSummaryDto,
  DestinationRowDto,
  FunnelDto,
  FunnelRowDto,
  IncidentDetailDto,
  IncidentDto,
  ListDto,
  NodeSummaryDto,
  RangeKey,
  ReleaseDto,
  ServiceUsageDto,
  SystemHealthDto,
  UpdateChannelDto,
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
 *
 * Exported because 账目's CSV export is a link the browser follows rather than
 * a body this file reads: the download needs the same URL, fixture query and
 * all, without going through `fetch`.
 */
export function urlFor(path: string, query?: Record<string, string>): string {
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

export async function getJson<T>(
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
 * A whole list, not its first page.
 *
 * The Worker answers fifty rows by default and two hundred at most, and the
 * console asked for one page: customer fifty-one was missing from ⌘K, from the
 * count sentence and from the chores, with nothing on screen to say a page had
 * been cut off. This follows `nextCursor` to the end.
 *
 * Two guards. `MAX_ITEMS` stops a fleet that has grown by two orders of
 * magnitude from hanging the shell, and a cursor that repeats itself ends the
 * walk rather than looping for ever — a paging bug on the far side should cost
 * the tail of a list, not the browser tab.
 */
const PAGE_LIMIT = 200;
const MAX_ITEMS = 2_000;

export async function getAllJson<T>(
  path: string,
  signal?: AbortSignal,
  query?: Record<string, string>,
): Promise<ListDto<T>> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let page: ListDto<T>;
  do {
    page = await getJson<ListDto<T>>(path, signal, {
      ...query,
      limit: String(PAGE_LIMIT),
      ...(cursor === null ? {} : { cursor }),
    });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor !== null && seen.has(cursor)) cursor = null;
    if (cursor !== null) seen.add(cursor);
  } while (cursor !== null && items.length < MAX_ITEMS && page.items.length > 0);
  // `total` travels with the envelope: an endpoint that counted cheaply said so,
  // and paging is not a reason to lose the count.
  return { ...page, items: items.slice(0, MAX_ITEMS), nextCursor: cursor };
}

/**
 * The write half. The console never patches its own copy of a row after one
 * of these: the Worker owns the state machine (an ack on an already resolved
 * incident is a no-op there, and so is publishing an already published
 * release), so the page refetches and shows what actually happened rather
 * than what it hoped would.
 */
async function writeJson<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(urlFor(path), {
      method,
      credentials: 'same-origin',
      signal: requestSignal(signal),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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
  // A delete that succeeded answers 204: there is nothing to parse, and
  // asking anyway turns a working write into "动作没做成".
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

export const postJson = <T>(path: string, body: unknown, signal?: AbortSignal) =>
  writeJson<T>('POST', path, body, signal);
export const patchJson = <T>(path: string, body: unknown, signal?: AbortSignal) =>
  writeJson<T>('PATCH', path, body, signal);
export const deleteJson = <T>(path: string, signal?: AbortSignal) =>
  writeJson<T>('DELETE', path, undefined, signal);

const SNOOZE_SECONDS = 4 * 60 * 60;

export const opsApi = {
  /**
   * The fleet as the engine judges it: one verdict, one word, one tone per
   * machine. 节点 reads this and nothing else for its list, because the old
   * `fleet-nodes` read made the console judge health a second time — and a
   * retired box the engine had stopped counting was still shown as 被墙 here
   * while 今天 said there was no incident.
   */
  nodes: (signal?: AbortSignal) => getAllJson<NodeSummaryDto>('nodes', signal),
  /** Which source is behind, and how far the backfill has left to go. */
  systemHealth: (signal?: AbortSignal) => getJson<SystemHealthDto>('system/health', signal),
  /** Kept for the facts no summary carries: address, system, ports, line tags. */
  fleetNodes: (signal?: AbortSignal) => getJson<FleetDto>('fleet-nodes', signal),
  live: async (signal?: AbortSignal) => (await getJson<{ live: LiveDto }>('live', signal)).live,

  customers: (signal?: AbortSignal) => getAllJson<CustomerSummaryDto>('customers', signal),
  /**
   * Everyone who has not connected yet, plus the five counts above them.
   *
   * Not a page of the customer list: half of these people have no `users` row,
   * so they cannot come back on an endpoint that answers customer rows. It is
   * one read for the whole shell — the 客户 table, 今天's chores and ⌘K all
   * hold the same list of who is still stuck.
   */
  funnel: (signal?: AbortSignal) => getJson<FunnelDto>('customers/funnel', signal),
  /**
   * The three operator-owned fields on somebody who has no account yet.
   *
   * It patches the sign-up list rather than a customer, because that row is
   * all there is: the address was allow-listed and nothing else about them
   * exists. The answer is the funnel row as it now stands.
   */
  patchInvite: (email: string, body: { wechatId?: string | null; contact?: string | null; notes?: string | null }) =>
    patchJson<FunnelRowDto>(`signup-allowlist/${encodeURIComponent(email)}`, body),
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

  incidents: (signal?: AbortSignal) => getAllJson<IncidentDto>('incidents', signal),
  incident: (id: string, signal?: AbortSignal) =>
    getJson<IncidentDetailDto>(`incidents/${encodeURIComponent(id)}`, signal),
  ackIncident: (id: string) => postJson<IncidentDto>(`incidents/${encodeURIComponent(id)}/ack`, {}),
  snoozeIncident: (id: string) =>
    postJson<IncidentDto>(`incidents/${encodeURIComponent(id)}/snooze`, { seconds: SNOOZE_SECONDS }),
  /**
   * Closing an incident and writing a line about it both moved to
   * `api-followups.ts`. A resolve now has to carry how it ended, and a note
   * now goes into 处理记录 where the next person will actually look for it, so
   * the two bodiless verbs that used to live here would only be a way to close
   * an incident without saying anything about it.
   */

  releases: (signal?: AbortSignal) => getAllJson<ReleaseDto>('releases', signal),
  releaseAdoption: (signal?: AbortSignal) => getJson<AdoptionMatrixDto>('releases/adoption', signal),
  releaseChannels: (signal?: AbortSignal) => getAllJson<UpdateChannelDto>('releases/channels', signal),
  /**
   * All three of the 客户端 page's actions are edits to a release that already
   * exists, so all three are the PATCH. `POST releases` creates a new row from
   * a build, which is the release pipeline's job and not something the console
   * has a form for; it is deliberately not wired up here.
   */
  publishRelease: (id: string) =>
    patchJson<ReleaseDto>(`releases/${encodeURIComponent(id)}`, { publish: true }),
  withdrawRelease: (id: string) =>
    patchJson<ReleaseDto>(`releases/${encodeURIComponent(id)}`, { withdraw: true }),
  setMinSupported: (id: string, version: string) =>
    patchJson<ReleaseDto>(`releases/${encodeURIComponent(id)}`, { minSupportedVersion: version }),
};
