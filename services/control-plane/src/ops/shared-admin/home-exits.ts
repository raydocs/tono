import { queryHomeProbeHistory } from '../../ops-timeseries';
import { ApiError } from '../../errors';
import {
  type Env,
  type Row,
  now,
  id,
  str,
} from '../../env';
import {
  bumpCatalogRevision,
  enqueueRefreshCatalogForUser,
} from '../../catalog';
import {
  optionalIpv4,
  proxyNameField,
  defaultProxyNameField,
  socks5HostField,
  socks5PortField,
  validateHomeSocks5,
  publicHomeExit,
  publicHomeBinding,
  parseHomeLine,
  loadHomeBinding,
  findSocks5Home,
  insertSocks5HomeExit,
  upsertHomeBinding,
} from '../../home';
import {
  writeOpsAudit,
} from '../../product-account';
import { rejectUnexpectedKeys, body } from '../../request';

export async function homeExitsResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
): Promise<Response | null> {
  let mt: RegExpMatchArray | null;
  if (resource === 'home-exits' && m === 'GET') {
    const q = await e.DB.prepare(
      `SELECT home_exits.*,
              (SELECT COUNT(*) FROM user_home_bindings WHERE home_exit_id = home_exits.id) AS bind_count
       FROM home_exits
       ORDER BY status ASC, display_name ASC, created_at ASC`,
    ).all<Row>();
    const exits = q.results.map(publicHomeExit);
    try {
      // The lifetime ratio hides a line that died last week behind months of
      // green history, so a seven-day window travels alongside it — counted in
      // the same pass rather than a second scan.
      const weekAgo = now() - 7 * 86_400;
      const stats = await e.DB.prepare(
        `SELECT home_exit_id,
                SUM(CASE WHEN status = 'alive' THEN 1 ELSE 0 END) AS alive,
                COUNT(*) AS total,
                SUM(CASE WHEN probed_at >= ? AND status = 'alive' THEN 1 ELSE 0 END) AS alive_7d,
                SUM(CASE WHEN probed_at >= ? THEN 1 ELSE 0 END) AS total_7d
         FROM operations_home_probe_samples
         GROUP BY home_exit_id`,
      ).bind(weekAgo, weekAgo).all<Row>();
      const byId = new Map(stats.results.map((row) => [String(row.home_exit_id), row]));
      return Response.json({
        homeExits: exits.map((exit) => {
          const row = byId.get(exit.id);
          if (!row) return exit;
          const alive = Number(row.alive);
          const total = Number(row.total);
          const alive7d = Number(row.alive_7d);
          const total7d = Number(row.total_7d);
          return {
            ...exit,
            probeAlive: alive,
            probeTotal: total,
            probeUptimeRatio: total > 0 ? alive / total : undefined,
            probeAlive7d: alive7d,
            probeTotal7d: total7d,
            probeUptimeRatio7d: total7d > 0 ? alive7d / total7d : undefined,
          };
        }),
      });
    } catch (error) {
      if (!String(error).includes('no such table')) throw error;
      return Response.json({ homeExits: exits });
    }
  }
  if (resource === 'home-exits' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    const proxyName = proxyNameField(b.proxyName);
    const displayName = str(b.displayName, 'displayName', 1, 200).trim();
    const egressIpv4 = optionalIpv4(b.egressIpv4, 'egressIpv4');
    const kind = b.kind === undefined ? 'catalog' : str(b.kind, 'kind', 1, 20);
    if (!['catalog', 'socks5'].includes(kind)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid kind');
    }
    const socks5Host = b.socks5Host === undefined || b.socks5Host === null || b.socks5Host === ''
      ? null
      : socks5HostField(b.socks5Host);
    const socks5Port = b.socks5Port === undefined || b.socks5Port === null
      ? null
      : socks5PortField(b.socks5Port);
    const socks5Username = b.socks5Username === undefined || b.socks5Username === null || b.socks5Username === ''
      ? null
      : str(b.socks5Username, 'socks5Username', 1, 255);
    const socks5Password = b.socks5Password === undefined || b.socks5Password === null || b.socks5Password === ''
      ? null
      : str(b.socks5Password, 'socks5Password', 1, 255);
    validateHomeSocks5(kind, socks5Host, socks5Port, socks5Username, socks5Password);
    const notes = b.notes === undefined || b.notes === null || b.notes === ''
      ? null
      : str(b.notes, 'notes', 1, 1000);
    const status = b.status === undefined ? 'active' : str(b.status, 'status', 1, 20);
    if (!['active', 'disabled', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    const homeId = id();
    const t = now();
    try {
      await e.DB.prepare(
        `INSERT INTO home_exits(
           id, proxy_name, display_name, egress_ipv4, kind,
           socks5_host, socks5_port, socks5_username, socks5_password,
           status, notes, created_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        homeId, proxyName, displayName, egressIpv4, kind,
        socks5Host, socks5Port, socks5Username, socks5Password,
        status, notes, t, t,
      ).run();
    } catch {
      throw new ApiError(409, 'HOME_EXIT_CONFLICT', 'A home exit with this proxyName already exists');
    }
    const row = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(homeId).first<Row>();
    await bumpCatalogRevision(e);
    await writeOpsAudit(e, actorEmail, 'home.create', 'home_exit', homeId, displayName);
    return Response.json({ homeExit: publicHomeExit(row!) }, { status: 201 });
  }
  if (resource === 'home-exits/assign' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['userId', 'line', 'displayName', 'defaultProxyName', 'replace']);
    const userId = str(b.userId, 'userId', 1, 100);
    const parsed = parseHomeLine(b.line);
    if (b.replace !== undefined && typeof b.replace !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid replace');
    }
    const replace = b.replace === true;
    const user = await e.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(userId).first<Row>();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    const current = await loadHomeBinding(e, userId);
    if (current && !replace) {
      throw new ApiError(409, 'HOME_ALREADY_BOUND', 'User already has a home exit; pass replace=true to swap it');
    }
    const defaultProxyName = b.defaultProxyName === undefined && current
      ? (current.default_proxy_name == null || current.default_proxy_name === ''
        ? null
        : String(current.default_proxy_name))
      : await defaultProxyNameField(e, b.defaultProxyName);
    const emailLocal = String(user.email).split('@')[0] || 'user';
    const displayName = b.displayName === undefined || b.displayName === null || b.displayName === ''
      ? `家宽 · ${emailLocal}`
      : str(b.displayName, 'displayName', 1, 200).trim();

    let home = await findSocks5Home(e, parsed.host, parsed.port, parsed.username);
    let createdHome = false;
    if (home) {
      const owner = await e.DB.prepare(
        'SELECT user_id FROM user_home_bindings WHERE home_exit_id = ?',
      ).bind(home.id).first<Row>();
      if (owner && String(owner.user_id) !== userId) {
        throw new ApiError(409, 'HOME_EXIT_IN_USE', 'This home line is already assigned to another user');
      }
      if (String(home.status) !== 'active') {
        await e.DB.prepare(
          'UPDATE home_exits SET status = ?, display_name = ?, notes = ?, updated_at = ? WHERE id = ?',
        ).bind('active', displayName, parsed.notes ?? home.notes, now(), home.id).run();
        home = (await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(home.id).first<Row>())!;
      }
    } else {
      home = await insertSocks5HomeExit(e, parsed, displayName);
      createdHome = true;
    }

    const previousHomeId = current ? String(current.home_exit_id) : null;
    const bound = await upsertHomeBinding(e, userId, String(home.id), defaultProxyName);
    let retiredHomeExitId: string | undefined;
    if (previousHomeId && previousHomeId !== String(home.id)) {
      const stillUsed = await e.DB.prepare(
        'SELECT 1 FROM user_home_bindings WHERE home_exit_id = ? LIMIT 1',
      ).bind(previousHomeId).first<Row>();
      if (!stillUsed) {
        await e.DB.prepare(
          "UPDATE home_exits SET status = 'retired', updated_at = ? WHERE id = ?",
        ).bind(now(), previousHomeId).run();
        retiredHomeExitId = previousHomeId;
      }
    }
    await bumpCatalogRevision(e);
    const binding = await loadHomeBinding(e, userId);
    const refreshQueued = await enqueueRefreshCatalogForUser(e, userId);
    const swapped = Boolean(previousHomeId && previousHomeId !== String(home.id));
    await writeOpsAudit(
      e, actorEmail, swapped ? 'home.replace' : 'home.assign', 'user', userId,
      swapped ? `replaced home for ${user.email}` : `assigned home for ${user.email}`,
    );
    return Response.json({
      homeExit: publicHomeExit(home),
      binding: publicHomeBinding(binding!),
      created: createdHome,
      replaced: swapped,
      retiredHomeExitId,
      refreshQueued,
    }, { status: createdHome || bound.created ? 201 : 200 });
  }
  if (resource === 'home-exits/import' && m === 'POST') {
    const b = await body(req, 32 * 1024);
    rejectUnexpectedKeys(b, ['lines']);
    if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 50) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'lines must be an array of 1–50 strings');
    }
    const created: ReturnType<typeof publicHomeExit>[] = [];
    const skipped: Array<{ host?: string; port?: number; username?: string; message: string }> = [];
    const failed: Array<{ message: string }> = [];
    for (const raw of b.lines) {
      try {
        const parsed = parseHomeLine(raw);
        const existing = await findSocks5Home(e, parsed.host, parsed.port, parsed.username);
        if (existing) {
          skipped.push({
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
            message: 'already exists',
          });
          continue;
        }
        const displayName = parsed.notes && parsed.notes.length <= 200
          ? parsed.notes
          : `家宽 · ${parsed.host}`;
        const row = await insertSocks5HomeExit(e, parsed, displayName);
        created.push(publicHomeExit(row));
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'Invalid home line';
        failed.push({ message });
      }
    }
    if (created.length > 0) {
      await bumpCatalogRevision(e);
      await writeOpsAudit(
        e, actorEmail, 'home.import', 'home_exit', null,
        `imported ${created.length} (skipped ${skipped.length}, failed ${failed.length})`,
      );
    }
    return Response.json({ created, skipped, failed }, { status: created.length > 0 ? 201 : 200 });
  }
  mt = resource.match(/^home-exits\/([^/]+)\/probes$/);
  if (mt && m === 'GET') {
    const existing = await e.DB.prepare('SELECT id FROM home_exits WHERE id = ?').bind(mt[1]).first<Row>();
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    const range = new URL(req.url).searchParams.get('range');
    if (range !== null && !['24h', '7d', '90d'].includes(range)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported probes range');
    }
    return Response.json({ probes: await queryHomeProbeHistory(e.DB, mt[1], now(), range) });
  }
  mt = resource.match(/^home-exits\/([^/]+)$/);
  if (mt && m === 'PATCH') {
    const b = await body(req, 8 * 1024);
    const existing = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(mt[1]).first<Row>();
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    const proxyName = b.proxyName === undefined ? String(existing.proxy_name) : proxyNameField(b.proxyName);
    const displayName = b.displayName === undefined
      ? String(existing.display_name)
      : str(b.displayName, 'displayName', 1, 200).trim();
    const egressIpv4 = b.egressIpv4 === undefined
      ? (existing.egress_ipv4 == null ? null : String(existing.egress_ipv4))
      : optionalIpv4(b.egressIpv4, 'egressIpv4');
    const notes = b.notes === undefined
      ? (existing.notes == null ? null : String(existing.notes))
      : (b.notes === null || b.notes === '' ? null : str(b.notes, 'notes', 1, 1000));
    const status = b.status === undefined ? String(existing.status) : str(b.status, 'status', 1, 20);
    if (!['active', 'disabled', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    const kind = b.kind === undefined ? String(existing.kind ?? 'catalog') : str(b.kind, 'kind', 1, 20);
    if (!['catalog', 'socks5'].includes(kind)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid kind');
    }
    // Omitted socks5 fields keep their stored values; switching back to
    // catalog wipes them.
    const keep = kind === 'socks5';
    const socks5Host = b.socks5Host === undefined
      ? (keep && existing.socks5_host != null ? String(existing.socks5_host) : null)
      : (b.socks5Host === null || b.socks5Host === '' ? null : socks5HostField(b.socks5Host));
    const socks5Port = b.socks5Port === undefined
      ? (keep && existing.socks5_port != null ? Number(existing.socks5_port) : null)
      : (b.socks5Port === null ? null : socks5PortField(b.socks5Port));
    const socks5Username = b.socks5Username === undefined
      ? (keep && existing.socks5_username != null ? String(existing.socks5_username) : null)
      : (b.socks5Username === null || b.socks5Username === '' ? null : str(b.socks5Username, 'socks5Username', 1, 255));
    const socks5Password = b.socks5Password === undefined
      ? (keep && existing.socks5_password != null ? String(existing.socks5_password) : null)
      : (b.socks5Password === null || b.socks5Password === '' ? null : str(b.socks5Password, 'socks5Password', 1, 255));
    validateHomeSocks5(kind, socks5Host, socks5Port, socks5Username, socks5Password);
    const t = now();
    try {
      const updated = await e.DB.prepare(
        `UPDATE home_exits
         SET proxy_name = ?, display_name = ?, egress_ipv4 = ?, kind = ?,
             socks5_host = ?, socks5_port = ?, socks5_username = ?, socks5_password = ?,
             status = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(
        proxyName, displayName, egressIpv4, kind,
        socks5Host, socks5Port, socks5Username, socks5Password,
        status, notes, t, mt[1],
      ).run();
      if (!updated.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(409, 'HOME_EXIT_CONFLICT', 'A home exit with this proxyName already exists');
    }
    const row = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(mt[1]).first<Row>();
    await bumpCatalogRevision(e);
    return Response.json({ homeExit: publicHomeExit(row!) });
  }
  if (mt && m === 'DELETE') {
    const bound = await e.DB.prepare(
      'SELECT 1 FROM user_home_bindings WHERE home_exit_id = ? LIMIT 1',
    ).bind(mt[1]).first<Row>();
    if (bound) {
      throw new ApiError(409, 'HOME_EXIT_IN_USE', 'Unbind all users before deleting this home exit');
    }
    const deleted = await e.DB.prepare('DELETE FROM home_exits WHERE id = ?').bind(mt[1]).run();
    if (!deleted.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    await bumpCatalogRevision(e);
    return new Response(null, { status: 204 });
  }
  if (resource === 'home-bindings' && m === 'GET') {
    const q = await e.DB.prepare(
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
       ORDER BY users.email ASC`,
    ).all<Row>();
    return Response.json({ bindings: q.results.map(publicHomeBinding) });
  }
  mt = resource.match(/^users\/([^/]+)\/home-binding$/);
  if (mt && m === 'GET') {
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
  if (mt && m === 'PUT') {
    const b = await body(req, 8 * 1024);
    const user = await e.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(mt[1]).first<Row>();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    let homeExitId: string | undefined;
    if (b.homeExitId !== undefined) {
      homeExitId = str(b.homeExitId, 'homeExitId', 1, 100);
    } else if (b.proxyName !== undefined) {
      const byName = await e.DB.prepare(
        'SELECT id FROM home_exits WHERE proxy_name = ?',
      ).bind(proxyNameField(b.proxyName)).first<Row>();
      if (!byName) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
      homeExitId = String(byName.id);
    } else {
      throw new ApiError(400, 'VALIDATION_ERROR', 'homeExitId or proxyName is required');
    }
    const home = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(homeExitId).first<Row>();
    if (!home) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    if (String(home.status) !== 'active') {
      throw new ApiError(409, 'HOME_EXIT_INACTIVE', 'Home exit must be active before binding');
    }
    const defaultProxyName = await defaultProxyNameField(e, b.defaultProxyName);
    const t = now();
    const existing = await e.DB.prepare(
      'SELECT created_at FROM user_home_bindings WHERE user_id = ?',
    ).bind(mt[1]).first<Row>();
    if (existing) {
      await e.DB.prepare(
        `UPDATE user_home_bindings
         SET home_exit_id = ?, default_proxy_name = ?, updated_at = ?
         WHERE user_id = ?`,
      ).bind(homeExitId, defaultProxyName, t, mt[1]).run();
    } else {
      await e.DB.prepare(
        `INSERT INTO user_home_bindings(user_id, home_exit_id, default_proxy_name, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?)`,
      ).bind(mt[1], homeExitId, defaultProxyName, t, t).run();
    }
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
    await bumpCatalogRevision(e);
    await writeOpsAudit(
      e, actorEmail, existing ? 'home.replace' : 'home.assign', 'user', mt[1],
      existing ? `replaced home for ${user.email}` : `assigned home for ${user.email}`,
    );
    return Response.json({ binding: publicHomeBinding(row!) }, { status: existing ? 200 : 201 });
  }
  if (mt && m === 'DELETE') {
    const deleted = await e.DB.prepare(
      'DELETE FROM user_home_bindings WHERE user_id = ?',
    ).bind(mt[1]).run();
    if (!deleted.meta.changes) {
      const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(mt[1]).first<Row>();
      if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    } else {
      await bumpCatalogRevision(e);
      await writeOpsAudit(e, actorEmail, 'home.unbind', 'user', mt[1], 'removed home binding');
    }
    return new Response(null, { status: 204 });
  }
  return null;
}
