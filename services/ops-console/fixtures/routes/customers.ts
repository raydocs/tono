import type { IncomingMessage, ServerResponse } from 'node:http';
import { nowSec } from '../../src/lib/clock';
import {
  bind,
  bindLine,
  newCustomerDetail,
  newCustomerRow,
  newId,
  parseLine,
  publicAccount,
  publicAction,
  publicBinding,
  publicExit,
  readBody,
  refuse,
  seedStore,
  sendEmpty,
  sendJson,
  toFileTime,
  type Account,
  type Action,
  type CustomerFile,
  type Store,
} from './customers-store';

/**
 * The 客户 write endpoints, served by the fixture dev server.
 *
 * None of these are in the typed contract, and the store behind them is
 * mutable per `?session=` for the same reason the incident store is: an
 * onboarding the customer list does not then show, or an expiry the header
 * does not repeat, proves nothing. What each response looks like — and the two
 * places this store is deliberately simpler than the hub — is in
 * `customers-store.ts`.
 */

const DAY = 86_400;
const ACTION_TTL = 300;

type Context = {
  req: IncomingMessage;
  res: ServerResponse;
  parts: string[];
  query: URLSearchParams;
  store: Store;
  file: CustomerFile | null;
};

/** The customer row and its detail entry, so a write can move both at once. */
function rowsFor(file: CustomerFile | null, userId: string) {
  const row = file?.list.items.find((item) => item.userId === userId) ?? null;
  const entry = file?.details[userId] as { detail: Record<string, unknown> } | undefined;
  return { row, detail: entry?.detail ?? null };
}

function devicesOf(file: CustomerFile | null, userId: string): Array<Record<string, unknown>> {
  const { detail } = rowsFor(file, userId);
  const devices = detail?.devices;
  return Array.isArray(devices) ? devices as Array<Record<string, unknown>> : [];
}

function onboard({ req, res, store, file }: Context): boolean {
  if (req.method !== 'POST') return false;
  void readBody(req).then((body) => {
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email.includes('@')) {
      refuse(res, 400, 'VALIDATION_ERROR', 'Invalid email');
      return;
    }
    const clock = file?.clock ?? nowSec();
    let existing = file?.list.items.find((item) => String(item.email).toLowerCase() === email) ?? null;
    // The hub's own two steps: the address is allow-listed first, and only a
    // customer who has since logged in can be given an identity or a line.
    if (!existing && !store.waiting.has(email)) {
      store.waiting.add(email);
      sendJson(res, {
        email,
        userId: null,
        allowlisted: true,
        exitIdentityIssued: false,
        binding: null,
        account: null,
        incomplete: ['user_not_registered'],
      }, 202);
      return;
    }
    if (!existing && file) {
      const userId = `u-${newId('n').slice(-4)}`;
      existing = newCustomerRow(userId, email, clock);
      file.list.items.unshift(existing);
      file.details[userId] = newCustomerDetail(existing, clock);
      store.waiting.delete(email);
    }
    if (!existing) {
      refuse(res, 500, 'UPSTREAM', '客户没写进去');
      return;
    }
    const userId = String(existing.userId);
    const { detail } = rowsFor(file, userId);
    const at = nowSec();
    if (typeof body.notes === 'string') existing.notes = body.notes;
    if (typeof body.contact === 'string') existing.contact = body.contact;
    const incomplete: string[] = [];
    let binding = store.bindings.find((entry) => entry.userId === userId) ?? null;
    const line = typeof body.line === 'string' ? body.line.trim() : '';
    const homeExitId = typeof body.homeExitId === 'string' ? body.homeExitId : '';
    if (line !== '') {
      const parsed = parseLine(line);
      if (parsed === null) {
        refuse(res, 400, 'VALIDATION_ERROR', 'Expected host:port:user:pass');
        return;
      }
      binding = bindLine(store, userId, parsed, at);
    } else if (homeExitId !== '') {
      binding = bind(store, userId, homeExitId, null, at);
    }
    let account = store.accounts.find(
      (row) => row.userId === userId && row.status === 'assigned',
    ) ?? null;
    const accountRef = typeof body.accountRef === 'string' ? body.accountRef.trim() : '';
    const pooledId = typeof body.productAccountId === 'string' ? body.productAccountId : '';
    if (accountRef !== '' || pooledId !== '') {
      const pooled = pooledId === ''
        ? null
        : store.accounts.find((row) => row.id === pooledId) ?? null;
      const ref = accountRef !== '' ? accountRef : pooled?.accountRef ?? '';
      if (pooled) {
        pooled.userId = userId;
        pooled.status = 'assigned';
        pooled.openedAt = at;
        pooled.updatedAt = at;
        account = pooled;
      } else {
        account = {
          id: newId('acct'),
          userId,
          accountRef: ref,
          status: 'assigned',
          openedAt: at,
          notes: null,
          createdAt: at,
          updatedAt: at,
        };
        store.accounts.push(account);
      }
      store.events.unshift({ id: newId('ev'), userId, type: 'opened', at, detail: null });
    }
    if (!account) incomplete.push('claude');
    if (detail) {
      const billing = detail.billing as Record<string, unknown> | undefined;
      if (billing && typeof body.plan === 'string') billing.plan = body.plan;
    }
    sendJson(res, {
      email,
      userId,
      allowlisted: true,
      exitIdentityIssued: true,
      binding: binding === null ? null : publicBinding(store, binding, email),
      account: account === null ? null : publicAccount(account),
      incomplete,
    }, incomplete.length === 0 ? 200 : 202);
  });
  return true;
}

