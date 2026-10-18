import { type Env, type Row, now, id, requiredCatalogKey } from './env';
import { sha256, decryptCatalog } from './crypto';
import {
  CLIENT_UUID_PLACEHOLDER,
  catalogBaseName,
  filterCatalogYamlForUser,
  filterHy2CatalogForViewer,
  hy2CatalogEmailAllowlist,
  requestAcceptsHy2Catalog,
  retainCatalogProxies,
  splitManagedCatalogProxies,
  HY2_NAME_SUFFIX,
} from './catalog-yaml';
import { ApiError } from './errors';
import { hy2AutoSwitchForUser } from './hy2-auto-switch';

// Home-exit and binding writes change a user's served catalog (filtered node
// set) and its routing directive without touching the raw catalog YAML. The
// Windows client treats "same revision + different digest" as tampering and
// silently skips routing when the digest is unchanged, so every such write
// must advance the catalog revision to propagate. Unbound users re-install an
// identical catalog, which is harmless churn at this scale.
export async function bumpCatalogRevision(e: Env) {
  await e.DB.prepare(
    'UPDATE managed_exit_catalog SET revision = revision + 1, updated_at = ? WHERE singleton_id = 1',
  ).bind(now()).run();
}

export async function enqueueRefreshCatalogForUser(e: Env, userId: string) {
  const devices = await e.DB.prepare(
    "SELECT id FROM devices WHERE user_id = ? AND status != 'revoked'",
  ).bind(userId).all<Row>();
  const t = now();
  let queued = 0;
  for (const device of devices.results) {
    await e.DB.prepare(
      "INSERT INTO device_actions(id,user_id,device_id,action,status,created_at,expires_at) VALUES(?,?,?,?, 'pending', ?, ?)",
    ).bind(id(), userId, device.id, 'refresh_catalog', t, t + 300).run();
    queued += 1;
  }
  return queued;
}

// Same window as ops exit-token freshness. Defined here so the catalog gate
// does not import an ops handler. An exit that acknowledged a roster inside
// this window is still catching up to a newer credential (pending). Older
// than this, never acknowledged, disabled, or missing, it is unhealthy and
// must not keep every other exit's catalog at 503.
export const ROSTER_FRESH_SEC = 15 * 60;

type ExitAckRow = { name: string; status: string; lastRosterAt: number };
type ServedHome = { node: string; name: string };

function exitRowForBase(rows: ExitAckRow[], base: string): ExitAckRow | undefined {
  return rows.find((row) => row.name === base)
    ?? rows.find((row) => row.name === `${base}${HY2_NAME_SUFFIX}`);
}

function exitAckGate(
  row: ExitAckRow | undefined,
  createdAt: number,
  t: number,
): 'ready' | 'pending' | 'unhealthy' {
  if (!row || row.status !== 'active') return 'unhealthy';
  const ack = row.lastRosterAt;
  if (!Number.isSafeInteger(ack) || ack < 0) return 'unhealthy';
  if (ack > createdAt) return 'ready';
  if (ack > 0 && t - ack < ROSTER_FRESH_SEC) return 'pending';
  return 'unhealthy';
}

