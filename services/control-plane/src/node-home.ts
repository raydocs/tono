import { type Env, type Row, id, now } from './env';
import { sha256 } from './crypto';
import { ApiError } from './errors';
import { catalogBaseName } from './catalog-yaml';
import { authenticateExitNode } from './auth';
import { recordExitAgentAsn } from './ops/ingest-hooks';
import { USAGE_METERING_NODE_READY_SECONDS } from './ops/shared-admin/usage-metering';
import { body, rejectUnexpectedKeys } from './request';

export const VERIFIED_NODE_HOME_XRAY_VERSIONS: ReadonlySet<string> = new Set([
  '26.3.27',
  '26.11.9',
]);

export const NODE_HOME_METERING_VERSION_MIN = 3;

export type CatalogHomeTunnel = {
  homeExitId: string;
  clientUuid: string;
  exitBaseNames: string[];
};

export type CatalogRoutingShape = {
  homeProxy?: string;
  defaultProxy?: string;
  homeSocks5?: { host: string; port: number; username: string; password: string };
  homeTunnel?: CatalogHomeTunnel;
};

export type ScopedHomeIdentity = {
  userId: string;
  deviceId: string;
  clientUUID: string;
  homeExitId: string;
  bindingGeneration: string;
  sourceUsageBytes?: number;
};

export type ScopedHomeOutbound = {
  homeExitId: string;
  bindingGeneration: string;
  host: string;
  port: number;
  username: string;
  password: string;
};

export type ScopedHomeRoster = {
  homeIdentities: ScopedHomeIdentity[];
  homeOutbounds: ScopedHomeOutbound[];
};

const utf8Encoder = new TextEncoder();

/** Lexicographic comparator over raw UTF-8 encoded bytes (matches Unicode codepoint order). */
export function compareUtf8Bytes(a: string, b: string): number {
  const ab = utf8Encoder.encode(a);
  const bb = utf8Encoder.encode(b);
  const limit = Math.min(ab.length, bb.length);
  for (let i = 0; i < limit; i += 1) {
    const av = ab[i] ?? 0;
    const bv = bb[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return ab.length - bb.length;
}

function assertDigestField(value: string, label: string, forbidComma = false): void {
  if (
    value.includes('\n')
    || value.includes('\u001f')
    || (forbidComma && value.includes(','))
  ) {
    throw new ApiError(500, 'CATALOG_UNAVAILABLE', `Invalid routing digest character in ${label}`);
  }
}

/** Canonical 8-segment `\n`-joined v2 preimage specified in RFC §3.4. */
export function routingDigestV2Preimage(routing: CatalogRoutingShape | undefined): string {
  const homeProxy = routing?.homeProxy ?? '';
  const defaultProxy = routing?.defaultProxy ?? '';
  assertDigestField(homeProxy, 'homeProxy');
  assertDigestField(defaultProxy, 'defaultProxy');

  let socks5Host = '';
  let socks5Port = '';
  let socks5User = '';
  let socks5Pass = '';
  if (routing?.homeSocks5) {
    const s5 = routing.homeSocks5;
    if (!Number.isSafeInteger(s5.port) || s5.port < 1 || s5.port > 65535) {
      throw new ApiError(500, 'CATALOG_UNAVAILABLE', 'Invalid homeSocks5 port in routing digest');
    }
    assertDigestField(s5.host, 'homeSocks5.host');
    assertDigestField(s5.username, 'homeSocks5.username');
    assertDigestField(s5.password, 'homeSocks5.password');
    socks5Host = s5.host;
    socks5Port = String(s5.port);
    socks5User = s5.username;
    socks5Pass = s5.password;
  }

  let homeTunnelField = '';
  if (routing?.homeTunnel) {
    const ht = routing.homeTunnel;
    assertDigestField(ht.homeExitId, 'homeTunnel.homeExitId');
    assertDigestField(ht.clientUuid, 'homeTunnel.clientUuid');
    const uniqueBases = [...new Set(ht.exitBaseNames)];
    for (const name of uniqueBases) {
      assertDigestField(name, 'homeTunnel.exitBaseNames', true);
    }
    uniqueBases.sort(compareUtf8Bytes);
    homeTunnelField = [ht.homeExitId, ht.clientUuid, uniqueBases.join(',')].join('\u001f');
  }

  return [
    'v2',
    homeProxy,
    defaultProxy,
    socks5Host,
    socks5Port,
    socks5User,
    socks5Pass,
    homeTunnelField,
  ].join('\n');
}

export async function routingSha256V2(routing: CatalogRoutingShape | undefined): Promise<string> {
  return sha256(routingDigestV2Preimage(routing));
}

export async function setHomeExitDeliveryMode(
  e: Env,
  homeExitId: string,
  deliveryMode: 'legacy_socks5' | 'node_only',
): Promise<void> {
  const existing = await e.DB.prepare(
    'SELECT kind FROM home_exits WHERE id = ?',
  ).bind(homeExitId).first<Row>();
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
  if (deliveryMode === 'node_only' && String(existing.kind ?? 'catalog') !== 'socks5') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Only socks5 home exits may use node_only delivery mode');
  }
  await e.DB.prepare(
    'UPDATE home_exits SET delivery_mode = ?, updated_at = ? WHERE id = ?',
  ).bind(deliveryMode, now(), homeExitId).run();
}

export async function assignHomeExitToNode(
  e: Env,
  homeExitId: string,
  exitNodeId: string,
): Promise<void> {
  const [home, exitNode] = await e.DB.batch<Row>([
    e.DB.prepare('SELECT id, kind FROM home_exits WHERE id = ?').bind(homeExitId),
    e.DB.prepare('SELECT id FROM exit_nodes WHERE id = ?').bind(exitNodeId),
  ]);
  const homeRow = home?.results[0];
  if (!homeRow) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
  if (String(homeRow.kind ?? 'catalog') !== 'socks5') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Only socks5 home exits can be assigned to exit nodes');
  }
  if (!exitNode?.results[0]) throw new ApiError(404, 'NOT_FOUND', 'Exit node not found');
  await e.DB.prepare(
    'INSERT OR IGNORE INTO home_exit_nodes(home_exit_id, exit_node_id, created_at) VALUES(?, ?, ?)',
  ).bind(homeExitId, exitNodeId, now()).run();
}

