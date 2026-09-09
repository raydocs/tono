import {
  decryptCatalog,
  encryptCatalog,
  sha256,
} from '../crypto';
import { ApiError } from '../errors';
import {
  retirementCatalogPlan,
  splitManagedCatalogProxies,
} from '../catalog-yaml';
import {
  type Env,
  type Row,
  now,
  id,
  str,
  requiredCatalogKey,
} from '../env';
import { publicNodeProfile } from '../product-account';
import { rejectUnexpectedKeys } from '../request';
import {
  fleetQualityStatus,
  operationsLive,
  nodeHealthFromQuality,
} from './live';
import type { OpsRequestCache } from './cache';

const TELEMETRY_MAX_REPORTED_AT_MS = 4_102_444_800_000;

async function managedCatalogTemplate(e: Env) {
  const row = await e.DB.prepare(
    'SELECT revision, ciphertext, nonce, content_sha256, updated_at FROM managed_exit_catalog WHERE singleton_id = 1',
  ).first<Row>();
  if (!row) {
    const yaml = 'proxies: []\n';
    return { revision: 0, yaml, sha256: await sha256(yaml), updatedAt: null };
  }
  let yaml: string;
  try {
    yaml = await decryptCatalog(String(row.ciphertext), String(row.nonce), requiredCatalogKey(e));
  } catch {
    throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog is unavailable');
  }
  const digest = await sha256(yaml);
  if (digest !== String(row.content_sha256)) {
    throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog failed integrity validation');
  }
  return {
    revision: Number(row.revision),
    yaml,
    sha256: digest,
    updatedAt: Number(row.updated_at),
  };
}

export async function operationsFleetNodes(e: Env, cache?: OpsRequestCache) {
  const [catalogResult, live, activity, profilesResult] = await Promise.all([
    managedCatalogTemplate(e).then(
      (catalog) => ({ state: 'ready' as const, catalog }),
      (error) => ({
        state: 'error' as const,
        message: error instanceof Error ? error.message : 'Managed catalog is unavailable',
      }),
    ),
    operationsLive(e, cache),
    operationsActivity(e, cache),
    e.DB.prepare('SELECT * FROM ops_node_profiles ORDER BY catalog_name').all<Row>(),
  ]);
  let catalogNames: Set<string> | null = null;
  let catalogRevision: number | null = null;
  let catalogSource: Row;
  if (catalogResult.state === 'ready') {
    try {
      catalogNames = new Set(splitManagedCatalogProxies(catalogResult.catalog.yaml).items.map((item) => item.name));
      catalogRevision = catalogResult.catalog.revision;
      catalogSource = { state: 'ready', revision: catalogRevision };
    } catch (error) {
      catalogSource = {
        state: 'error',
        message: error instanceof Error ? error.message : 'Managed catalog is unavailable',
      };
    }
  } else {
    catalogSource = { state: 'error', message: catalogResult.message };
  }
  const profiles = new Map(profilesResult.results.map((row) => [String(row.catalog_name), row]));
  const agents = new Map((live.agents ?? []).map((row) => [String(row.name), row]));
  const quality = new Map((live.quality?.nodes ?? []).map((row) => [String(row.name), row]));
  const names = new Set<string>([
    ...(catalogNames ?? []),
    ...profiles.keys(),
    ...agents.keys(),
    ...quality.keys(),
  ]);
  const nowSec = now();
  const nodes = [...names].sort((a, b) => a.localeCompare(b, 'zh')).map((name) => {
    const profileRow = profiles.get(name);
    const agent = agents.get(name) ?? null;
    const qualityNode = quality.get(name) ?? null;
    const observedAt = agent && typeof agent.observedAt === 'number' ? agent.observedAt : null;
    const agentStatus = observedAt === null ? 'missing' : nowSec - observedAt > 15 * 60 ? 'stale' : 'online';
    const q = fleetQualityStatus(qualityNode ?? undefined);
    const affectedRows = activity.users.filter((user) => user.selectedServer === name);
    const affectedUsers = latestPerUser(affectedRows);
    const reasons: string[] = [];
    const listed = catalogNames?.has(name) ?? null;
    if (listed === true && q.status === 'DOWN') reasons.push('catalog_health_down');
    if (listed === true && q.status === 'LIKELY_BLOCKED') reasons.push('catalog_likely_blocked');
    if (listed === true && agentStatus === 'missing') reasons.push('agent_missing');
    if (listed === true && agentStatus === 'stale') reasons.push('agent_stale');
    if (listed === true && profileRow?.status === 'retired') reasons.push('profile_retired_but_listed');
    if (catalogNames === null) reasons.push('catalog_unavailable');
    return {
      name,
      catalogListed: listed,
      qualityStatus: q.status,
      qualityLabel: q.label,
      agentStatus,
      agentObservedAt: observedAt,
      profile: profileRow ? publicNodeProfile(profileRow) : null,
      agent,
      quality: qualityNode,
      occupancy: new Set(affectedRows.filter((user) => user.online).map((user) => String(user.userId))).size,
      affectedUsers,
      needsAttention: reasons.length > 0,
      reasons,
    };
  });
  return {
    nodes,
    catalogRevision,
    sources: {
      catalog: catalogSource,
      quality: { state: live.quality ? 'ready' : 'error', message: live.qualityError },
      agents: { state: live.agents ? 'ready' : 'error', message: live.agentsError },
      profiles: { state: 'ready' },
    },
  };
}