async function loadExitAckRows(e: Env, bases: string[]): Promise<ExitAckRow[]> {
  const names = [...new Set(bases.flatMap((base) => [base, `${base}${HY2_NAME_SUFFIX}`]))];
  if (names.length === 0) return [];
  const listed = await e.DB.prepare(
    `SELECT name, status, last_roster_at FROM exit_nodes
     WHERE name IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(names)).all<Row>();
  return listed.results.map((row) => ({
    name: String(row.name),
    status: String(row.status),
    lastRosterAt: Number(row.last_roster_at ?? 0),
  }));
}

// Cloud names are always tracked. A catalog home is tracked only when an
// exit_nodes row carries its base name or that name plus the hy2 suffix:
// the two tables share no uniqueness, so a home with no exit row must not
// invent an acknowledgement, and a home that shares an exit's name must
// not exempt that exit.
function trackedExitBases(rows: ExitAckRow[], servedNodes: string[], servedHomes: ServedHome[]): Set<string> {
  const tracked = new Set(servedNodes);
  for (const home of servedHomes) {
    if (exitRowForBase(rows, home.node)) tracked.add(home.node);
  }
  return tracked;
}

function readyExitBases(rows: ExitAckRow[], tracked: Set<string>, createdAt: number, t: number): Set<string> {
  const ready = new Set<string>();
  for (const base of tracked) {
    if (exitAckGate(exitRowForBase(rows, base), createdAt, t) === 'ready') ready.add(base);
  }
  return ready;
}

function keptExitBases(ready: Set<string>, tracked: Set<string>, servedHomes: ServedHome[]): Set<string> {
  const keep = new Set(ready);
  for (const home of servedHomes) {
    if (!tracked.has(home.node)) keep.add(home.node);
  }
  return keep;
}

export type AcknowledgedExitIdentity = { clientUuid: string; keep: Set<string> };

// The identity and the exit base names allowed to carry it. A ready exit
// (active, last_roster_at after this credential) is served. A pending exit
// (active and fresh, but not yet past this credential) is omitted while a
// sibling is ready, and holds the catalog at 503 when it is the only tracked
// exit. An unhealthy exit is omitted the same way and never holds a ready
// sibling closed. No ready exit at all stays 503: an unacknowledged UUID is
// not served, and a shared credential is still never minted here.
export async function selectAcknowledgedExitIdentity(
  e: Env,
  userId: string,
  deviceId: string,
  servedNodes: string[],
  servedHomes: ServedHome[],
): Promise<AcknowledgedExitIdentity> {
  await e.DB.prepare(
    `INSERT OR IGNORE INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
     SELECT id, user_id, ?, ? FROM devices
     WHERE id = ? AND user_id = ? AND status IN ('pending', 'active')`,
  ).bind(crypto.randomUUID(), now(), deviceId, userId).run();
  const row = await e.DB.prepare(
    `SELECT credentials.client_uuid, credentials.created_at
     FROM device_exit_credentials credentials
     JOIN devices ON devices.id = credentials.device_id
     WHERE credentials.device_id = ? AND credentials.user_id = ?
       AND devices.status IN ('pending', 'active')`,
  ).bind(deviceId, userId).first<Row>();
  if (!row) {
    throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device is no longer active');
  }
  const bases = [...new Set([...servedNodes, ...servedHomes.map((home) => home.node)])];
  const rows = await loadExitAckRows(e, bases);
  const tracked = trackedExitBases(rows, servedNodes, servedHomes);
  const t = now();
  const deviceReady = readyExitBases(rows, tracked, Number(row.created_at), t);
  if (deviceReady.size > 0) {
    return {
      clientUuid: String(row.client_uuid),
      keep: keptExitBases(deviceReady, tracked, servedHomes),
    };
  }
  if (await exitCredentialRolloutPhase(e) === 'dual' && !(await legacyExitCredentialRetired(e, userId))) {
    const shared = await e.DB.prepare(
      'SELECT client_uuid, created_at FROM exit_credentials WHERE user_id = ? AND retired_at IS NULL',
    ).bind(userId).first<Row>();
    if (shared) {
      const sharedReady = readyExitBases(rows, tracked, Number(shared.created_at), t);
      if (sharedReady.size > 0) {
        return {
          clientUuid: String(shared.client_uuid),
          keep: keptExitBases(sharedReady, tracked, servedHomes),
        };
      }
    }
  }
  throw new ApiError(
    503,
    'EXIT_IDENTITY_PROPAGATING',
    'Exit identity is waiting for a served exit node to acknowledge it',
  );
}

/// The identity this account presents at the exit, minted on first need.
///
/// Stable across fetches on purpose: the client persists the catalog digest and
/// compares it, so an identity that changed per request would look like a
/// tampered catalog every time.
///
/// `servedNodes` are the exit node names (hy2 folded to the base name) of the
/// catalog this response serves. A device catalog substitutes the returned
/// uuid only into the bases `selectAcknowledgedExitIdentity` keeps. A node
/// that is registered but not published is not dialed with it.
export async function exitClientUUID(
  e: Env,
  userId: string,
  deviceId?: string | null,
  servedNodes: string[] = [],
  servedHomes: Array<{ node: string; name: string }> = [],
): Promise<string> {
  if (deviceId) {
    // Callers that substitute this uuid must keep only `keep`. The device
    // catalog path does that in publicManagedCatalog; a uuid from here is
    // not safe to write into a node this selection omitted.
    return (await selectAcknowledgedExitIdentity(
      e, userId, deviceId, servedNodes, servedHomes,
    )).clientUuid;
  }
  if (await exitCredentialRolloutPhase(e) === 'device_only') {
    throw new ApiError(
      409,
      'DEVICE_IDENTITY_REQUIRED',
      'Device-only exit credentials are active for this deployment',
    );
  }
  const existing = await e.DB.prepare(
    'SELECT client_uuid, retired_at FROM exit_credentials WHERE user_id = ?',
  ).bind(userId).first<Row>();
  if (existing?.retired_at != null) {
    throw new ApiError(
      409,
      'DEVICE_IDENTITY_REQUIRED',
      'The shared exit identity of this account was retired by a device revocation',
    );
  }
  if (existing) return String(existing.client_uuid);
  const minted = crypto.randomUUID();
  // Legacy issuance remains available only while the explicit rollout state is
  // dual. It supports old operator workflows but is never used by an
  // authenticated device catalog, which always supplies deviceId above.
  await e.DB.prepare(
    `INSERT OR IGNORE INTO exit_credentials(user_id, client_uuid, created_at)
     SELECT id, ?, ? FROM users WHERE id = ?`,
  ).bind(minted, now(), userId).run();
  const row = await e.DB.prepare(
    'SELECT client_uuid FROM exit_credentials WHERE user_id = ? AND retired_at IS NULL',
  ).bind(userId).first<Row>();
  if (!row) throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Could not issue an exit identity');
  return String(row.client_uuid);
}

export async function legacyExitCredentialRetired(e: Env, userId: string) {
  const row = await e.DB.prepare(
    'SELECT 1 FROM exit_credentials WHERE user_id = ? AND retired_at IS NOT NULL',
  ).bind(userId).first<Row>();
  return row !== null;
}

export type CatalogRouting = {
  homeProxy?: string;
  defaultProxy?: string;
  // Full upstream credentials appear only here — inside the bound user's
  // own catalog. The ops/admin plaintext catalogs never carry them.
  homeSocks5?: { host: string; port: number; username: string; password: string };
};

export async function homeRoutingForUser(e: Env, userId: string) {
  const homes = await e.DB.prepare(
    'SELECT proxy_names_json FROM home_exit_catalog_names WHERE singleton_id = 1',
  ).first<Row>();
  let proxyNames: unknown = [];
  try {
    proxyNames = JSON.parse(String(homes?.proxy_names_json ?? '[]'));
  } catch {
    throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Home exit catalog index is invalid');
  }
  if (!Array.isArray(proxyNames) || proxyNames.some((name) => typeof name !== 'string')) {
    throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Home exit catalog index is invalid');
  }
  const restricted = new Set(proxyNames);
  const binding = await e.DB.prepare(
    `SELECT home_exits.proxy_name, home_exits.kind, home_exits.status AS home_status,
            home_exits.socks5_host, home_exits.socks5_port,
            home_exits.socks5_username, home_exits.socks5_password,
            user_home_bindings.default_proxy_name
     FROM user_home_bindings
     LEFT JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
     WHERE user_home_bindings.user_id = ?`,
  ).bind(userId).first<Row>();
  const allowed = new Set<string>();
  let routing: CatalogRouting | undefined;
  if (binding) {
    // A disabled/missing assigned exit is not an explicit unbind. Returning
    // an otherwise healthy cloud-only catalog would silently change identity.
    if (binding.home_status !== 'active') {
      throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Assigned home exit is unavailable');
    }
    allowed.add(String(binding.proxy_name));
    const directives: CatalogRouting = {};
    if (String(binding.kind ?? 'catalog') === 'socks5') {
      directives.homeSocks5 = {
        host: String(binding.socks5_host),
        port: Number(binding.socks5_port),
        username: String(binding.socks5_username),
        password: String(binding.socks5_password),
      };
    } else {
      directives.homeProxy = String(binding.proxy_name);
    }
    if (binding.default_proxy_name != null && binding.default_proxy_name !== '') {
      directives.defaultProxy = String(binding.default_proxy_name);
    }
    routing = directives;
  }
  return { routing, restricted, allowed };
}

async function userMaySeeHy2Catalog(e: Env, userId: string): Promise<boolean> {
  const allow = hy2CatalogEmailAllowlist(e.HY2_CATALOG_EMAILS);
  if (allow.size === 0) return true;
  const row = await e.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<Row>();
  const email = String(row?.email ?? '').trim().toLowerCase();
  return email.length > 0 && allow.has(email);
}

// Rotating HY2_CATALOG_EMAILS changes the served YAML (and therefore sha256)
// for accounts that enter or leave the gray list. Bump the fleet revision
// after that env change or Windows treats "same revision, new digest" as
// tampering. Only clients that send `X-Tono-Accept: hy2` keep hy2 blocks; a
// set gray list narrows those further. The list never admits a client that
// did not declare hy2: 0.0.72 omits the header and rejects the whole catalog
// on one hy2 block. Production still must not PUT hy2 blocks until a Worker
// with this filter is live.

// The routing document is per-account server state that the fleet-wide catalog
// revision does not describe: a rebind, a default-proxy change or a credential
// rotation can leave both `revision` and the served `sha256` exactly where they
// were. Clients key catalog freshness on (revision, sha256), so a routing-only
// rotation would otherwise be invisible and the client would keep dialing
// retired credentials. `routingSha256` is the third component of that key — it
// digests the served routing directives, and the empty document has a digest of
// its own so an unbind moves the field back rather than dropping it.
export async function routingSha256(routing: CatalogRouting | undefined) {
  const socks5 = routing?.homeSocks5;
  return sha256([
    routing?.homeProxy ?? '',
    routing?.defaultProxy ?? '',
    socks5
      ? [socks5.host, String(socks5.port), socks5.username, socks5.password].join('\n')
      : '',
  ].join('\n'));
}

/**
 * The served exit catalog.
 *
 * - `revision` is fleet-wide and moves for every account at once.
 * - `sha256` covers the served proxies YAML, which is per account: the same
 *   revision legitimately yields different digests for two users, because the
 *   client identity is substituted and restricted home exits are filtered out.
 * - `routingSha256` covers the sibling routing document and is present only on
 *   the per-account view (the ops/admin plaintext catalog carries no routing).
 *   It moves on its own when routing rotates under an unchanged revision.
 * - `hy2AutoSwitch` (per-account view only) permits the client to fall back on
 *   its own to the ` · hy2` block of the same node (A18, D1-C). It is outside
 *   both digests on purpose — older clients verify `routingSha256` against a
 *   fixed recipe — so clients read it from every response, including one
 *   whose (revision, sha256, routingSha256) key is unchanged.
 */
export function routingWithoutOmittedProxies(
  routing: CatalogRouting | undefined,
  keep: ReadonlySet<string>,
): CatalogRouting | undefined {
  if (!routing) return undefined;
  const next: CatalogRouting = { ...routing };
  if (next.homeProxy && !keep.has(catalogBaseName(next.homeProxy))) delete next.homeProxy;
  if (next.defaultProxy && !keep.has(catalogBaseName(next.defaultProxy))) delete next.defaultProxy;
  if (!next.homeProxy && !next.defaultProxy && !next.homeSocks5) return undefined;
  return next;
}

export async function publicManagedCatalog(
  e: Env,
  options?: {
    userId?: string;
    deviceId?: string | null;
    filterHomeExits?: boolean;
    acceptHy2?: boolean;
    hy2AcceptHeader?: string | null;
  },
) {
  const row = await e.DB.prepare(
    'SELECT revision, ciphertext, nonce, content_sha256, updated_at FROM managed_exit_catalog WHERE singleton_id = 1',
  ).first<Row>();
  let yaml = 'proxies: []\n';
  let digest = await sha256(yaml);
  let updatedAt: number | undefined;
  let revision = 0;
  if (row) {
    try {
      yaml = await decryptCatalog(
        String(row.ciphertext),
        String(row.nonce),
        requiredCatalogKey(e),
      );
    } catch {
      throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog is unavailable');
    }
    digest = await sha256(yaml);
    if (digest !== row.content_sha256) {
      throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog failed integrity validation');
    }
    revision = Number(row.revision);
    updatedAt = Number(row.updated_at);
  }
  let served = yaml;
  let routing: CatalogRouting | undefined;
  let homeNames = new Set<string>();
  const routedUserId = options?.filterHomeExits ? options.userId : undefined;
  if (routedUserId) {
    const home = await homeRoutingForUser(e, routedUserId);
    routing = home.routing;
    homeNames = home.restricted;
    if (home.restricted.size > 0) {
      served = filterCatalogYamlForUser(served, home.restricted, home.allowed);
    }
  }
  let hy2AutoSwitch: boolean | undefined;
  if (options?.userId) {
    const keepHy2 = (Boolean(options.acceptHy2) || requestAcceptsHy2Catalog(options.hy2AcceptHeader))
      && (await userMaySeeHy2Catalog(e, options.userId));
    served = filterHy2CatalogForViewer(served, keepHy2);
    // A permission over blocks this response actually carries: a viewer whose
    // hy2 blocks were stripped, or whose only hy2 pair was a restricted home
    // exit filtered out above, is told `false`, never a stale `true`.
    hy2AutoSwitch = keepHy2
      && splitManagedCatalogProxies(served).items.some((item) => item.name.endsWith(HY2_NAME_SUFFIX))
      && (await hy2AutoSwitchForUser(e, options.userId));
  }
  // The stored digest authenticates the catalog template. Authenticated clients
  // receive a stable per-account identity, so recompute the digest after
  // substitution and any per-user filtering. The identity is issued after
  // filtering so its readiness covers exactly the exit nodes this response
  // serves. A catalog home (a name the home filter restricts) is a home_exits
  // row, and nothing ties it to an exit_nodes acknowledgement, so it is left
  // out unless an exit node shares its name; a catalog that serves no exit
  // node stays fail-closed. A served list with no proxies issues nothing,
  // even if a comment keeps the placeholder.
  const servedItems = options?.userId && served.includes(CLIENT_UUID_PLACEHOLDER)
    ? splitManagedCatalogProxies(served).items
    : [];
  if (options?.userId && servedItems.length > 0) {
    const servedNodes = new Set<string>();
    const servedHomes: Array<{ node: string; name: string }> = [];
    for (const item of servedItems) {
      const node = catalogBaseName(item.name);
      if (homeNames.has(item.name) || homeNames.has(node)) servedHomes.push({ node, name: item.name });
      else servedNodes.add(node);
    }
    if (options.deviceId) {
      const selected = await selectAcknowledgedExitIdentity(
        e, options.userId, options.deviceId, [...servedNodes], servedHomes,
      );
      served = retainCatalogProxies(served, selected.keep);
      routing = routingWithoutOmittedProxies(routing, selected.keep);
      if (
        hy2AutoSwitch
        && !splitManagedCatalogProxies(served).items.some((item) => item.name.endsWith(HY2_NAME_SUFFIX))
      ) {
        hy2AutoSwitch = false;
      }
      served = served.split(CLIENT_UUID_PLACEHOLDER).join(selected.clientUuid);
    } else {
      const issued = await exitClientUUID(e, options.userId, null, [...servedNodes], servedHomes);
      served = served.split(CLIENT_UUID_PLACEHOLDER).join(issued);
    }
  }
  return {
    revision,
    yaml: served,
    sha256: served === yaml ? digest : await sha256(served),
    updatedAt,
    ...(routedUserId ? { routingSha256: await routingSha256(routing) } : {}),
    ...(routing ? { routing } : {}),
    ...(hy2AutoSwitch === undefined ? {} : { hy2AutoSwitch }),
  };
}

export async function exitCredentialRolloutPhase(e: Env): Promise<'dual' | 'device_only'> {
  const row = await e.DB.prepare(
    'SELECT phase FROM exit_credential_rollout WHERE singleton_id = 1',
  ).first<Row>();
  return row?.phase === 'device_only' ? 'device_only' : 'dual';
}
