import {
  decryptCatalog,
  encryptCatalog,
  sha256,
} from '../../crypto';
import { ApiError } from '../../errors';
import {
  CLIENT_UUID_PLACEHOLDER,
  relistCatalogPlan,
  retirementCatalogPlan,
  splitManagedCatalogProxies,
  catalogBaseName,
  catalogHy2Name,
} from '../../catalog-yaml';
import {
  type Env,
  type Row,
  now,
  id,
  str,
  requiredCatalogKey,
} from '../../env';
import { publicNodeProfile } from '../../product-account';
import { rejectUnexpectedKeys } from '../../request';
import {
  fleetQualityStatus,
  operationsLive,
} from '../live';
import type { OpsRequestCache } from '../cache';
import {
  operationsActivity,
  operationsNodeSelections,
} from './activity';
import { retireDependencies, revokeExitToken } from '../retire-dependencies';

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

/** One row per customer: the device that reported the node most recently. */
function latestPerUser<T extends { userId: string; lastSeenAt: number }>(rows: T[]): T[] {
  const byUser = new Map<string, T>();
  for (const row of rows) {
    const current = byUser.get(row.userId);
    if (!current || row.lastSeenAt > current.lastSeenAt) byUser.set(row.userId, row);
  }
  return [...byUser.values()];
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
      catalogNames = new Set(splitManagedCatalogProxies(catalogResult.catalog.yaml).items.map((item) => catalogBaseName(item.name)));
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

export async function retireFleetNode(
  e: Env,
  actorEmail: string,
  name: string,
  requestBody: Row,
  cache?: OpsRequestCache,
  nowSec = now(),
) {
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
  const dependencies = await retireDependencies(e, name, nowSec);
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
      `INSERT INTO ops_audit(
         id, at, actor_email, action, target_type, target_id, summary,
         actor_type, actor_role, request_id
       )
       SELECT ?, ?, ?, 'node.retire', 'fleet_node', ?, ?, 'access_admin', 'owner', NULL
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
  if (dependencies.customersOnNode.length === 0) {
    await revokeExitToken(e, name, actorEmail, nowSec);
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
    dependencies,
  };
}

function proxyBlockFromProfile(name: string, publicIp: string): string {
  return [
    `  - name: ${name}`,
    '    type: vless',
    `    server: ${publicIp}`,
    '    port: 443',
    `    uuid: ${CLIENT_UUID_PLACEHOLDER}`,
    '    network: tcp',
    '    tls: true',
    '',
  ].join('\n');
}

function hy2FingerprintHex(raw: unknown): string | null {
  const hex = String(raw ?? '').replace(/:/g, '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** Same-node hy2 block. SNI matches the provisioner default (`www.microsoft.com`). */
function hy2BlockFromProfile(base: string, publicIp: string, fingerprint: string, port: number): string {
  return [
    `  - name: ${catalogHy2Name(base)}`,
    '    type: hysteria2',
    `    server: ${publicIp}`,
    `    port: ${port}`,
    `    password: ${CLIENT_UUID_PLACEHOLDER}`,
    '    sni: www.microsoft.com',
    `    fingerprint: ${fingerprint}`,
    '    skip-cert-verify: false',
    '',
  ].join('\n');
}

export async function relistFleetNode(
  e: Env,
  actorEmail: string,
  name: string,
  requestBody: Row = {},
): Promise<{ revision: number; previousRevision: number; alreadyListed: boolean; sha256: string }> {
  if (requestBody.expectedRevision != null
    && (!Number.isSafeInteger(requestBody.expectedRevision) || requestBody.expectedRevision < 0)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid expectedRevision');
  }
  const catalog = await managedCatalogTemplate(e);
  const expected = requestBody.expectedRevision == null ? catalog.revision : Number(requestBody.expectedRevision);
  if (expected !== catalog.revision) {
    throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; preview relist again');
  }
  let block = typeof requestBody.block === 'string' ? requestBody.block : '';
  const profile = await e.DB.prepare(
    'SELECT public_ip, hy2_port, hy2_fingerprint FROM ops_node_profiles WHERE catalog_name = ?',
  ).bind(name).first<Row>();
  const ip = profile?.public_ip == null ? '' : String(profile.public_ip).trim();
  if (!block.trim()) {
    if (!ip) throw new ApiError(422, 'RELIST_NO_TEMPLATE', 'No stored catalog template for this node');
    block = proxyBlockFromProfile(name, ip);
  }
  let plan = relistCatalogPlan(catalog.yaml, name, block);
  if (!plan.safe) {
    throw new ApiError(422, 'RELIST_UNSAFE', plan.warnings[0] ?? 'Node cannot be relisted');
  }
  const fingerprint = hy2FingerprintHex(profile?.hy2_fingerprint);
  if (fingerprint && ip) {
    const hy2Port = Number(profile?.hy2_port);
    const port = Number.isSafeInteger(hy2Port) && hy2Port > 0 && hy2Port <= 65535 ? hy2Port : 443;
    const hy2Plan = relistCatalogPlan(
      plan.yaml,
      catalogHy2Name(name),
      hy2BlockFromProfile(name, ip, fingerprint, port),
    );
    if (!hy2Plan.safe) {
      throw new ApiError(422, 'RELIST_UNSAFE', hy2Plan.warnings[0] ?? 'Node cannot be relisted');
    }
    plan = {
      yaml: hy2Plan.yaml,
      alreadyListed: plan.alreadyListed && hy2Plan.alreadyListed,
      warnings: hy2Plan.warnings,
      safe: true,
    };
  }
  const digest = await sha256(plan.yaml);
  const changedAt = now();
  if (plan.alreadyListed) {
    await e.DB.prepare(
      `UPDATE ops_node_profiles SET status = 'active', updated_at = ? WHERE catalog_name = ?`,
    ).bind(changedAt, name).run();
    return { revision: catalog.revision, previousRevision: catalog.revision, alreadyListed: true, sha256: digest };
  }
  const revision = catalog.revision + 1;
  const encrypted = await encryptCatalog(plan.yaml, requiredCatalogKey(e));
  const results = await e.DB.batch([
    e.DB.prepare(
      `UPDATE managed_exit_catalog
       SET revision = ?, ciphertext = ?, nonce = ?, content_sha256 = ?, updated_at = ?
       WHERE singleton_id = 1 AND revision = ?`,
    ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, changedAt, catalog.revision),
    e.DB.prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, status, created_at, updated_at)
       SELECT ?, ?, 'active', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM managed_exit_catalog
         WHERE singleton_id = 1 AND revision = ? AND content_sha256 = ?
       )
       ON CONFLICT(catalog_name) DO UPDATE SET status = 'active', updated_at = excluded.updated_at`,
    ).bind(id(), name, changedAt, changedAt, revision, digest),
    e.DB.prepare(
      `INSERT INTO ops_audit(
         id, at, actor_email, action, target_type, target_id, summary,
         actor_type, actor_role, request_id
       )
       SELECT ?, ?, ?, 'node.relist', 'fleet_node', ?, ?, 'access_admin', 'owner', NULL
       WHERE EXISTS (
         SELECT 1 FROM managed_exit_catalog
         WHERE singleton_id = 1 AND revision = ? AND content_sha256 = ?
       )`,
    ).bind(id(), changedAt, actorEmail.slice(0, 254), name, `relisted ${name}`.slice(0, 500), revision, digest),
  ]);
  if (!results[0].meta.changes) {
    throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; preview relist again');
  }
  return { revision, previousRevision: catalog.revision, alreadyListed: false, sha256: digest };
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