export async function operationsRetirePreview(e: Env, name: string, cache?: OpsRequestCache) {
  const [fleet, catalog, selections] = await Promise.all([
    operationsFleetNodes(e, cache),
    managedCatalogTemplate(e),
    operationsNodeSelections(e, name, cache),
  ]);
  const node = fleet.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new ApiError(404, 'NOT_FOUND', 'Fleet node not found');
  const catalogPlan = retirementCatalogPlan(catalog.yaml, name);
  const listedCount = splitManagedCatalogProxies(catalog.yaml).items.length;
  if (catalogPlan.changes.catalogEntryRemoved && listedCount <= 1) {
    catalogPlan.warnings.push('不能退役目录中的最后一个节点。');
    catalogPlan.safe = false;
  }
  const profileMarkedRetired = node.profile === null || node.profile.status !== 'retired';
  const changes = { ...catalogPlan.changes, profileMarkedRetired };
  return {
    node,
    expectedRevision: catalog.revision,
    currentRevision: catalog.revision,
    affectedUsers: latestPerUser(selections),
    changes,
    warnings: catalogPlan.warnings,
    canRetire: catalogPlan.safe && changes.catalogEntryRemoved,
    nextYaml: catalogPlan.yaml,
  };
}

export function fleetNodeName(raw: string): string {
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid node name');
  }
  if (!name || name.length > 200 || /[\r\n\0]/.test(name)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid node name');
  }
  return name;
}

