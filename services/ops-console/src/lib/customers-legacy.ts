import { copy } from '@/copy/copy';

/**
 * The shapes of the customer write endpoints that are not in the typed
 * contract, and the guards that refuse anything else.
 *
 * Onboarding, expiry, suspension, the home binding, the Claude account pool,
 * the device action queue and the diagnostics-log window all predate
 * `contract.ts`. They answer bare objects rather than the list envelope, and
 * they are what the old `/ops/` customer drawer wrote to. Rather than widen
 * the contract for endpoints the new console is about to be the only caller
 * of, this file keeps one hand-written shape per response and a reader that
 * throws on anything unexpected — the same passthrough treatment
 * `settings-legacy.ts` gives the catalogue and the home inventory.
 *
 * How these are sent lives in `api-customer-actions.ts`; what comes back is
 * described here.
 */

/* --------------------------------------------------------------- guards */

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(copy.loadError);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error(copy.loadError);
  return value;
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(copy.loadError);
  return value;
}

function maybeText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function maybeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error(copy.loadError);
  return value;
}

export const nothing = () => null;

/* ---------------------------------------------------------------- 开通 */

/**
 * What `POST users/onboard` answers.
 *
 * `userId` is null while the address is only on the sign-up list: the hub
 * writes the allow-list entry first and can only issue an exit identity, a
 * home binding or a Claude account once the customer has actually logged in
 * from the client. `incomplete` is the hub's own list of what it could not do
 * yet, and the drawer repeats it rather than claiming a finished onboarding.
 */
export type OnboardOutcome = {
  email: string;
  userId: string | null;
  allowlisted: boolean;
  exitIdentityIssued: boolean;
  boundHome: boolean;
  hasAccount: boolean;
  incomplete: string[];
};