export function createCustomerFixtures() {
  const stores = new Map<string, Store>();

  function storeFor(session: string, empty: boolean): Store {
    const key = `${session}/${empty ? 'empty' : 'normal'}`;
    const found = stores.get(key);
    if (found) return found;
    const made = seedStore(empty);
    stores.set(key, made);
    return made;
  }

  return function customerFixtures(options: {
    req: IncomingMessage;
    res: ServerResponse;
    route: string;
    url: string;
    session: string;
    empty: boolean;
    file: () => CustomerFile | null;
  }): boolean {
    const parts = options.route.split('/').map(decodeURIComponent);
    const method = options.req.method ?? 'GET';
    const owned = (parts[0] === 'users' && parts.length >= 2 && parts[1] !== '')
      || parts[0] === 'device-actions'
      || (parts[0] === 'devices' && parts.length === 2)
      || parts[0] === 'product-accounts'
      || (parts[0] === 'home-exits' && parts[1] === 'assign');
    // GET users is the old list endpoint; the new console must never call it.
    if (!owned || (parts[0] === 'users' && parts[1] === 'onboard' && method !== 'POST')) return false;
    const context: Context = {
      req: options.req,
      res: options.res,
      parts,
      query: new URLSearchParams(options.url.split('?')[1] ?? ''),
      store: storeFor(options.session, options.empty),
      file: options.file(),
    };
    if (parts[0] === 'users' && parts[1] === 'onboard') return onboard(context);
    if (parts[0] === 'users') return userRoutes(context);
    if (parts[0] === 'device-actions') return actionRoutes(context);
    if (parts[0] === 'devices') return revokeRoute(context);
    if (parts[0] === 'product-accounts') return accountRoutes(context);
    return assignRoute(context);
  };
}

