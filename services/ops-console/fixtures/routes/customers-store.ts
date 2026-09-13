import type { IncomingMessage, ServerResponse } from 'node:http';
import { nowSec } from '../../src/lib/clock';
import { createPublishStore, type FixtureHomeExit } from './settings-publish';

/**
 * The store behind the 客户 fixture routes, and the shapes it hands back.
 *
 * Split from the routes themselves because it is the half that has to stay
 * honest: every shape here is read off the Worker — `legacy-handlers/users.ts`,
 * `shared-admin/home-exits.ts`, `shared-admin/device-actions.ts`,
 * `shared-admin/product-accounts.ts`, `shared-admin/diagnostics-logs.ts` — and
 * a field that drifts from one of those is a page that passes its tests
 * against a hub that does not exist.
 *
 * Two deliberate simplifications, both stated rather than hidden:
 *
 *  - The home inventory is seeded from the same list `设置 · 家宽库存` serves,
 *    so a line picked here has the name it has there, but the two stores are
 *    separate copies: a line registered in 设置 during the same session is not
 *    bindable here.
 *  - The hub can only finish an onboarding once the customer has logged in
 *    from the client. The first call for an unknown address answers 202 with
 *    `user_not_registered`, exactly as the hub does; the second call pretends
 *    the login happened in between, which is what makes the two-step drawer
 *    testable without a client.
 */

export type CustomerFile = {
  clock: number;
  list: { items: Array<Record<string, unknown>> };
  details: Record<string, unknown>;
};

