import {
  nothing,
  readAccountDetail,
  readAccounts,
  readActions,
  readAssign,
  readLogWindow,
  readMaybeBinding,
  readOnboard,
  readOneAccount,
  readQueued,
  type CustomerAccountDetail,
  type DeviceAction,
  type UserHomeBinding,
} from './customers-legacy';
import { copy } from '@/copy/copy';
import { isAbortError, SessionExpiredError } from './api';

/**
 * Everything the 客户 pages write, in one list.
 *
 * It sits beside `api.ts` because none of it is in the typed contract and
 * because the verbs here are not interchangeable: onboarding is idempotent and
 * can come back half-done, `close` is a one-way tear-down, and the device
 * queue only ever schedules work the client will pick up later. Spelling each
 * one out — rather than exposing a generic `patch(user, body)` — is what stops
 * a caller from suspending an account while believing they set an expiry date.
 *
 * Nothing here echoes a secret. The pasted home line and the Claude account
 * reference travel up and are never read back: no endpoint returns them, and
 * no page here keeps a copy once its form is closed.
 *
 * The requests are sent from here rather than through `api.ts` for two
 * reasons that file cannot serve. Two of these are PUT, which nothing else in
 * the console sends. And a refusal has to keep its status and its code: a 409
 * on re-enabling an account means "tailnet revocation is still running",
 * which is a sentence an operator can act on, and the generic failure line is
 * not.
 */

/** A refusal from the hub, with the two facts a page has to branch on. */
export class WriteRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'WriteRefusal';
  }
}

export function refusalCode(error: unknown): string | null {
  return error instanceof WriteRefusal ? error.code : null;
}

/** Same builder as `api.ts`, including the fixture query passthrough. */
function urlFor(path: string, query?: Record<string, string>): string {
  const params = new URLSearchParams(query);
  if (import.meta.env.MODE === 'fixtures') {
    const asked = new URLSearchParams(window.location.search);
    for (const key of ['fixtures', 'session']) {
      const value = asked.get(key);
      if (value) params.set(key, value);
    }
  }
  const search = params.toString();
  return `/api/v1/ops/${path}${search ? `?${search}` : ''}`;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

async function refusalFrom(response: Response, fallback: string): Promise<WriteRefusal> {
  let code = '';
  let message = fallback;
  try {
    const envelope = await response.json() as ErrorEnvelope;
    code = envelope.error?.code ?? '';
    message = envelope.error?.message || fallback;
  } catch {
    // A non-JSON body leaves the generic sentence in place.
  }
  return new WriteRefusal(response.status, code, message);
}

const TIMEOUT_MS = 20_000;

function requestSignal(external: AbortSignal | undefined): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return external;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  if (!external) return timeout;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([external, timeout]) : external;
}