function userRoutes(context: Context): boolean {
  const { req, res, parts, store, file } = context;
  const userId = parts[1];
  const tail = parts[2];
  const { row, detail } = rowsFor(file, userId);
  const method = req.method ?? 'GET';

  if (tail === undefined && method === 'PATCH') {
    if (!row || !detail) {
      sendEmpty(res, 404);
      return true;
    }
    void readBody(req).then((body) => {
      const clock = file?.clock ?? nowSec();
      const billing = detail.billing as Record<string, unknown>;
      if (body.status === 'active' || body.status === 'disabled') {
        row.lifecycle = body.status === 'active' ? 'active' : 'suspended';
        detail.lifecycle = row.lifecycle;
      }
      if (body.expiresAt === null || typeof body.expiresAt === 'number') {
        const value = body.expiresAt === null ? null : toFileTime(body.expiresAt, clock);
        row.expiresAt = value;
        billing.expiresAt = value;
      }
      if (typeof body.plan === 'string' || body.plan === null) billing.plan = body.plan;
      if (typeof body.notes === 'string' || body.notes === null) row.notes = body.notes;
      if (typeof body.contact === 'string' || body.contact === null) row.contact = body.contact;
      if (body.resetUsage === true) {
        const usage = { value: 0, asOfSec: clock, source: 'telemetry' };
        row.usageBytes = usage;
        billing.usageBytes = { ...usage };
      }
      row.updatedAt = clock;
      detail.updatedAt = clock;
      sendJson(res, { ok: true });
    });
    return true;
  }

  if (tail === 'close' && method === 'POST') {
    if (!row || !detail) {
      sendEmpty(res, 404);
      return true;
    }
    void readBody(req).then(() => {
      const clock = file?.clock ?? nowSec();
      row.lifecycle = 'suspended';
      detail.lifecycle = 'suspended';
      row.updatedAt = clock;
      const index = store.bindings.findIndex((entry) => entry.userId === userId);
      if (index >= 0) store.bindings.splice(index, 1);
      for (const account of store.accounts) {
        if (account.userId === userId && account.status === 'assigned') {
          account.status = 'retired';
          account.updatedAt = nowSec();
        }
      }
      sendJson(res, { ok: true, email: String(row.email), status: 'disabled' });
    });
    return true;
  }

  if (tail === 'detail' && method === 'GET') {
    if (!detail) {
      sendEmpty(res, 404);
      return true;
    }
    const accounts = store.accounts.filter((account) => account.userId === userId);
    sendJson(res, {
      devices: devicesOf(file, userId).map((device) => ({
        id: String(device.id),
        name: String(device.name),
        status: String(device.status),
        createdAt: Number(device.createdAt),
        updatedAt: Number(device.lastSeenAt ?? device.createdAt),
      })),
      diagnostics: (store.reports.get(userId) ?? []).map((report) => ({
        ...report,
        reportJson: '{}',
      })),
      product: {
        accounts: accounts.map(publicAccount),
        events: store.events.filter((event) => event.userId === userId),
        replaceCount: store.replaced.get(userId) ?? 0,
      },
      heartbeat: null,
      protectedRouteProof: store.proofs.get(userId) ?? null,
    });
    return true;
  }

  if (tail === 'home-binding') return bindingRoutes(context, userId, row);
  if (tail === 'devices' && parts[4] === 'diagnostics-logs') {
    return logRoutes(context, userId, parts[3]);
  }
  return false;
}

function bindingRoutes(
  context: Context,
  userId: string,
  row: Record<string, unknown> | null,
): boolean {
  const { req, res, store } = context;
  const method = req.method ?? 'GET';
  const email = row === null ? null : String(row.email);
  const current = store.bindings.find((entry) => entry.userId === userId) ?? null;

  if (method === 'GET') {
    sendJson(res, { binding: current === null ? null : publicBinding(store, current, email) });
    return true;
  }
  if (method === 'PUT') {
    void readBody(req).then((body) => {
      const homeExitId = typeof body.homeExitId === 'string' ? body.homeExitId : '';
      const exit = store.homeExits.find((entry) => entry.id === homeExitId);
      if (!exit) {
        refuse(res, 404, 'NOT_FOUND', 'Home exit not found');
        return;
      }
      if (exit.status !== 'active') {
        refuse(res, 409, 'HOME_EXIT_INACTIVE', 'Home exit must be active before binding');
        return;
      }
      const defaultProxyName = typeof body.defaultProxyName === 'string' && body.defaultProxyName !== ''
        ? body.defaultProxyName
        : null;
      const bound = bind(store, userId, homeExitId, defaultProxyName, nowSec());
      sendJson(res, { binding: publicBinding(store, bound, email) }, current ? 200 : 201);
    });
    return true;
  }
  if (method === 'DELETE') {
    const index = store.bindings.findIndex((entry) => entry.userId === userId);
    if (index >= 0) store.bindings.splice(index, 1);
    sendEmpty(res, 204);
    return true;
  }
  return false;
}