export async function removeHomeExitFromNode(
  e: Env,
  homeExitId: string,
  exitNodeId: string,
): Promise<void> {
  await e.DB.prepare(
    'DELETE FROM home_exit_nodes WHERE home_exit_id = ? AND exit_node_id = ?',
  ).bind(homeExitId, exitNodeId).run();
}

export async function hasAssignedHomeExitNodes(e: Env, homeExitId: string): Promise<boolean> {
  const row = await e.DB.prepare(
    'SELECT 1 FROM home_exit_nodes WHERE home_exit_id = ? LIMIT 1',
  ).bind(homeExitId).first<Row>();
  return row !== null;
}

export type DeviceHomeCredentialRecord = {
  id: string;
  bindingGeneration: string;
  clientUuid: string;
  createdAt: number;
};

/** Mint or load the active `h:` credential generation bound to `(deviceId, homeExitId)`. */
export async function mintOrLoadDeviceHomeCredential(
  e: Env,
  userId: string,
  deviceId: string,
  homeExitId: string,
): Promise<DeviceHomeCredentialRecord> {
  const existing = await e.DB.prepare(
    `SELECT credentials.id, credentials.binding_generation, credentials.client_uuid, credentials.created_at
     FROM device_home_credentials credentials
     JOIN user_home_bindings bindings
       ON bindings.user_id = credentials.user_id
      AND bindings.home_exit_id = credentials.home_exit_id
     JOIN devices ON devices.id = credentials.device_id
     WHERE credentials.device_id = ?
       AND credentials.user_id = ?
       AND credentials.home_exit_id = ?
       AND credentials.retired_at IS NULL
       AND devices.status IN ('pending', 'active')`,
  ).bind(deviceId, userId, homeExitId).first<Row>();
  if (existing) {
    return {
      id: String(existing.id),
      bindingGeneration: String(existing.binding_generation),
      clientUuid: String(existing.client_uuid),
      createdAt: Number(existing.created_at),
    };
  }

  // Share the same binding generation across active devices of one user on the same binding
  // so per-tenant Xray outbound tag `home:<home_exit_id>:<binding_gen>` unifies their drain lifecycle.
  const sibling = await e.DB.prepare(
    `SELECT binding_generation FROM device_home_credentials
     WHERE user_id = ? AND home_exit_id = ? AND retired_at IS NULL
     LIMIT 1`,
  ).bind(userId, homeExitId).first<Row>();
  const bindingGeneration = sibling ? String(sibling.binding_generation) : crypto.randomUUID();
  const timestamp = now();

  await e.DB.prepare(
    `INSERT OR IGNORE INTO device_home_credentials(
       id, user_id, device_id, home_exit_id, binding_generation, client_uuid, created_at
     )
     SELECT ?, devices.user_id, devices.id, bindings.home_exit_id, ?, ?, ?
     FROM devices
     JOIN user_home_bindings bindings
       ON bindings.user_id = devices.user_id AND bindings.home_exit_id = ?
     JOIN home_exits ON home_exits.id = bindings.home_exit_id
     WHERE devices.id = ?
       AND devices.user_id = ?
       AND devices.status IN ('pending', 'active')
       AND home_exits.kind = 'socks5'
       AND home_exits.status = 'active'`,
  ).bind(
    id(),
    bindingGeneration,
    crypto.randomUUID(),
    timestamp,
    homeExitId,
    deviceId,
    userId,
  ).run();

  const minted = await e.DB.prepare(
    `SELECT credentials.id, credentials.binding_generation, credentials.client_uuid, credentials.created_at
     FROM device_home_credentials credentials
     JOIN devices ON devices.id = credentials.device_id
     WHERE credentials.device_id = ?
       AND credentials.user_id = ?
       AND credentials.home_exit_id = ?
       AND credentials.retired_at IS NULL
       AND devices.status IN ('pending', 'active')`,
  ).bind(deviceId, userId, homeExitId).first<Row>();
  if (!minted) {
    throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Could not mint residential exit identity');
  }
  return {
    id: String(minted.id),
    bindingGeneration: String(minted.binding_generation),
    clientUuid: String(minted.client_uuid),
    createdAt: Number(minted.created_at),
  };
}