export async function retireFleetNode(e: Env, actorEmail: string, name: string, requestBody: Row, cache?: OpsRequestCache) {
  rejectUnexpectedKeys(requestBody, ['expectedRevision', 'confirmation', 'reason']);
  if (!Number.isSafeInteger(requestBody.expectedRevision) || requestBody.expectedRevision < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid expectedRevision');
  }
  if (requestBody.confirmation !== name) {
    throw new ApiError(400, 'RETIRE_CONFIRMATION_REQUIRED', 'Type the exact node name to confirm retirement');
  }
  const reason = str(requestBody.reason, 'reason', 1, 500).trim();
  if (!reason) throw new ApiError(400, 'VALIDATION_ERROR', 'Retirement reason is required');
  const preview = await operationsRetirePreview(e, name, cache);
  if (preview.currentRevision !== requestBody.expectedRevision) {
    throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; preview retirement again');
  }
  if (!preview.canRetire) {
    throw new ApiError(422, 'RETIRE_UNSAFE', preview.warnings[0] ?? 'Node cannot be retired safely');
  }
  const revision = preview.currentRevision + 1;
  const encrypted = await encryptCatalog(preview.nextYaml, requiredCatalogKey(e));
  const digest = await sha256(preview.nextYaml);
  const changedAt = now();
  const auditId = id();
  const profileId = id();
  const results = await e.DB.batch([
    e.DB.prepare(
      `UPDATE managed_exit_catalog
       SET revision = ?, ciphertext = ?, nonce = ?, content_sha256 = ?, updated_at = ?
       WHERE singleton_id = 1 AND revision = ?`,
    ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, changedAt, preview.currentRevision),
    e.DB.prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, status, created_at, updated_at)
       SELECT ?, ?, 'retired', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM managed_exit_catalog
         WHERE singleton_id = 1 AND revision = ? AND content_sha256 = ?
       )
       ON CONFLICT(catalog_name) DO UPDATE SET status = 'retired', updated_at = excluded.updated_at`,
    ).bind(profileId, name, changedAt, changedAt, revision, digest),
    e.DB.prepare(
      `INSERT INTO ops_audit(id, at, actor_email, action, target_type, target_id, summary)
       SELECT ?, ?, ?, 'node.retire', 'fleet_node', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM managed_exit_catalog
         WHERE singleton_id = 1 AND revision = ? AND content_sha256 = ?
       )`,
    ).bind(
      auditId,
      changedAt,
      actorEmail.slice(0, 254),
      name,
      `retired ${name}: ${reason}`.slice(0, 500),
      revision,
      digest,
    ),
  ]);
  if (!results[0].meta.changes) {
    throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; preview retirement again');
  }
  const refreshed = await operationsFleetNodes(e, cache);
  return {
    node: refreshed.nodes.find((candidate) => candidate.name === name) ?? { ...preview.node, catalogListed: false },
    previousRevision: preview.currentRevision,
    revision,
    sha256: digest,
    affectedUsers: preview.affectedUsers,
    changes: preview.changes,
    warnings: preview.warnings,
  };
}

export async function operationsDashboard(e: Env, cache?: OpsRequestCache) {
  const week = now() + 7 * 86_400;
  const [users, devices, fleet, catalog, unusedHomes, unusedAccounts, bannedOpen, incomplete, renewing, usersWithoutHome] = await Promise.all([
    e.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) active FROM users").first<Row>(),
    e.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) active FROM devices").first<Row>(),
    operationsFleetNodes(e, cache),
    e.DB.prepare('SELECT revision, updated_at FROM managed_exit_catalog WHERE singleton_id = 1').first<Row>(),
    e.DB.prepare(
      `SELECT COUNT(*) total FROM home_exits
       WHERE status = 'active' AND kind = 'socks5'
         AND id NOT IN (SELECT home_exit_id FROM user_home_bindings)`,
    ).first<Row>(),
    e.DB.prepare("SELECT COUNT(*) total FROM product_accounts WHERE status = 'pooled'").first<Row>(),
    e.DB.prepare(
      `SELECT COUNT(DISTINCT product_accounts.user_id) total
       FROM product_accounts
       WHERE product_accounts.status = 'banned' AND product_accounts.user_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM product_accounts live
           WHERE live.user_id = product_accounts.user_id AND live.status = 'assigned'
         )`,
    ).first<Row>(),
    e.DB.prepare(
      `SELECT COUNT(*) total FROM users
       WHERE status = 'active'
         AND NOT EXISTS (SELECT 1 FROM product_accounts WHERE user_id = users.id AND status = 'assigned')`,
    ).first<Row>(),
    e.DB.prepare(
      `SELECT COUNT(*) total FROM ops_node_profiles
       WHERE status = 'active' AND renews_at IS NOT NULL AND renews_at <= ?`,
    ).bind(week).first<Row>(),
    e.DB.prepare(
      `SELECT COUNT(*) total FROM users
       WHERE status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM user_home_bindings
           JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
           WHERE user_home_bindings.user_id = users.id
             AND home_exits.status = 'active'
         )`,
    ).first<Row>(),
  ]);
  const counts = (row: Row | null) => ({ total: Number(row?.total ?? 0), active: Number(row?.active ?? 0) });
  const fleetCounts = {
    total: fleet.nodes.length,
    active: fleet.nodes.filter((node) => node.catalogListed === true).length,
  };
  return {
    users: counts(users),
    devices: counts(devices),
    // Compatibility keys now describe the authoritative fleet aggregate. The
    // phase-1 operations_* tables keep their rows but no longer have readers.
    servers: fleetCounts,
    logicalNodes: fleetCounts,
    deployments: { total: 0, active: 0 },
    catalog: catalog
      ? { revision: Number(catalog.revision), updatedAt: Number(catalog.updated_at) }
      : { revision: 0, updatedAt: null },
    inventory: {
      unusedHomes: Number(unusedHomes?.total ?? 0),
      unusedAccounts: Number(unusedAccounts?.total ?? 0),
      bannedUnreplaced: Number(bannedOpen?.total ?? 0),
      incompleteUsers: Number(incomplete?.total ?? 0),
      renewingSoon: Number(renewing?.total ?? 0),
      usersWithoutHome: Number(usersWithoutHome?.total ?? 0),
    },
  };
}

// Per-user liveness from periodic telemetry windows (≈20 min client cadence).
// A user is "online" when their latest window is fresher than two cadences.
export const ACTIVITY_ONLINE_SECONDS = 40 * 60;
// How far back the activity ranking looks. This is a liveness view, not
// history: ranking all thirty retained days on every fifteen-second poll is
// what made the endpoint a full-table window scan. A day keeps "seen this
// morning" visible while letting the received_at index skip the rest.
const ACTIVITY_SCAN_SECONDS = 24 * 3600;

function optionalTelemetryInt(payload: Row, key: string, min: number, max: number): number | null {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
}

export function telemetryPathFields(payload: Row, receivedAtSec: number) {
  const receivedAtMs = receivedAtSec * 1_000;
  // These timestamps come from the client clock. Keep the raw value in the
  // forensic payload, but never expose a measurement as happening after the
  // Worker received it: a laptop set to 2099 would otherwise keep one bad RTT
  // "fresh" for decades in the incident board.
  const sampleAt = (key: string) => {
    const value = optionalTelemetryInt(payload, key, 1, TELEMETRY_MAX_REPORTED_AT_MS);
    return value == null ? null : Math.min(value, receivedAtMs);
  };
  return {
    exitDelayMs: optionalTelemetryInt(payload, 'exitDelayMs', 1, 120_000),
    tcpDelayMs: optionalTelemetryInt(payload, 'tcpDelayMs', 1, 120_000),
    exitDelayAtMs: sampleAt('exitDelayAtMs'),
    tcpDelayAtMs: sampleAt('tcpDelayAtMs'),
  };
}

function qualityNodeByName(quality: { nodes: Row[] } | null, name: string | null): Row | null {
  if (!quality || !name) return null;
  return quality.nodes.find((node) => node.name === name) ?? null;
}

export function activityUser(row: Row, quality: { nodes: Row[] } | null, nowSec: number) {
  let payload: Row = {};
  try {
    payload = JSON.parse(String(row.payload_json));
  } catch {
    payload = {};
  }
  const lastSeenAt = Number(row.received_at);
  const selectedServer = typeof payload.selectedServer === 'string' ? payload.selectedServer : null;
  const health = nodeHealthFromQuality(qualityNodeByName(quality, selectedServer));
  return {
    userId: String(row.user_id),
    deviceId: row.device_id === null || row.device_id === undefined ? null : String(row.device_id),
    email: String(row.email),
    lastSeenAt,
    online: nowSec - lastSeenAt <= ACTIVITY_ONLINE_SECONDS,
    clientVersion: String(row.client_version),
    osVersion: String(row.os_version),
    selectedServer,
    uiState: typeof payload.uiState === 'string' ? payload.uiState : null,
    catalogRevision: typeof payload.catalogRevision === 'number' ? payload.catalogRevision : null,
    ...telemetryPathFields(payload, lastSeenAt),
    ...health,
  };
}

/** One row per customer: the device that reported the node most recently. */
function latestPerUser<T extends { userId: string; lastSeenAt: number }>(rows: T[]): T[] {
  const byUser = new Map<string, T>();
  for (const row of rows) {
    const current = byUser.get(row.userId);
    if (!current || row.lastSeenAt > current.lastSeenAt) byUser.set(row.userId, row);
  }
  return [...byUser.values()];
}

/**
 * Everyone whose latest telemetry window names this node, over the whole
 * telemetry retention rather than the activity view's one-day scan.
 *
 * Who loses an exit when it is retired is not a liveness question: a customer
 * who has not opened their laptop this week has still selected it and still
 * finds it gone. The day-bounded scan stays where it belongs — the online and
 * active lists — and this pays for the full window only when an operator asks
 * about one node.
 */
export async function operationsNodeSelections(e: Env, name: string, cache?: OpsRequestCache) {
  const live = await operationsLive(e, cache);
  const nowSec = now();
  // Rank ids only: those columns all live in the (user_id, device_id,
  // received_at, id) index, so the whole retention is ranked without touching a
  // row, and the payload is read and parsed once per device rather than once
  // per window.
  const rows = await e.DB.prepare(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (
                PARTITION BY user_id, COALESCE(device_id, '')
                ORDER BY received_at DESC, id DESC
              ) AS rank
       FROM telemetry_windows
     )
     SELECT t.id, t.user_id, t.device_id, t.received_at, t.client_version, t.os_version,
            t.payload_json, u.email
     FROM ranked
     JOIN telemetry_windows t ON t.id = ranked.id
     JOIN users u ON u.id = t.user_id
     WHERE ranked.rank = 1 AND json_extract(t.payload_json, '$.selectedServer') = ?
     ORDER BY t.received_at DESC, t.id DESC`,
  ).bind(name).all<Row>();
  return rows.results.map((row) => activityUser(row, live.quality, nowSec));
}