function logRoutes(context: Context, userId: string, deviceId: string): boolean {
  const { req, res, store, file } = context;
  const method = req.method ?? 'GET';
  const known = devicesOf(file, userId).some((device) => String(device.id) === deviceId);
  if (!known) {
    sendEmpty(res, 404);
    return true;
  }
  const answer = (expiresAt: number | null) => sendJson(res, {
    diagnosticsLogs: {
      userId,
      deviceId,
      enabled: expiresAt !== null && expiresAt > nowSec(),
      expiresAt,
    },
  });
  if (method === 'GET') {
    answer(store.logs.get(deviceId) ?? null);
    return true;
  }
  if (method === 'PUT') {
    void readBody(req).then((body) => {
      const at = nowSec();
      const expiresAt = Number(body.expiresAt);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= at || expiresAt > at + DAY) {
        refuse(res, 400, 'VALIDATION_ERROR', 'expiresAt must be within the next 24 hours');
        return;
      }
      store.logs.set(deviceId, expiresAt);
      answer(expiresAt);
    });
    return true;
  }
  if (method === 'DELETE') {
    store.logs.delete(deviceId);
    answer(null);
    return true;
  }
  return false;
}

function actionRoutes(context: Context): boolean {
  const { req, res, query, store, file } = context;
  const method = req.method ?? 'GET';
  if (method === 'GET') {
    const deviceId = query.get('deviceId');
    const at = nowSec();
    for (const action of store.actions) {
      if ((action.status === 'pending' || action.status === 'delivered') && action.expiresAt <= at) {
        action.status = 'expired';
      }
    }
    const rows = deviceId === null
      ? store.actions
      : store.actions.filter((action) => action.deviceId === deviceId);
    sendJson(res, { actions: rows.map(publicAction) });
    return true;
  }
  if (method !== 'POST') return false;
  void readBody(req).then((body) => {
    const deviceId = String(body.deviceId ?? '');
    const owner = file?.list.items.find((item) => (
      devicesOf(file, String(item.userId)).some((device) => String(device.id) === deviceId)
    ));
    if (!owner) {
      refuse(res, 404, 'NOT_FOUND', 'Active device not found');
      return;
    }
    const at = nowSec();
    const action: Action = {
      id: newId('act'),
      userId: String(owner.userId),
      deviceId,
      action: String(body.action ?? ''),
      status: 'pending',
      createdAt: at,
      expiresAt: at + ACTION_TTL,
      completedAt: null,
    };
    store.actions.unshift(action);
    sendJson(res, { action: publicAction(action) }, 201);
  });
  return true;
}

function revokeRoute(context: Context): boolean {
  const { req, res, parts, file } = context;
  if (req.method !== 'DELETE') return false;
  const deviceId = parts[1];
  for (const item of file?.list.items ?? []) {
    const userId = String(item.userId);
    const devices = devicesOf(file, userId);
    const device = devices.find((row) => String(row.id) === deviceId);
    if (!device) continue;
    device.status = 'revoked';
    const { row, detail } = rowsFor(file, userId);
    const live = devices.filter((entry) => entry.status !== 'revoked').length;
    if (row) row.deviceCount = live;
    if (detail) detail.updatedAt = file?.clock ?? nowSec();
    sendEmpty(res, 204);
    return true;
  }
  sendEmpty(res, 404);
  return true;
}