export function readOnboard(value: unknown): OnboardOutcome {
  const row = record(value);
  return {
    email: text(row.email),
    userId: maybeText(row.userId),
    allowlisted: row.allowlisted === true,
    exitIdentityIssued: row.exitIdentityIssued === true,
    boundHome: row.binding !== null && row.binding !== undefined,
    hasAccount: row.account !== null && row.account !== undefined,
    incomplete: Array.isArray(row.incomplete)
      ? row.incomplete.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

/* ---------------------------------------------------------------- 家宽 */

/** `GET/PUT users/{id}/home-binding`, and the binding half of an assign. */
export type UserHomeBinding = {
  userId: string;
  homeExitId: string;
  proxyName: string;
  displayName: string;
  kind: string | null;
  egressIpv4: string | null;
  socks5Host: string | null;
  socks5Port: number | null;
  defaultProxyName: string | null;
  homeStatus: string;
  createdAt: number;
  updatedAt: number;
};

function readBinding(value: unknown): UserHomeBinding {
  const row = record(value);
  return {
    userId: text(row.userId),
    homeExitId: text(row.homeExitId),
    proxyName: text(row.proxyName),
    displayName: text(row.displayName),
    kind: maybeText(row.kind),
    egressIpv4: maybeText(row.egressIpv4),
    socks5Host: maybeText(row.socks5Host),
    socks5Port: maybeCount(row.socks5Port),
    defaultProxyName: maybeText(row.defaultProxyName),
    homeStatus: typeof row.homeStatus === 'string' ? row.homeStatus : 'active',
    createdAt: count(row.createdAt),
    updatedAt: count(row.updatedAt),
  };
}

export function readMaybeBinding(value: unknown): UserHomeBinding | null {
  const row = record(value);
  return row.binding === null || row.binding === undefined ? null : readBinding(row.binding);
}

/** `POST home-exits/assign`: which line, and whether an old one was retired. */
export type AssignOutcome = { displayName: string; replaced: boolean; refreshQueued: boolean };

export function readAssign(value: unknown): AssignOutcome {
  const row = record(value);
  return {
    displayName: text(record(row.homeExit).displayName),
    replaced: row.replaced === true,
    refreshQueued: row.refreshQueued === true,
  };
}

/* ------------------------------------------------------------ 设备动作 */

export type DeviceAction = {
  id: string;
  deviceId: string;
  action: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  completedAt: number | null;
};

function readAction(value: unknown): DeviceAction {
  const row = record(value);
  return {
    id: text(row.id),
    deviceId: text(row.deviceId),
    action: text(row.action),
    status: text(row.status),
    createdAt: count(row.createdAt),
    expiresAt: count(row.expiresAt),
    completedAt: maybeCount(row.completedAt),
  };
}

export function readActions(value: unknown): DeviceAction[] {
  return list(record(value).actions).map(readAction);
}

export function readQueued(value: unknown): DeviceAction {
  return readAction(record(value).action);
}

/** `GET/PUT/DELETE users/{id}/devices/{id}/diagnostics-logs`. */
export type LogWindow = { enabled: boolean; expiresAt: number | null };

export function readLogWindow(value: unknown): LogWindow {
  const row = record(record(value).diagnosticsLogs);
  return { enabled: row.enabled === true, expiresAt: maybeCount(row.expiresAt) };
}

/* ------------------------------------------------------------ Claude 号 */

export type ProductAccount = {
  id: string;
  userId: string | null;
  accountRef: string;
  status: string;
  openedAt: number | null;
  notes: string | null;
  updatedAt: number;
};

function readAccount(value: unknown): ProductAccount {
  const row = record(value);
  return {
    id: text(row.id),
    userId: maybeText(row.userId),
    accountRef: text(row.accountRef),
    status: text(row.status),
    openedAt: maybeCount(row.openedAt),
    notes: maybeText(row.notes),
    updatedAt: count(row.updatedAt),
  };
}

export function readAccounts(value: unknown): ProductAccount[] {
  return list(record(value).accounts).map(readAccount);
}

export function readOneAccount(value: unknown): ProductAccount {
  return readAccount(record(value).account);
}

export type ProductEvent = { id: string; type: string; at: number; detail: string | null };

function readEvent(value: unknown): ProductEvent {
  const row = record(value);
  return {
    id: text(row.id),
    type: text(row.type),
    at: count(row.at),
    detail: maybeText(row.detail),
  };
}

/* ------------------------------------------------- users/{id}/detail */

export type RouteEvidence = {
  verdict: 'confirmed' | 'inconclusive' | 'unsafe';
  residentialReported: boolean;
  routes: {
    observed: number; residential: number; proxied: number;
    direct: number; blocked: number; unknown: number;
  };
  connected: boolean;
  killSwitchArmed: boolean;
  tunPresent: boolean;
  protectedDNSConfigured: boolean | null;
  exitIdentityConsistency: string;
  physicalBypassProbe: string;
  protectedDirectConnectionCount: number;
};

const VERDICTS = ['confirmed', 'inconclusive', 'unsafe'] as const;

function readEvidence(value: unknown): RouteEvidence | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  const routes = record(row.routes);
  const verdict = VERDICTS.find((word) => word === row.verdict) ?? 'inconclusive';
  const at = (key: string): number => maybeCount(routes[key]) ?? 0;
  return {
    verdict,
    residentialReported: row.residentialReported === true,
    routes: {
      observed: at('observed'),
      residential: at('residential'),
      proxied: at('proxied'),
      direct: at('direct'),
      blocked: at('blocked'),
      unknown: at('unknown'),
    },
    connected: row.connected === true,
    killSwitchArmed: row.killSwitchArmed === true,
    tunPresent: row.tunPresent === true,
    protectedDNSConfigured: typeof row.protectedDNSConfigured === 'boolean'
      ? row.protectedDNSConfigured
      : null,
    exitIdentityConsistency: typeof row.exitIdentityConsistency === 'string'
      ? row.exitIdentityConsistency
      : 'INCONCLUSIVE',
    physicalBypassProbe: typeof row.physicalBypassProbe === 'string'
      ? row.physicalBypassProbe
      : 'INCONCLUSIVE',
    protectedDirectConnectionCount: maybeCount(row.protectedDirectConnectionCount) ?? 0,
  };
}

export type RouteProof = {
  source: string;
  status: string;
  completedAt: number | null;
  evidence: RouteEvidence | null;
};

export type DiagnosticsReport = {
  referenceCode: string;
  receivedAt: number;
  clientVersion: string;
  osVersion: string;
};

/**
 * The read half of `GET users/{id}/detail`, minus everything the typed
 * `customers/{id}` already answers.
 *
 * The diagnostics report's own body is deliberately dropped on the way in:
 * the console shows what the report is and when it arrived, and the raw
 * document — which carries one customer's paths and processes — has no reader
 * on a 客户 page and no business in a browser tab left open on a desk.
 */
export type CustomerAccountDetail = {
  accounts: ProductAccount[];
  events: ProductEvent[];
  replaceCount: number;
  diagnostics: DiagnosticsReport[];
  proof: RouteProof | null;
};

export function readAccountDetail(value: unknown): CustomerAccountDetail {
  const row = record(value);
  const product = row.product === null || row.product === undefined ? {} : record(row.product);
  const proof = row.protectedRouteProof === null || row.protectedRouteProof === undefined
    ? null
    : record(row.protectedRouteProof);
  return {
    accounts: product.accounts === undefined ? [] : list(product.accounts).map(readAccount),
    events: product.events === undefined ? [] : list(product.events).map(readEvent),
    replaceCount: maybeCount(product.replaceCount) ?? 0,
    diagnostics: row.diagnostics === undefined ? [] : list(row.diagnostics).map((entry) => {
      const report = record(entry);
      return {
        referenceCode: text(report.referenceCode),
        receivedAt: count(report.receivedAt),
        clientVersion: text(report.clientVersion),
        osVersion: text(report.osVersion),
      };
    }),
    proof: proof === null ? null : {
      source: text(proof.source),
      status: text(proof.status),
      completedAt: maybeCount(proof.completedAt),
      evidence: readEvidence(proof.evidence),
    },
  };
}
