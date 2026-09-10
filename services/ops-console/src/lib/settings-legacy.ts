import { copy } from '@/copy/copy';
import { isAbortError, SessionExpiredError } from './api';

/**
 * The five 设置 endpoints that are not in the typed contract.
 *
 * The node catalogue, the routing rules and the home-exit inventory predate
 * `contract.ts`; they answer bare objects rather than the list envelope, and
 * they are the endpoints the old console published from. Rather than widen the
 * contract for surfaces that are about to be the only caller, this file keeps a
 * small hand-written shape per response and a guard that refuses anything else
 * — the same passthrough treatment `types.ts` gives `fleet-nodes`.
 *
 * It carries its own request helpers for two reasons `api.ts` cannot serve.
 * First, both publishes are PUT, which nothing else in the console sends.
 * Second, and the one that matters: `api.ts` turns a failure into `Error(
 * message)` and drops the status and the code, and this page's whole safety
 * story is telling a 409 apart from a 400 — a lost conflict here is a fleet
 * that half of the clients see differently from the other half.
 */

/** A refusal from the hub, with the two facts the page has to branch on. */
export class HubRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'HubRefusal';
  }
}

/** Both publishes answer 409 when the document moved under the draft. */
export function isConflict(error: unknown): boolean {
  return error instanceof HubRefusal && error.status === 409;
}

export function refusalCode(error: unknown): string | null {
  return error instanceof HubRefusal ? error.code : null;
}

/**
 * Same shape as `api.ts`'s builder, including forwarding `?fixtures=` and
 * `?session=` in fixture mode so the screenshot suite and the write tests can
 * share one dev server. `MODE` is replaced at build time, so the branch is
 * dropped from the production bundle.
 */
