import { type Env, type Row, now, id, requiredCatalogKey } from './env';
import { sha256, decryptCatalog } from './crypto';
import { CLIENT_UUID_PLACEHOLDER, filterCatalogYamlForUser } from './catalog-yaml';
import { ApiError } from './errors';

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

/// The identity this account presents at the exit, minted on first need.
///
/// Stable across fetches on purpose: the client persists the catalog digest and
/// compares it, so an identity that changed per request would look like a
/// tampered catalog every time.
export async function exitClientUUID(e: Env, userId: string, deviceId?: string | null): Promise<string> {
  if (deviceId) {
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
    const readiness = await e.DB.prepare(
      `SELECT COUNT(*) AS active_nodes,
              SUM(CASE WHEN last_roster_at <= ? THEN 1 ELSE 0 END) AS unready_nodes
       FROM exit_nodes WHERE status = 'active'`,
    ).bind(Number(row.created_at)).first<Row>();
    if (Number(readiness?.active_nodes ?? 0) < 1 || Number(readiness?.unready_nodes ?? 0) > 0) {
      // During the dual phase, keep existing and newly logging-in clients on
      // the per-user credential until the device credential is confirmed on
      // every exit. This makes the first deployment non-disruptive: exit nodes
      // and their tokens can only be provisioned after these endpoints exist.
      if (await exitCredentialRolloutPhase(e) === 'dual') {
        return exitClientUUID(e, userId, null);
      }
      throw new ApiError(
        503,
        'EXIT_IDENTITY_PROPAGATING',
        'Exit identity is waiting for every active node to acknowledge it',
      );
    }
    return String(row.client_uuid);
  }
  if (await exitCredentialRolloutPhase(e) === 'device_only') {
    throw new ApiError(
      409,
      'DEVICE_IDENTITY_REQUIRED',
      'Device-only exit credentials are active for this deployment',
    );
  }
  const existing = await e.DB.prepare(
    'SELECT client_uuid FROM exit_credentials WHERE user_id = ?',
  ).bind(userId).first<Row>();
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
    'SELECT client_uuid FROM exit_credentials WHERE user_id = ?',
  ).bind(userId).first<Row>();
  if (!row) throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Could not issue an exit identity');
  return String(row.client_uuid);
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
 */
export async function publicManagedCatalog(
  e: Env,
  options?: { userId?: string; deviceId?: string | null; filterHomeExits?: boolean },
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
  // The stored digest authenticates the catalog template. Authenticated clients
  // receive a stable per-account identity, so recompute the digest after
  // substitution and any per-user home-exit filtering.
  if (options?.userId && served.includes(CLIENT_UUID_PLACEHOLDER)) {
    const issued = await exitClientUUID(e, options.userId, options.deviceId);
    served = served.split(CLIENT_UUID_PLACEHOLDER).join(issued);
  }
  let routing: CatalogRouting | undefined;
  const routedUserId = options?.filterHomeExits ? options.userId : undefined;
  if (routedUserId) {
    const home = await homeRoutingForUser(e, routedUserId);
    routing = home.routing;
    if (home.restricted.size > 0) {
      served = filterCatalogYamlForUser(served, home.restricted, home.allowed);
    }
  }
  return {
    revision,
    yaml: served,
    sha256: served === yaml ? digest : await sha256(served),
    updatedAt,
    ...(routedUserId ? { routingSha256: await routingSha256(routing) } : {}),
    ...(routing ? { routing } : {}),
  };
}

export async function exitCredentialRolloutPhase(e: Env): Promise<'dual' | 'device_only'> {
  const row = await e.DB.prepare(
    'SELECT phase FROM exit_credential_rollout WHERE singleton_id = 1',
  ).first<Row>();
  return row?.phase === 'device_only' ? 'device_only' : 'dual';
}