export async function selectAcknowledgedHomeExitBases(
  e: Env,
  homeExitId: string,
  credCreatedAt: number,
  keptVlessBases: ReadonlySet<string>,
  timestamp: number,
  rosterFreshSec: number,
): Promise<string[]> {
  const rows = await e.DB.prepare(
    `SELECT exit_nodes.name, exit_nodes.status, exit_nodes.node_home_capable,
            exit_nodes.node_home_metering_version, exit_nodes.node_home_xray_version,
            exit_nodes.last_home_roster_at
     FROM home_exit_nodes
     JOIN exit_nodes ON exit_nodes.id = home_exit_nodes.exit_node_id
     WHERE home_exit_nodes.home_exit_id = ?`,
  ).bind(homeExitId).all<Row>();

  const readyBases = new Set<string>();
  for (const row of rows.results) {
    if (String(row.status) !== 'active') continue;
    if (Number(row.node_home_capable ?? 0) !== 1) continue;
    if (Number(row.node_home_metering_version ?? 0) < NODE_HOME_METERING_VERSION_MIN) continue;
    if (!VERIFIED_NODE_HOME_XRAY_VERSIONS.has(String(row.node_home_xray_version ?? ''))) continue;
    const lastHomeAt = Number(row.last_home_roster_at ?? 0);
    if (!Number.isSafeInteger(lastHomeAt) || lastHomeAt <= credCreatedAt) continue;
    if (timestamp - lastHomeAt >= rosterFreshSec) continue;
    const base = catalogBaseName(String(row.name));
    if (keptVlessBases.has(base)) readyBases.add(base);
  }
  return [...readyBases].sort(compareUtf8Bytes);
}