export async function send<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  read: (value: unknown) => T,
  options?: { signal?: AbortSignal; query?: Record<string, string> },
): Promise<T> {
  const fallback = method === 'GET' ? copy.loadError : copy.actionFailed;
  let response: Response;
  try {
    response = await fetch(urlFor(path, options?.query), {
      method,
      credentials: 'same-origin',
      signal: requestSignal(options?.signal),
      headers: body === undefined
        ? { accept: 'application/json' }
        : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(fallback);
  }
  if (response.status === 401 || response.status === 403) throw new SessionExpiredError();
  if (!response.ok) throw await refusalFrom(response, fallback);
  if (response.status === 204) return read(null);
  const contentType = response.headers.get('content-type');
  if (!contentType?.toLowerCase().includes('application/json')) throw new SessionExpiredError();
  return read(await response.json() as unknown);
}

const path = (...parts: string[]) => parts.map(encodeURIComponent).join('/');

/**
 * The only plan the hub will store. Anything else is a 400, and an empty
 * string clears the field — there is one product, and the column exists to
 * say whether this customer is on it.
 */
export const CLAUDE_PLAN = 'claude_20x';

/** What `POST users/onboard` accepts. Keys the hub rejects are absent. */
export type OnboardInput = {
  email: string;
  line?: string;
  homeExitId?: string;
  accountRef?: string;
  productAccountId?: string;
  notes?: string;
  contact?: string;
};

/**
 * What `PATCH users/{id}` accepts.
 *
 * `status` is the hub's word, not the console's: it knows `active` and
 * `disabled`, while the customer row's lifecycle also has 已到期, which is an
 * expiry date passing rather than a status anyone set.
 *
 * `expiresAt: null` clears the date; leaving the key out changes nothing.
 * `resetUsage` may only ever be `true` — the hub refuses anything else,
 * because "reset the cycle" is an event and not a number to edit.
 */
export type UserPatch = {
  status?: 'active' | 'disabled';
  expiresAt?: number | null;
  notes?: string | null;
  contact?: string | null;
  plan?: string | null;
  resetUsage?: true;
};

export const customerApi = {
  onboard: (input: OnboardInput) =>
    send('POST', 'users/onboard', input, readOnboard),

  patchUser: (userId: string, patch: UserPatch) =>
    send('PATCH', path('users', userId), patch, nothing),

  /** `reason` is kept on the audit line; the hub does the rest of the tear-down. */
  closeUser: (userId: string, reason: string) =>
    send('POST', `${path('users', userId)}/close`, { reason }, nothing),

  accountDetail: (userId: string, signal?: AbortSignal): Promise<CustomerAccountDetail> =>
    send('GET', `${path('users', userId)}/detail`, undefined, readAccountDetail, { signal }),

  homeBinding: (userId: string, signal?: AbortSignal): Promise<UserHomeBinding | null> =>
    send('GET', `${path('users', userId)}/home-binding`, undefined, readMaybeBinding, { signal }),

  /** Bind a line that is already in the inventory. The hub refuses an inactive one. */
  bindHome: (userId: string, homeExitId: string, defaultProxyName: string | null) =>
    send(
      'PUT',
      `${path('users', userId)}/home-binding`,
      defaultProxyName === null ? { homeExitId } : { homeExitId, defaultProxyName },
      readMaybeBinding,
    ),

  /**
   * Register a pasted line and bind it in one call. `replace` has to be true
   * when the customer already has a binding, or the hub answers 409 rather
   * than silently swapping the line under them.
   */
  assignHomeLine: (input: {
    userId: string;
    line: string;
    defaultProxyName?: string;
    replace: boolean;
  }) => send('POST', 'home-exits/assign', input, readAssign),

  unbindHome: (userId: string) =>
    send('DELETE', `${path('users', userId)}/home-binding`, undefined, nothing),

  deviceActions: (deviceId: string, signal?: AbortSignal): Promise<DeviceAction[]> =>
    send('GET', 'device-actions', undefined, readActions, { signal, query: { deviceId } }),

  queueDeviceAction: (deviceId: string, action: string) =>
    send('POST', 'device-actions', { deviceId, action }, readQueued),

  revokeDevice: (deviceId: string) =>
    send('DELETE', path('devices', deviceId), undefined, nothing),

  logWindow: (userId: string, deviceId: string, signal?: AbortSignal) =>
    send(
      'GET',
      `${path('users', userId)}/devices/${encodeURIComponent(deviceId)}/diagnostics-logs`,
      undefined,
      readLogWindow,
      { signal },
    ),

  /** The hub refuses anything past 24 hours, so the caller computes the end. */
  openLogWindow: (userId: string, deviceId: string, expiresAt: number) =>
    send(
      'PUT',
      `${path('users', userId)}/devices/${encodeURIComponent(deviceId)}/diagnostics-logs`,
      { expiresAt },
      readLogWindow,
    ),

  closeLogWindow: (userId: string, deviceId: string) =>
    send(
      'DELETE',
      `${path('users', userId)}/devices/${encodeURIComponent(deviceId)}/diagnostics-logs`,
      undefined,
      readLogWindow,
    ),

  pooledAccounts: (signal?: AbortSignal) =>
    send('GET', 'product-accounts', undefined, readAccounts, { signal, query: { status: 'pooled' } }),

  openAccount: (userId: string, accountRef: string) =>
    send('POST', 'product-accounts', { userId, accountRef }, readOneAccount),

  replaceAccount: (accountId: string, accountRef: string) =>
    send('POST', `${path('product-accounts', accountId)}/replace`, { accountRef }, readOneAccount),

  banAccount: (accountId: string, detail: string) =>
    send('POST', `${path('product-accounts', accountId)}/ban`, { detail }, readOneAccount),
};