export async function loadOperationsActivity(e: Env, cache?: OpsRequestCache) {
  const live = await operationsLive(e, cache);
  const quality = live.quality;
  const nowSec = now();
  const rows = await e.DB.prepare(
    `WITH ranked AS (
       SELECT t.id, t.user_id, t.device_id, t.received_at, t.client_version, t.os_version,
              t.payload_json, u.email,
              ROW_NUMBER() OVER (
                PARTITION BY t.user_id, COALESCE(t.device_id, '')
                ORDER BY t.received_at DESC, t.id DESC
              ) AS rank
       FROM telemetry_windows t
       JOIN users u ON u.id = t.user_id
       WHERE t.received_at >= ?
     )
     SELECT id, user_id, device_id, received_at, client_version, os_version, payload_json, email
     FROM ranked
     WHERE rank = 1
     ORDER BY received_at DESC, id DESC`,
  ).bind(nowSec - ACTIVITY_SCAN_SECONDS).all<Row>();
  const users = rows.results.map((row) => activityUser(row, quality, nowSec));
  const onlineRows = users.filter((user) => user.online);
  // Pre-0019 windows carry no device id; fall back to per-user counting there.
  const onlineDevices = new Set(onlineRows.map(
    (user) => `${user.userId}:${user.deviceId ?? 'legacy'}`,
  )).size;
  return {
    onlineWindowSeconds: ACTIVITY_ONLINE_SECONDS,
    onlineUsers: new Set(onlineRows.map((user) => user.userId)).size,
    onlineDevices,
    users,
  };
}

