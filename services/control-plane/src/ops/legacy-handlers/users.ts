import { ApiError } from '../../errors';
import {
  type Env,
  type Row,
  now,
  str,
} from '../../env';
import {
  bumpCatalogRevision,
  enqueueRefreshCatalogForUser,
  exitClientUUID,
} from '../../catalog';
import {
  publicHomeBinding,
  loadHomeBinding,
  upsertHomeBinding,
} from '../../home';
import {
  PRODUCT_CLAUDE,
  accountRefField,
  optionalNotes,
  optionalUnix,
  publicProductAccount,
  publicProductEvent,
  writeOpsAudit,
  assignedProductForUser,
  replaceCountForUser,
  createAssignedProductAccount,
} from '../../product-account';
import {
  rejectUnexpectedKeys,
  body,
  email,
} from '../../request';
import {
  sharedAdministrativeResource,
  type SharedAdminDeps,
} from '../shared-admin';
import {
  liveQualityNodeNamed,
  nodeHealthFromQuality,
} from '../live';
import {
  operationsUsers,
  telemetryPathFields,
  OPS_USERS_PAGE_LIMIT,
} from '../reads';

function optionalWechatId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid wechatId');
  }
  const text = value.trim();
  if (text === '') return null;
  if (text.length > 64 || /[\r\n\0]/.test(text)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid wechatId');
  }
  return text;
}

export async function getOpsUsers(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const rawLimit = url.searchParams.get('limit');
  let limit: number | null = null;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > OPS_USERS_PAGE_LIMIT) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid limit');
    }
  }
  const rawCursor = url.searchParams.get('cursor');
  let cursor: { createdAt: number; id: string } | null = null;
  if (rawCursor !== null) {
    const parsed = rawCursor.match(/^(\d{1,12}):(.{1,100})$/);
    if (!parsed) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cursor');
    cursor = { createdAt: Number(parsed[1]), id: parsed[2] };
  }
  return Response.json(await operationsUsers(e, { cursor, limit }));
}

export async function getOpsUserHomeBinding(e: Env, mt: RegExpMatchArray): Promise<Response> {
  const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(mt[1]).first<Row>();
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  const row = await e.DB.prepare(
    `SELECT
       user_home_bindings.user_id,
       users.email,
       user_home_bindings.home_exit_id,
       user_home_bindings.default_proxy_name,
       home_exits.proxy_name,
       home_exits.display_name,
       home_exits.kind,
       home_exits.socks5_host,
       home_exits.socks5_port,
       home_exits.egress_ipv4,
       home_exits.status AS home_status,
       user_home_bindings.created_at,
       user_home_bindings.updated_at
     FROM user_home_bindings
     JOIN users ON users.id = user_home_bindings.user_id
     JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
     WHERE user_home_bindings.user_id = ?`,
  ).bind(mt[1]).first<Row>();
  return Response.json({ binding: row ? publicHomeBinding(row) : null });
}