/** Scoped `h:` identities and outbound credentials for a verified per-node token only. */
export async function loadScopedHomeRosterForNode(
  e: Env,
  nodeId: string,
  observedAt: number,
  watermarks?: ReadonlyMap<string, number>,
): Promise<ScopedHomeRoster | null> {
  const [rollout, node] = await e.DB.batch<Row>([
    e.DB.prepare('SELECT phase FROM exit_credential_rollout WHERE singleton_id = 1'),
    e.DB.prepare(
      `SELECT status, node_home_capable, node_home_metering_version, node_home_xray_version
       FROM exit_nodes WHERE id = ?`,
    ).bind(nodeId),
  ]);
  const phase = rollout?.results[0]?.phase;
  if (phase !== 'device_only') return null;

  const nodeRow = node?.results[0];
  if (
    !nodeRow
    || String(nodeRow.status) !== 'active'
    || Number(nodeRow.node_home_capable ?? 0) !== 1
    || Number(nodeRow.node_home_metering_version ?? 0) < NODE_HOME_METERING_VERSION_MIN
    || !VERIFIED_NODE_HOME_XRAY_VERSIONS.has(String(nodeRow.node_home_xray_version ?? ''))
  ) {
    return null;
  }

  const rows = await e.DB.prepare(
    `SELECT credentials.user_id, credentials.device_id, credentials.home_exit_id,
            credentials.binding_generation, credentials.client_uuid,
            home_exits.socks5_host, home_exits.socks5_port,
            home_exits.socks5_username, home_exits.socks5_password
     FROM device_home_credentials credentials
     JOIN user_home_bindings bindings
       ON bindings.user_id = credentials.user_id
      AND bindings.home_exit_id = credentials.home_exit_id
     JOIN devices ON devices.id = credentials.device_id
     JOIN users ON users.id = credentials.user_id
     JOIN home_exits ON home_exits.id = credentials.home_exit_id
     JOIN home_exit_nodes assigned
       ON assigned.home_exit_id = home_exits.id AND assigned.exit_node_id = ?
     WHERE credentials.retired_at IS NULL
       AND devices.status IN ('pending', 'active')
       AND users.status = 'active'
       AND (users.expires_at IS NULL OR users.expires_at > ?)
       AND (users.quota_bytes IS NULL OR users.usage_bytes < users.quota_bytes)
       AND home_exits.kind = 'socks5'
       AND home_exits.status = 'active'
       AND home_exits.socks5_host IS NOT NULL AND home_exits.socks5_host != ''
       AND home_exits.socks5_port BETWEEN 1 AND 65535
       AND home_exits.socks5_username IS NOT NULL AND home_exits.socks5_username != ''
       AND home_exits.socks5_password IS NOT NULL AND home_exits.socks5_password != ''
     ORDER BY credentials.home_exit_id, credentials.user_id, credentials.device_id`,
  ).bind(nodeId, observedAt).all<Row>();

  const homeIdentities: ScopedHomeIdentity[] = [];
  const outboundsByKey = new Map<string, ScopedHomeOutbound>();
  const homeExitIds = new Set<string>();

  for (const row of rows.results) {
    const userId = String(row.user_id);
    const homeExitId = String(row.home_exit_id);
    const bindingGeneration = String(row.binding_generation);
    homeIdentities.push({
      userId,
      deviceId: String(row.device_id),
      clientUUID: String(row.client_uuid),
      homeExitId,
      bindingGeneration,
      ...(watermarks ? { sourceUsageBytes: watermarks.get(userId) ?? 0 } : {}),
    });
    const outKey = `${homeExitId}\u001f${bindingGeneration}`;
    if (!outboundsByKey.has(outKey)) {
      outboundsByKey.set(outKey, {
        homeExitId,
        bindingGeneration,
        host: String(row.socks5_host),
        port: Number(row.socks5_port),
        username: String(row.socks5_username),
        password: String(row.socks5_password),
      });
    }
    homeExitIds.add(homeExitId);
  }

  const homeOutbounds = [...outboundsByKey.values()];
  if (homeOutbounds.length > 0) {
    const timestamp = now();
    await e.DB.batch([
      ...homeOutbounds.map((item) => e.DB.prepare(
        `INSERT OR IGNORE INTO home_exit_drain_acks(home_exit_id, retired_generation, node_id, admitted_at)
         VALUES(?, ?, ?, ?)`,
      ).bind(item.homeExitId, item.bindingGeneration, nodeId, observedAt)),
      e.DB.prepare(
        `INSERT INTO home_outbound_deliveries(id, node_id, observed_at, home_exit_ids_json, identity_count, created_at)
         VALUES(?, ?, ?, ?, ?, ?)`,
      ).bind(
        id(),
        nodeId,
        observedAt,
        JSON.stringify([...homeExitIds].sort()),
        homeIdentities.length,
        timestamp,
      ),
    ]);
  }

  return { homeIdentities, homeOutbounds };
}