function urlFor(path: string): string {
  const params = new URLSearchParams();
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

async function refusalFrom(response: Response, fallback: string): Promise<HubRefusal> {
  let code = '';
  let message = fallback;
  try {
    const envelope = await response.json() as ErrorEnvelope;
    code = envelope.error?.code ?? '';
    message = envelope.error?.message || fallback;
  } catch {
    // A non-JSON body leaves the generic sentence in place.
  }
  return new HubRefusal(response.status, code, message);
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
  signal?: AbortSignal,
): Promise<T> {
  const fallback = method === 'GET' ? copy.loadError : copy.actionFailed;
  let response: Response;
  try {
    response = await fetch(urlFor(path), {
      method,
      credentials: 'same-origin',
      signal: requestSignal(signal),
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

/* --------------------------------------------------------------- guards */

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(copy.loadError);
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error(copy.loadError);
  return value;
}

export function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(copy.loadError);
  return value;
}

function maybeText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function maybeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error(copy.loadError);
  return value;
}

/* ----------------------------------------------------------------- 目录 */

/** `GET exit-catalog`. `updatedAt` is absent until something is published. */
export type ExitCatalog = {
  revision: number;
  yaml: string;
  sha256: string;
  updatedAt: number | null;
};

function readCatalog(value: unknown): ExitCatalog {
  const row = record(value);
  return {
    revision: count(row.revision),
    yaml: text(row.yaml),
    sha256: text(row.sha256),
    updatedAt: maybeCount(row.updatedAt),
  };
}

/** `PUT exit-catalog`. The number that comes back is what customers now get. */
export type Published = { revision: number; sha256: string; updatedAt: number };

function readPublished(value: unknown): Published {
  const row = record(value);
  return {
    revision: count(row.revision),
    sha256: text(row.sha256),
    updatedAt: count(row.updatedAt),
  };
}

/** One line of `GET catalog-revisions`: a fingerprint and how many machines. */
export type CatalogHistoryRow = {
  revision: number;
  sha256: string;
  publishedAt: number;
  serverCount: number;
  logicalNodeCount: number;
  deploymentCount: number;
  current: boolean;
};

function readHistory(value: unknown): CatalogHistoryRow[] {
  return list(record(value).revisions).map((entry) => {
    const row = record(entry);
    return {
      revision: count(row.revision),
      sha256: text(row.sha256),
      publishedAt: count(row.publishedAt),
      serverCount: count(row.serverCount),
      logicalNodeCount: count(row.logicalNodeCount),
      deploymentCount: count(row.deploymentCount),
      current: row.current === true,
    };
  });
}

/* ------------------------------------------------------------- 分流规则 */

/** `GET traffic-policy`. `json` is the canonical text, not a re-serialisation. */
export type TrafficPolicyDoc = {
  revision: number;
  json: string;
  sha256: string;
  updatedAt: number | null;
  signature: string | null;
};

function readPolicy(value: unknown): TrafficPolicyDoc {
  const row = record(value);
  return {
    revision: count(row.revision),
    json: text(row.json),
    sha256: text(row.sha256),
    updatedAt: maybeCount(row.updatedAt),
    signature: maybeText(row.signature),
  };
}

/**
 * What `dryRun` hands back: the exact text a signature has to cover, and
 * whether this document needs one at all.
 */
export type PolicyRehearsal = {
  json: string;
  sha256: string;
  signatureRequired: boolean;
  signatureContext: string;
};

function readRehearsal(value: unknown): PolicyRehearsal {
  const row = record(value);
  return {
    json: text(row.json),
    sha256: text(row.sha256),
    signatureRequired: row.signatureRequired === true,
    signatureContext: text(row.signatureContext),
  };
}

/* ------------------------------------------------------------- 家宽库存 */

/**
 * One line of `GET home-exits`. There is no `socks5Password` here and never
 * will be: the hub does not echo credentials on any read, so a console that
 * held one could only have kept it from the form the operator typed it into.
 */
export type HomeExit = {
  id: string;
  proxyName: string;
  displayName: string;
  egressIpv4: string | null;
  kind: string;
  socks5Host: string | null;
  socks5Port: number | null;
  status: string;
  notes: string | null;
  bindCount: number | null;
  lastProbedAt: number | null;
  probeStatus: string | null;
  probeAlive: number | null;
  probeTotal: number | null;
  updatedAt: number;
};

function readExit(value: unknown): HomeExit {
  const row = record(value);
  return {
    id: text(row.id),
    proxyName: text(row.proxyName),
    displayName: text(row.displayName),
    egressIpv4: maybeText(row.egressIpv4),
    kind: typeof row.kind === 'string' ? row.kind : 'catalog',
    socks5Host: maybeText(row.socks5Host),
    socks5Port: maybeCount(row.socks5Port),
    status: text(row.status),
    notes: maybeText(row.notes),
    bindCount: maybeCount(row.bindCount),
    lastProbedAt: maybeCount(row.lastProbedAt),
    probeStatus: maybeText(row.probeStatus),
    probeAlive: maybeCount(row.probeAlive),
    probeTotal: maybeCount(row.probeTotal),
    updatedAt: count(row.updatedAt),
  };
}

function readExits(value: unknown): HomeExit[] {
  return list(record(value).homeExits).map(readExit);
}

/** `GET home-bindings`, reduced to the one thing the inventory table asks. */
export type HomeBinding = { userId: string; email: string | null; homeExitId: string };

function readBindings(value: unknown): HomeBinding[] {
  return list(record(value).bindings).map((entry) => {
    const row = record(entry);
    return {
      userId: text(row.userId),
      email: maybeText(row.email),
      homeExitId: text(row.homeExitId),
    };
  });
}

/** What `POST home-exits` accepts. Keys the hub rejects are absent on purpose. */
export type HomeExitInput = {
  proxyName: string;
  displayName: string;
  kind: 'catalog' | 'socks5';
  egressIpv4?: string;
  notes?: string;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
};

/** `POST home-exits/import`: what landed, what was already there, what failed. */
export type ImportOutcome = {
  created: HomeExit[];
  skipped: Array<{ host: string | null; port: number | null; message: string }>;
  failed: Array<{ message: string }>;
};

function readImport(value: unknown): ImportOutcome {
  const row = record(value);
  return {
    created: list(row.created).map(readExit),
    skipped: list(row.skipped).map((entry) => {
      const skip = record(entry);
      return {
        host: maybeText(skip.host),
        port: maybeCount(skip.port),
        message: typeof skip.message === 'string' ? skip.message : '',
      };
    }),
    failed: list(row.failed).map((entry) => {
      const fail = record(entry);
      return { message: typeof fail.message === 'string' ? fail.message : '' };
    }),
  };
}

const nothing = () => null;

export const hubApi = {
  exitCatalog: (signal?: AbortSignal) =>
    send('GET', 'exit-catalog', undefined, readCatalog, signal),
  publishCatalog: (yaml: string, expectedRevision: number) =>
    send('PUT', 'exit-catalog', { yaml, expectedRevision }, readPublished),
  catalogHistory: (signal?: AbortSignal) =>
    send('GET', 'catalog-revisions', undefined, readHistory, signal),

  trafficPolicy: (signal?: AbortSignal) =>
    send('GET', 'traffic-policy', undefined, readPolicy, signal),
  rehearsePolicy: (policy: unknown) =>
    send('PUT', 'traffic-policy', { policy, dryRun: true }, readRehearsal),
  publishPolicy: (policy: unknown, expectedRevision: number, signature: string | null) =>
    send(
      'PUT',
      'traffic-policy',
      signature === null
        ? { policy, expectedRevision }
        : { policy, expectedRevision, signature },
      readPolicy,
    ),

  homeExits: (signal?: AbortSignal) =>
    send('GET', 'home-exits', undefined, readExits, signal),
  homeBindings: (signal?: AbortSignal) =>
    send('GET', 'home-bindings', undefined, readBindings, signal),
  createHomeExit: (input: HomeExitInput) =>
    send('POST', 'home-exits', input, (value) => readExit(record(value).homeExit)),
  importHomeExits: (lines: string[]) =>
    send('POST', 'home-exits/import', { lines }, readImport),
  setHomeExitStatus: (id: string, status: 'active' | 'disabled') =>
    send(
      'PATCH',
      `home-exits/${encodeURIComponent(id)}`,
      { status },
      (value) => readExit(record(value).homeExit),
    ),
  deleteHomeExit: (id: string) =>
    send('DELETE', `home-exits/${encodeURIComponent(id)}`, undefined, nothing),
};