export async function getOpsUserDetail(e: Env, mt: RegExpMatchArray, deps: { freshestProtectedRouteProof: (action: Row | null | undefined, telemetry: Row | null | undefined) => unknown }): Promise<Response> {
  const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(mt[1]).first<Row>();
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  const devices = await e.DB.prepare(
    'SELECT id, name, status, created_at, updated_at FROM devices WHERE user_id = ? ORDER BY created_at DESC',
  ).bind(mt[1]).all<Row>();
  const reports = await e.DB.prepare(
    `SELECT reference_code, received_at, client_version, os_version, report_json
     FROM diagnostics_reports WHERE user_id = ? ORDER BY received_at DESC LIMIT 20`,
  ).bind(mt[1]).all<Row>();
  const accounts = await e.DB.prepare(
    'SELECT * FROM product_accounts WHERE user_id = ? ORDER BY created_at DESC',
  ).bind(mt[1]).all<Row>();
  const events = await e.DB.prepare(
    'SELECT * FROM product_account_events WHERE user_id = ? ORDER BY at DESC LIMIT 50',
  ).bind(mt[1]).all<Row>();
  const activity = await e.DB.prepare(
    `SELECT received_at, client_version, os_version, payload_json
     FROM telemetry_windows WHERE user_id = ? ORDER BY received_at DESC LIMIT 1`,
  ).bind(mt[1]).first<Row>();
  const protectedRouteTelemetry = await e.DB.prepare(
    `SELECT received_at, payload_json
     FROM telemetry_windows
     WHERE user_id = ?
       AND EXISTS (
         SELECT 1
         FROM json_each(telemetry_windows.payload_json, '$.events') event
         WHERE json_extract(event.value, '$.kind') IN (
           'protectedRouteAggregate',
           'protectedRouteInvariantViolation'
         )
       )
     ORDER BY received_at DESC
     LIMIT 1`,
  ).bind(mt[1]).first<Row>();
  const protectedRouteAction = await e.DB.prepare(
    `SELECT status, created_at, completed_at, result_json
     FROM device_actions
     WHERE user_id = ? AND action = 'claude_traffic_snapshot'
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  ).bind(mt[1]).first<Row>();
  let heartbeat: Row | null = null;
  if (activity) {
    let payload: Row = {};
    try {
      payload = JSON.parse(String(activity.payload_json));
    } catch {
      payload = {};
    }
    const selectedServer = typeof payload.selectedServer === 'string' ? payload.selectedServer : null;
    heartbeat = {
      lastSeenAt: Number(activity.received_at),
      clientVersion: String(activity.client_version),
      osVersion: String(activity.os_version),
      selectedServer,
      uiState: typeof payload.uiState === 'string' ? payload.uiState : null,
      ...telemetryPathFields(payload, Number(activity.received_at)),
      ...nodeHealthFromQuality(await liveQualityNodeNamed(e, selectedServer)),
    };
  }
  return Response.json({
    devices: devices.results.map((d) => ({
      id: String(d.id),
      name: String(d.name),
      status: String(d.status),
      createdAt: Number(d.created_at),
      updatedAt: Number(d.updated_at),
    })),
    diagnostics: reports.results.map((r) => ({
      referenceCode: String(r.reference_code),
      receivedAt: Number(r.received_at),
      clientVersion: String(r.client_version),
      osVersion: String(r.os_version),
      reportJson: String(r.report_json),
    })),
    product: {
      accounts: accounts.results.map(publicProductAccount),
      events: events.results.map(publicProductEvent),
      replaceCount: await replaceCountForUser(e, mt[1]),
    },
    heartbeat,
    protectedRouteProof: deps.freshestProtectedRouteProof(
      protectedRouteAction,
      protectedRouteTelemetry,
    ),
  });
}

export async function postOpsUserOnboard(req: Request, e: Env, actor: { email: string }, deps: { sharedAdminDeps: SharedAdminDeps }): Promise<Response> {
  const b = await body(req, 16 * 1024);
  rejectUnexpectedKeys(b, [
    'email', 'line', 'homeExitId', 'accountRef', 'productAccountId', 'openedAt', 'notes', 'contact',
    'wechatId',
  ]);
  const address = email(b.email);
  const createdAt = now();
  await e.DB.prepare(
    'INSERT OR IGNORE INTO signup_allowlist(email, created_at) VALUES(?, ?)',
  ).bind(address, createdAt).run();
  const user = await e.DB.prepare('SELECT * FROM users WHERE email = ?').bind(address).first<Row>();
  const incomplete: string[] = [];
  if (!user) incomplete.push('user_not_registered');
  const storeProfile = b.notes !== undefined || b.contact !== undefined || b.wechatId !== undefined;
  const pendingProfile = !user && storeProfile;
  let binding = null;
  let account = null;
  let exitIdentityIssued = false;
  if (user) {
    await exitClientUUID(e, String(user.id));
    exitIdentityIssued = true;
    if (b.notes !== undefined || b.contact !== undefined || b.wechatId !== undefined) {
      await e.DB.prepare(
        `UPDATE users SET
           notes = CASE WHEN ? THEN ? ELSE notes END,
           contact = CASE WHEN ? THEN ? ELSE contact END,
           wechat_id = CASE WHEN ? THEN ? ELSE wechat_id END,
           updated_at = ?
         WHERE id = ?`,
      ).bind(
        b.notes !== undefined, optionalNotes(b.notes),
        b.contact !== undefined, optionalNotes(b.contact, 'contact', 200),
        b.wechatId !== undefined, optionalWechatId(b.wechatId),
        now(), user.id,
      ).run();
    }
    if (b.line !== undefined && b.line !== null && b.line !== '') {
      const assigned = await sharedAdministrativeResource(
        new Request(req.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            line: b.line,
            replace: true,
          }),
        }),
        e, 'home-exits/assign', 'POST', actor.email, deps.sharedAdminDeps,
      );
      if (!assigned || !assigned.ok) {
        throw new ApiError(assigned?.status ?? 400, 'HOME_ASSIGN_FAILED', 'Could not assign the pasted home line');
      }
    } else if (b.homeExitId) {
      const homeExitId = str(b.homeExitId, 'homeExitId', 1, 100);
      const existing = await loadHomeBinding(e, String(user.id));
      await upsertHomeBinding(
        e, String(user.id), homeExitId,
        existing?.default_proxy_name == null ? null : String(existing.default_proxy_name),
      );
      await bumpCatalogRevision(e);
      await enqueueRefreshCatalogForUser(e, String(user.id));
    }
    binding = await loadHomeBinding(e, String(user.id));
    if (b.accountRef) {
      account = await createAssignedProductAccount(
        e, String(user.id), accountRefField(b.accountRef),
        optionalUnix(b.openedAt, 'openedAt') ?? now(),
        optionalNotes(b.notes), actor.email,
      );
    } else if (b.productAccountId) {
      const pooled = await e.DB.prepare(
        'SELECT account_ref FROM product_accounts WHERE id = ?',
      ).bind(str(b.productAccountId, 'productAccountId', 1, 100)).first<Row>();
      if (!pooled) throw new ApiError(404, 'NOT_FOUND', 'Product account not found');
      account = await createAssignedProductAccount(
        e, String(user.id), String(pooled.account_ref),
        optionalUnix(b.openedAt, 'openedAt') ?? now(),
        optionalNotes(b.notes), actor.email,
      );
    } else {
      account = await assignedProductForUser(e, String(user.id));
    }
    if (!account) incomplete.push('claude');
  } else if (pendingProfile) {
    await e.DB.prepare(
      `UPDATE signup_allowlist SET
         wechat_id = CASE WHEN ? THEN ? ELSE wechat_id END,
         contact = CASE WHEN ? THEN ? ELSE contact END,
         notes = CASE WHEN ? THEN ? ELSE notes END
       WHERE email = ?`,
    ).bind(
      b.wechatId !== undefined, optionalWechatId(b.wechatId),
      b.contact !== undefined, optionalNotes(b.contact, 'contact', 200),
      b.notes !== undefined, optionalNotes(b.notes),
      address,
    ).run();
  }
  await writeOpsAudit(e, actor.email, 'user.onboard', 'user', user ? String(user.id) : null, address);
  return Response.json({
    email: address,
    userId: user ? String(user.id) : null,
    allowlisted: true,
    exitIdentityIssued,
    binding: binding ? publicHomeBinding(binding) : null,
    account: account ? publicProductAccount(account) : null,
    incomplete,
    pendingProfile,
  }, { status: user && incomplete.length === 0 ? 200 : 202 });
}

export async function patchOpsUser(req: Request, e: Env, actor: { email: string }, mt: RegExpMatchArray, deps: { enforceUser: (e: Env, userId: string, processNow?: boolean) => Promise<void> }): Promise<Response> {
  const b = await body(req, 16 * 1024);
  // A misspelled field used to return 200 and change nothing. For an
  // endpoint whose job includes clearing a billing cycle so a locked-out
  // customer can connect again, a silent success is the worst possible
  // answer: the operator believes the account was reset and only finds out
  // when the customer is still suspended.
  rejectUnexpectedKeys(b, ['status', 'expiresAt', 'notes', 'contact', 'plan', 'resetUsage', 'wechatId']);
  const status = b.status;
  const expiresAt = b.expiresAt;
  // The console is where a quota lockout is noticed — the dashboard raises
  // "已超配额" from this same data — so it is where ending the cycle has to
  // be possible. It lived only on the token-admin endpoint, which meant the
  // one documented remedy for a paying customer who cannot connect was a
  // hand-written API call.
  //
  // Ending a cycle, not editing a number: the collector re-sends a
  // fleet-wide cumulative total every ten minutes and the write is a MAX(),
  // so zeroing `usage_bytes` alone is undone within ten minutes. Moving the
  // baseline up to the reported counter is what actually clears it.
  const resetUsage = b.resetUsage;
  if (resetUsage !== undefined && resetUsage !== true) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'resetUsage may only be true');
  }
  if (status !== undefined && !['active', 'disabled'].includes(status)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
  }
  if (
    expiresAt !== undefined &&
    expiresAt !== null &&
    (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid expiresAt');
  }
  if (
    status === undefined && expiresAt === undefined && resetUsage === undefined
    && b.notes === undefined && b.contact === undefined && b.plan === undefined
    && b.wechatId === undefined
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'status, expiresAt, notes, contact, plan, wechatId or resetUsage is required');
  }
  if (status === 'active') {
    const residual = await e.DB.prepare(
      `SELECT
         users.status current_status,
         (SELECT COUNT(*) FROM devices
          WHERE user_id = ? AND status IN ('active', 'pending')) live_devices,
         (SELECT COUNT(*) FROM revocation_jobs
          JOIN devices ON devices.id = revocation_jobs.device_id
          WHERE devices.user_id = ? AND revocation_jobs.completed_at IS NULL) pending_jobs
       FROM users WHERE users.id = ?`,
    ).bind(mt[1], mt[1], mt[1]).first<Row>();
    if (!residual) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    if (
      residual.current_status !== 'active' &&
      ((residual.live_devices ?? 0) > 0 || (residual.pending_jobs ?? 0) > 0)
    ) {
      throw new ApiError(409, 'REVOCATION_PENDING', 'Wait for tailnet device revocation before re-enabling this user');
    }
  }
  if (b.plan !== undefined && b.plan !== null && b.plan !== '' && b.plan !== PRODUCT_CLAUDE) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid plan');
  }
  const updated = await e.DB.prepare(
    `UPDATE users SET
       status = COALESCE(?, status),
       expires_at = CASE WHEN ? THEN ? ELSE expires_at END,
       notes = CASE WHEN ? THEN ? ELSE notes END,
       contact = CASE WHEN ? THEN ? ELSE contact END,
       wechat_id = CASE WHEN ? THEN ? ELSE wechat_id END,
       plan = CASE WHEN ? THEN ? ELSE plan END,
       usage_baseline_bytes = CASE WHEN ? THEN usage_reported_bytes ELSE usage_baseline_bytes END,
       usage_bytes = CASE WHEN ? THEN 0 ELSE usage_bytes END,
       updated_at = ?
     WHERE id = ?`,
  ).bind(
    status ?? null,
    expiresAt !== undefined,
    expiresAt ?? null,
    b.notes !== undefined,
    b.notes === undefined ? null : optionalNotes(b.notes),
    b.contact !== undefined,
    b.contact === undefined ? null : optionalNotes(b.contact, 'contact', 200),
    b.wechatId !== undefined,
    b.wechatId === undefined ? null : optionalWechatId(b.wechatId),
    b.plan !== undefined,
    b.plan === undefined || b.plan === null || b.plan === '' ? null : PRODUCT_CLAUDE,
    resetUsage === true,
    resetUsage === true,
    now(),
    mt[1],
  ).run();
  if (!updated.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  if (resetUsage === true) {
    await writeOpsAudit(e, actor.email, 'user.usage-reset', 'user', mt[1], 'billing cycle reset');
  }
  if (b.wechatId !== undefined) {
    const wechatId = optionalWechatId(b.wechatId);
    await writeOpsAudit(
      e, actor.email, 'user.wechat.update', 'user', mt[1],
      wechatId == null ? 'cleared' : wechatId,
    );
  }
  const changedFields = [
    status !== undefined ? 'status' : null,
    expiresAt !== undefined ? 'expiresAt' : null,
    b.notes !== undefined ? 'notes' : null,
    b.contact !== undefined ? 'contact' : null,
    b.plan !== undefined ? 'plan' : null,
  ].filter((name): name is string => name !== null);
  if (changedFields.length) {
    await writeOpsAudit(e, actor.email, 'user.update', 'user', mt[1], `changed ${changedFields.join(', ')}`);
  }
  await deps.enforceUser(e, mt[1]);
  return Response.json({ ok: true });
}