export function operationsActivity(e: Env, cache?: OpsRequestCache) {
  if (!cache) return loadOperationsActivity(e);
  return cache.activity ??= loadOperationsActivity(e, cache);
}

export const OPS_USERS_PAGE_LIMIT = 2000;

/**
 * The console's customer roster, one page per query.
 *
 * This used to fetch up to 2000 users and then expand three `IN (?,?,…)`
 * lists with one placeholder per user; the joins now ride along in the same
 * statement. `total`/`hasMore`/`nextCursor` exist because the old LIMIT 2000
 * truncated silently — the 2001st customer simply did not appear anywhere.
 */
export async function operationsUsers(
  e: Env,
  page?: { cursor?: { createdAt: number; id: string } | null; limit?: number | null },
) {
  const limit = Math.min(Math.max(page?.limit ?? OPS_USERS_PAGE_LIMIT, 1), OPS_USERS_PAGE_LIMIT);
  const cursor = page?.cursor ?? null;
  const [rows, totals] = await Promise.all([
    e.DB.prepare(
      `WITH page AS (
         SELECT * FROM users
         WHERE ? = 0 OR created_at < ? OR (created_at = ? AND id < ?)
         ORDER BY created_at DESC, id DESC
         LIMIT ?
       )
       SELECT
         page.*,
         home_exits.id AS home_exit_id,
         home_exits.proxy_name AS home_proxy_name,
         home_exits.display_name AS home_display_name,
         home_exits.egress_ipv4 AS home_egress_ipv4,
         home_exits.kind AS home_kind,
         home_exits.socks5_host AS home_socks5_host,
         home_exits.socks5_port AS home_socks5_port,
         home_exits.status AS home_status,
         user_home_bindings.default_proxy_name AS home_default_proxy_name,
         assigned.account_ref AS product_account_ref,
         assigned.status AS product_status,
         assigned.opened_at AS product_opened_at,
         (SELECT COUNT(*) FROM product_account_events
          WHERE type = 'replaced' AND user_id = page.id) AS replace_count,
         EXISTS(SELECT 1 FROM exit_credentials WHERE user_id = page.id) AS has_exit_identity
       FROM page
       LEFT JOIN user_home_bindings ON user_home_bindings.user_id = page.id
       LEFT JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
       LEFT JOIN product_accounts assigned
         ON assigned.user_id = page.id AND assigned.status = 'assigned'
       ORDER BY page.created_at DESC, page.id DESC`,
    ).bind(
      cursor ? 1 : 0,
      cursor?.createdAt ?? 0,
      cursor?.createdAt ?? 0,
      cursor?.id ?? '',
      limit + 1,
    ).all<Row>(),
    e.DB.prepare('SELECT COUNT(*) AS total FROM users').first<Row>(),
  ]);
  const hasMore = rows.results.length > limit;
  const pageRows = hasMore ? rows.results.slice(0, limit) : rows.results;
  const last = pageRows[pageRows.length - 1];
  const users = pageRows.map((row) => ({
    ...publicUser(row),
    hasExitIdentity: Number(row.has_exit_identity) === 1,
    homeBinding: row.home_exit_id
      ? {
        homeExitId: String(row.home_exit_id),
        proxyName: String(row.home_proxy_name),
        displayName: String(row.home_display_name),
        egressIpv4: row.home_egress_ipv4 == null ? undefined : String(row.home_egress_ipv4),
        kind: row.home_kind == null ? undefined : String(row.home_kind),
        socks5Host: row.home_socks5_host == null ? undefined : String(row.home_socks5_host),
        socks5Port: row.home_socks5_port == null ? undefined : Number(row.home_socks5_port),
        defaultProxyName: row.home_default_proxy_name == null || row.home_default_proxy_name === ''
          ? undefined
          : String(row.home_default_proxy_name),
        status: String(row.home_status),
      }
      : null,
    product: {
      accountRef: row.product_account_ref == null ? null : String(row.product_account_ref),
      status: row.product_status == null ? null : String(row.product_status),
      openedAt: row.product_opened_at == null ? null : Number(row.product_opened_at),
      replaceCount: Number(row.replace_count ?? 0),
      incomplete: row.product_account_ref == null,
    },
  }));
  return {
    users,
    total: Number(totals?.total ?? 0),
    hasMore,
    nextCursor: hasMore && last ? `${Number(last.created_at)}:${String(last.id)}` : null,
  };
}