function accountRoutes(context: Context): boolean {
  const { req, res, parts, query, store } = context;
  const method = req.method ?? 'GET';
  const [, id, verb] = parts;

  if (id === undefined && method === 'GET') {
    const status = query.get('status');
    const rows = status === null
      ? store.accounts
      : store.accounts.filter((row) => row.status === status);
    sendJson(res, { accounts: rows.map(publicAccount) });
    return true;
  }
  if (id === undefined && method === 'POST') {
    void readBody(req).then((body) => {
      const accountRef = String(body.accountRef ?? '').trim();
      const userId = typeof body.userId === 'string' && body.userId !== '' ? body.userId : null;
      if (accountRef === '') {
        refuse(res, 400, 'VALIDATION_ERROR', 'Invalid accountRef');
        return;
      }
      if (store.accounts.some((row) => row.accountRef === accountRef && row.status !== 'retired')) {
        refuse(res, 409, 'ACCOUNT_REF_IN_USE', 'This Claude account is already registered');
        return;
      }
      const at = nowSec();
      const account: Account = {
        id: newId('acct'),
        userId,
        accountRef,
        status: userId === null ? 'pooled' : 'assigned',
        openedAt: userId === null ? null : at,
        notes: typeof body.notes === 'string' ? body.notes : null,
        createdAt: at,
        updatedAt: at,
      };
      store.accounts.push(account);
      if (userId !== null) {
        store.events.unshift({ id: newId('ev'), userId, type: 'opened', at, detail: null });
      }
      sendJson(res, { account: publicAccount(account) }, 201);
    });
    return true;
  }
  if (id === undefined || method !== 'POST') return false;

  const account = store.accounts.find((row) => row.id === id);
  if (!account) {
    refuse(res, 404, 'NOT_FOUND', 'Product account not found');
    return true;
  }
  if (verb === 'ban') {
    void readBody(req).then((body) => {
      const at = nowSec();
      account.status = 'banned';
      account.updatedAt = at;
      store.events.unshift({
        id: newId('ev'),
        userId: account.userId,
        type: 'banned',
        at,
        detail: typeof body.detail === 'string' ? body.detail : null,
      });
      sendJson(res, { account: publicAccount(account) });
    });
    return true;
  }
  if (verb !== 'replace') return false;
  void readBody(req).then((body) => {
    const accountRef = String(body.accountRef ?? '').trim();
    if (accountRef === '') {
      refuse(res, 400, 'VALIDATION_ERROR', 'Invalid accountRef');
      return;
    }
    const at = nowSec();
    const userId = account.userId;
    account.status = 'retired';
    account.updatedAt = at;
    const next: Account = {
      id: newId('acct'),
      userId,
      accountRef,
      status: 'assigned',
      openedAt: at,
      notes: null,
      createdAt: at,
      updatedAt: at,
    };
    store.accounts.push(next);
    if (userId !== null) {
      store.replaced.set(userId, (store.replaced.get(userId) ?? 0) + 1);
      store.events.unshift({ id: newId('ev'), userId, type: 'replaced', at, detail: null });
    }
    sendJson(res, { previous: publicAccount(account), account: publicAccount(next) });
  });
  return true;
}

function assignRoute(context: Context): boolean {
  const { req, res, store, file } = context;
  if (req.method !== 'POST') return false;
  void readBody(req).then((body) => {
    const userId = String(body.userId ?? '');
    const { row } = rowsFor(file, userId);
    if (!row) {
      refuse(res, 404, 'NOT_FOUND', 'User not found');
      return;
    }
    const parsed = parseLine(String(body.line ?? ''));
    if (parsed === null) {
      refuse(res, 400, 'VALIDATION_ERROR', 'Expected host:port:user:pass');
      return;
    }
    const current = store.bindings.find((entry) => entry.userId === userId) ?? null;
    if (current && body.replace !== true) {
      refuse(res, 409, 'HOME_ALREADY_BOUND', 'User already has a home exit; pass replace=true to swap it');
      return;
    }
    const previous = current?.homeExitId ?? null;
    const bound = bindLine(store, userId, parsed, nowSec());
    const replaced = previous !== null && previous !== bound.homeExitId;
    if (replaced) {
      const old = store.homeExits.find((entry) => entry.id === previous);
      const stillUsed = store.bindings.some((entry) => entry.homeExitId === previous);
      if (old && !stillUsed) old.status = 'retired';
    }
    const exit = store.homeExits.find((entry) => entry.id === bound.homeExitId)!;
    sendJson(res, {
      homeExit: publicExit(exit),
      binding: publicBinding(store, bound, String(row.email)),
      created: true,
      replaced,
      refreshQueued: true,
    }, 201);
  });
  return true;
}