type DrainedGenInput = { homeExitId: string; retiredGeneration: string };

function parseDrainedGenerations(raw: unknown): DrainedGenInput[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 200) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid drainedGenerations list');
  }
  const parsed: DrainedGenInput[] = [];
  for (const item of raw) {
    rejectUnexpectedKeys(item, ['homeExitId', 'retiredGeneration']);
    const homeExitId = typeof item.homeExitId === 'string' ? item.homeExitId.trim() : '';
    const retiredGeneration = typeof item.retiredGeneration === 'string' ? item.retiredGeneration.trim() : '';
    if (
      homeExitId.length < 1 || homeExitId.length > 64
      || retiredGeneration.length < 1 || retiredGeneration.length > 64
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid drainedGenerations item');
    }
    parsed.push({ homeExitId, retiredGeneration });
  }
  return parsed;
}

export async function handleHomeRosterAck(req: Request, e: Env): Promise<Response> {
  const node = await authenticateExitNode(req, e);
  await recordExitAgentAsn(e, req, node?.name ?? null);
  const b = await body(req, 32 * 1024);
  rejectUnexpectedKeys(b, [
    'observedAt',
    'meteringProtocolVersion',
    'nodeHomeCapable',
    'nodeHomeXrayVersion',
    'homeObservedAt',
    'drainedGenerations',
  ]);
  const t = now();
  if (
    typeof b.observedAt !== 'number'
    || !Number.isSafeInteger(b.observedAt)
    || b.observedAt < 0
    || b.observedAt > t + 300
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid roster observedAt');
  }

  let meteringVersion: number | null = null;
  if (b.meteringProtocolVersion !== undefined) {
    if (
      typeof b.meteringProtocolVersion !== 'number'
      || !Number.isSafeInteger(b.meteringProtocolVersion)
      || b.meteringProtocolVersion < 1
      || b.meteringProtocolVersion > 100
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid meteringProtocolVersion');
    }
    meteringVersion = b.meteringProtocolVersion;
  }

  let nodeHomeCapableInt: 0 | 1 | null = null;
  let verifiedXrayVersion: string | null = null;
  if (b.nodeHomeCapable !== undefined) {
    if (typeof b.nodeHomeCapable !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid nodeHomeCapable');
    }
    if (b.nodeHomeCapable) {
      if (meteringVersion === null || meteringVersion < NODE_HOME_METERING_VERSION_MIN) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          `nodeHomeCapable requires meteringProtocolVersion >= ${NODE_HOME_METERING_VERSION_MIN}`,
        );
      }
      if (
        typeof b.nodeHomeXrayVersion !== 'string'
        || !VERIFIED_NODE_HOME_XRAY_VERSIONS.has(b.nodeHomeXrayVersion)
      ) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Unverified Xray version for node-home capability');
      }
      nodeHomeCapableInt = 1;
      verifiedXrayVersion = b.nodeHomeXrayVersion;
    } else {
      nodeHomeCapableInt = 0;
    }
  } else if (b.nodeHomeXrayVersion !== undefined) {
    if (typeof b.nodeHomeXrayVersion !== 'string' || b.nodeHomeXrayVersion.length > 64) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid nodeHomeXrayVersion');
    }
    verifiedXrayVersion = b.nodeHomeXrayVersion;
  }

  let homeObservedAt: number | null = null;
  if (b.homeObservedAt !== undefined) {
    if (
      typeof b.homeObservedAt !== 'number'
      || !Number.isSafeInteger(b.homeObservedAt)
      || b.homeObservedAt < 0
      || b.homeObservedAt > t + 300
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid homeObservedAt');
    }
    homeObservedAt = b.homeObservedAt;
  }

  const drained = parseDrainedGenerations(b.drainedGenerations);
  const statements: D1PreparedStatement[] = [
    e.DB.prepare(
      `UPDATE exit_nodes
       SET last_roster_at = MAX(last_roster_at, ?),
           node_home_capable = COALESCE(?, node_home_capable),
           node_home_metering_version = CASE
             WHEN ? IS NOT NULL THEN MAX(node_home_metering_version, ?)
             ELSE node_home_metering_version
           END,
           node_home_xray_version = COALESCE(?, node_home_xray_version),
           last_home_roster_at = CASE
             WHEN ? IS NOT NULL THEN MAX(last_home_roster_at, ?)
             ELSE last_home_roster_at
           END,
           updated_at = ?
       WHERE id = ? AND status = 'active'`,
    ).bind(
      b.observedAt,
      nodeHomeCapableInt,
      meteringVersion,
      meteringVersion,
      verifiedXrayVersion,
      homeObservedAt,
      homeObservedAt,
      t,
      node!.id,
    ),
  ];

  if (homeObservedAt !== null) {
    statements.push(
      e.DB.prepare(
        `UPDATE device_home_credentials
         SET acknowledged_at = COALESCE(acknowledged_at, ?)
         WHERE retired_at IS NULL
           AND acknowledged_at IS NULL
           AND created_at < ?
           AND home_exit_id IN (SELECT home_exit_id FROM home_exit_nodes WHERE exit_node_id = ?)`,
      ).bind(homeObservedAt, homeObservedAt, node!.id),
    );
  }

  for (const item of drained) {
    statements.push(
      e.DB.prepare(
        `UPDATE home_exit_drain_acks
         SET drained_at = COALESCE(drained_at, ?)
         WHERE home_exit_id = ? AND retired_generation = ? AND node_id = ?`,
      ).bind(t, item.homeExitId, item.retiredGeneration, node!.id),
    );
  }

  await e.DB.batch(statements);
  return Response.json({
    nodeId: node!.id,
    observedAt: b.observedAt,
    ...(homeObservedAt !== null ? { homeObservedAt } : {}),
  });
}

export async function handleHomeMeteringAck(req: Request, e: Env): Promise<Response> {
  const node = await authenticateExitNode(req, e);
  await recordExitAgentAsn(e, req, node?.name ?? null);
  const b = await body(req, 4 * 1024);
  rejectUnexpectedKeys(b, ['meteringProtocolVersion', 'observedAt']);
  const t = now();
  if (
    b.meteringProtocolVersion !== 2
    || typeof b.observedAt !== 'number'
    || !Number.isSafeInteger(b.observedAt)
    || b.observedAt > t
    || b.observedAt <= t - USAGE_METERING_NODE_READY_SECONDS
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid metering acknowledgement');
  }
  await e.DB.prepare(
    `UPDATE exit_nodes
     SET metering_protocol_version = 2,
         metering_last_seen_at = ?
     WHERE id = ? AND status = 'active'
       AND metering_last_seen_at < ?`,
  ).bind(b.observedAt, node!.id, b.observedAt).run();
  return Response.json({
    nodeId: node!.id,
    meteringProtocolVersion: 2,
    observedAt: b.observedAt,
  });
}