export async function operationsCatalogRevisions(e: Env) {
  const [metadata, current] = await Promise.all([
    e.DB.prepare(
      `SELECT revision, content_sha256, published_at, server_count, logical_node_count, deployment_count
       FROM operations_catalog_revision_metadata ORDER BY revision DESC LIMIT 250`,
    ).all<Row>(),
    e.DB.prepare(
      'SELECT revision, content_sha256, updated_at FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<Row>(),
  ]);
  const revisions = metadata.results.map((row) => ({
    revision: Number(row.revision),
    sha256: Number(row.revision) === Number(current?.revision ?? 0)
      ? String(current!.content_sha256)
      : String(row.content_sha256),
    publishedAt: Number(row.revision) === Number(current?.revision ?? 0)
      ? Number(current!.updated_at)
      : Number(row.published_at),
    serverCount: Number(row.server_count),
    logicalNodeCount: Number(row.logical_node_count),
    deploymentCount: Number(row.deployment_count),
    current: Number(row.revision) === Number(current?.revision ?? 0),
  }));
  if (current && !revisions.some((row) => row.revision === Number(current.revision))) {
    revisions.unshift({
      revision: Number(current.revision),
      sha256: String(current.content_sha256),
      publishedAt: Number(current.updated_at),
      serverCount: 0,
      logicalNodeCount: 0,
      deploymentCount: 0,
      current: true,
    });
  }
  return revisions;
}

export const publicUser = (u: Row) => ({
  id: u.id,
  email: u.email,
  name: u.name ?? undefined,
  plan: u.plan ?? undefined,
  notes: u.notes == null || u.notes === '' ? undefined : String(u.notes),
  contact: u.contact == null || u.contact === '' ? undefined : String(u.contact),
  firstEntitledAt: u.first_entitled_at == null ? undefined : Number(u.first_entitled_at),
  deviceLimit: Number(u.device_limit ?? 2),
  quotaBytes: u.quota_bytes,
  usageBytes: Number(u.usage_bytes ?? 0),
  expiresAt: u.expires_at ?? undefined,
  suspended: u.status !== 'active',
  status: u.status,
  createdAt: u.created_at,
});