export type Binding = {
  userId: string;
  homeExitId: string;
  defaultProxyName: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Action = {
  id: string;
  userId: string;
  deviceId: string;
  action: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  completedAt: number | null;
};

export type Account = {
  id: string;
  userId: string | null;
  accountRef: string;
  status: string;
  openedAt: number | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Event = { id: string; userId: string | null; type: string; at: number; detail: string | null };

export type Report = {
  referenceCode: string;
  receivedAt: number;
  clientVersion: string;
  osVersion: string;
};

export type Store = {
  homeExits: FixtureHomeExit[];
  bindings: Binding[];
  actions: Action[];
  logs: Map<string, number>;
  accounts: Account[];
  events: Event[];
  replaced: Map<string, number>;
  reports: Map<string, Report[]>;
  proofs: Map<string, unknown>;
  /** Addresses the hub has allow-listed but not yet seen a login for. */
  waiting: Set<string>;
};

const HOUR = 3_600;
const DAY = 86_400;

let counter = 0;

export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_fixture${String(counter).padStart(8, '0')}`;
}

export function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export function refuse(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, { error: { code, message } }, status);
}

export function sendEmpty(res: ServerResponse, status: number): void {
  res.statusCode = status;
  res.setHeader('cache-control', 'no-store');
  res.end();
}

export function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    let raw = '';
    req.on('data', (chunk) => { raw += String(chunk); });
    req.on('end', () => {
      try {
        done(JSON.parse(raw || '{}') as Record<string, unknown>);
      } catch {
        done({});
      }
    });
  });
}

/**
 * The customer list is re-stamped from its own frozen clock on every read, so
 * anything written into it has to travel the other way first — otherwise a
 * date the operator just set comes back shifted by the age of the fixture.
 */
export function toFileTime(seconds: number, clock: number): number {
  return seconds - (nowSec() - clock);
}

export function seedStore(empty: boolean): Store {
  const at = nowSec();
  const homeExits = createPublishStore(empty).homeExits;
  if (empty) {
    return {
      homeExits,
      bindings: [],
      actions: [],
      logs: new Map(),
      accounts: [],
      events: [],
      replaced: new Map(),
      reports: new Map(),
      proofs: new Map(),
      waiting: new Set(),
    };
  }
  const account: Account = {
    id: 'acct_fixture_01',
    userId: 'u-04',
    accountRef: 'claude-4471@example.test',
    status: 'assigned',
    openedAt: at - 96 * DAY,
    notes: null,
    createdAt: at - 96 * DAY,
    updatedAt: at - 12 * DAY,
  };
  return {
    homeExits,
    bindings: [{
      userId: 'u-04',
      homeExitId: 'home_fixture_01',
      defaultProxyName: null,
      createdAt: at - 40 * DAY,
      updatedAt: at - 12 * DAY,
    }],
    actions: [],
    logs: new Map(),
    accounts: [
      account,
      {
        id: 'acct_fixture_02',
        userId: null,
        accountRef: 'claude-5108@example.test',
        status: 'pooled',
        openedAt: null,
        notes: null,
        createdAt: at - 20 * DAY,
        updatedAt: at - 20 * DAY,
      },
      {
        id: 'acct_fixture_03',
        userId: null,
        accountRef: 'claude-5109@example.test',
        status: 'pooled',
        openedAt: null,
        notes: null,
        createdAt: at - 19 * DAY,
        updatedAt: at - 19 * DAY,
      },
    ],
    events: [
      { id: 'ev_fixture_01', userId: 'u-04', type: 'opened', at: at - 96 * DAY, detail: null },
      { id: 'ev_fixture_02', userId: 'u-04', type: 'note', at: at - 12 * DAY, detail: '客户报告限速，已核对号况' },
    ],
    replaced: new Map([['u-04', 1]]),
    reports: new Map([['u-04', [
      { referenceCode: 'DR-4471-0912', receivedAt: at - 5 * HOUR, clientVersion: '1.9.2', osVersion: 'macOS 15.6' },
      { referenceCode: 'DR-4471-0904', receivedAt: at - 6 * DAY, clientVersion: '1.9.0', osVersion: 'macOS 15.5' },
    ]]]),
    proofs: new Map([['u-04', {
      source: 'device_action',
      status: 'done',
      createdAt: at - 5 * HOUR,
      completedAt: at - 5 * HOUR + 40,
      evidence: {
        verdict: 'confirmed',
        observedSince: at - 6 * HOUR,
        residentialReported: true,
        routes: { observed: 214, residential: 198, proxied: 16, direct: 0, blocked: 0, unknown: 0 },
        connected: true,
        killSwitchArmed: true,
        tunPresent: true,
        protectedDNSConfigured: true,
        exitIdentityConsistency: 'MATCHED',
        physicalBypassProbe: 'BLOCKED',
        unsafeProtectionObservationCount: 0,
        protectedDirectConnectionCount: 0,
      },
    }]]),
    waiting: new Set(),
  };
}

/** The two shapes `parseHomeLine` accepts that an operator actually pastes. */
export function parseLine(raw: string): { host: string; port: number; username: string } | null {
  const line = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  if (line === '') return null;
  let host = '';
  let port = 0;
  let username = '';
  if (line.includes('@')) {
    const at = line.lastIndexOf('@');
    const auth = line.slice(0, at);
    const hostport = line.slice(at + 1);
    const colon = auth.indexOf(':');
    const mark = hostport.lastIndexOf(':');
    if (colon < 1 || mark < 1) return null;
    username = auth.slice(0, colon);
    host = hostport.slice(0, mark);
    port = Number(hostport.slice(mark + 1));
  } else {
    const parts = line.split(':');
    if (parts.length < 4) return null;
    host = parts[0];
    port = Number(parts[1]);
    username = parts[2];
    if (!parts[3]) return null;
  }
  if (!host || !username) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { host, port, username };
}

export function publicExit(row: FixtureHomeExit) {
  const { socks5Username: _hidden, ...rest } = row;
  return rest;
}

export function publicBinding(store: Store, binding: Binding, email: string | null) {
  const exit = store.homeExits.find((row) => row.id === binding.homeExitId);
  return {
    userId: binding.userId,
    ...(email === null ? {} : { email }),
    homeExitId: binding.homeExitId,
    proxyName: exit?.proxyName ?? 'home-unknown',
    displayName: exit?.displayName ?? 'home-unknown',
    kind: exit?.kind ?? 'socks5',
    ...(exit?.egressIpv4 === undefined ? {} : { egressIpv4: exit.egressIpv4 }),
    ...(exit?.socks5Host === undefined ? {} : { socks5Host: exit.socks5Host }),
    ...(exit?.socks5Port === undefined ? {} : { socks5Port: exit.socks5Port }),
    ...(binding.defaultProxyName === null ? {} : { defaultProxyName: binding.defaultProxyName }),
    homeStatus: exit?.status ?? 'active',
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

export function publicAccount(row: Account) {
  return {
    id: row.id,
    userId: row.userId,
    product: 'claude_20x',
    accountRef: row.accountRef,
    status: row.status,
    openedAt: row.openedAt,
    closedAt: null,
    closeReason: null,
    ...(row.notes === null ? {} : { notes: row.notes }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function publicAction(row: Action) {
  return {
    id: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    action: row.action,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    deliveredAt: null,
    completedAt: row.completedAt,
    result: null,
  };
}

/** A row of the customer list, in the summary shape the contract checks. */
export function newCustomerRow(userId: string, email: string, clock: number): Record<string, unknown> {
  return {
    userId,
    email,
    wechatId: null,
    verdict: 'unreported',
    health: '未上报',
    tone: 'unk',
    reason: '刚开通，还没有上报过',
    lifecycle: 'active',
    deviceCount: 0,
    platforms: [],
    selectedServer: null,
    connected: { value: false, asOfSec: null, source: 'telemetry' },
    lastFailure: null,
    usageBytes: { value: 0, asOfSec: null, source: 'telemetry' },
    quotaBytes: null,
    services: [],
    minAppVersion: null,
    expiresAt: null,
    lastSeenAt: null,
    updatedAt: clock,
  };
}

export function newCustomerDetail(row: Record<string, unknown>, clock: number): Record<string, unknown> {
  return {
    detail: {
      userId: row.userId,
      email: row.email,
      wechatId: row.wechatId ?? null,
      contact: null,
      notes: null,
      verdict: row.verdict,
      health: row.health,
      tone: row.tone,
      reason: row.reason,
      lifecycle: row.lifecycle,
      now: {
        connected: { value: false, asOfSec: null, source: 'telemetry' },
        node: null,
        connectedSince: null,
        deviceId: null,
        platform: null,
        appVersion: null,
        osVersion: null,
        carrier: null,
        asn: null,
        region: null,
      },
      devices: [],
      chores: [],
      billing: {
        plan: null,
        deviceLimit: 5,
        quotaBytes: null,
        usageBytes: { value: 0, asOfSec: null, source: 'telemetry' },
        expiresAt: null,
        firstEntitledAt: clock,
        createdAt: clock,
      },
      updatedAt: clock,
    },
    connections: { items: [], nextCursor: null, total: 0, updatedAt: clock },
    activity: { items: [], nextCursor: null, total: 0, updatedAt: clock },
    destinations: { items: [], nextCursor: null, total: 0, updatedAt: clock },
    services: { items: [], nextCursor: null, total: 0, updatedAt: clock },
  };
}

export function bind(
  store: Store,
  userId: string,
  homeExitId: string,
  defaultProxyName: string | null,
  at: number,
): Binding {
  const existing = store.bindings.find((entry) => entry.userId === userId);
  if (existing) {
    existing.homeExitId = homeExitId;
    existing.defaultProxyName = defaultProxyName ?? existing.defaultProxyName;
    existing.updatedAt = at;
    return existing;
  }
  const made: Binding = { userId, homeExitId, defaultProxyName, createdAt: at, updatedAt: at };
  store.bindings.push(made);
  return made;
}

/** Register the pasted line if it is new, then bind it. */
export function bindLine(
  store: Store,
  userId: string,
  parsed: { host: string; port: number; username: string },
  at: number,
): Binding {
  let exit = store.homeExits.find((row) => row.socks5Host === parsed.host
    && row.socks5Port === parsed.port
    && row.socks5Username === parsed.username);
  if (!exit) {
    exit = {
      id: newId('home'),
      proxyName: `home-socks5-${newId('p').slice(-8)}`,
      displayName: `家宽 · ${parsed.host}`,
      kind: 'socks5',
      socks5Host: parsed.host,
      socks5Port: parsed.port,
      socks5Username: parsed.username,
      status: 'active',
      bindCount: 0,
      createdAt: at,
      updatedAt: at,
    };
    store.homeExits.push(exit);
  }
  return bind(store, userId, exit.id, null, at);
}
