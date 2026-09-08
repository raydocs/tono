import { type Env, type Row, now, id, str } from './env';
import { ApiError } from './errors';

export function optionalIpv4(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const address = str(value, field, 7, 45).trim();
  const parts = address.split('.');
  if (
    parts.length !== 4 ||
    parts.some((part) => {
      if (!/^\d{1,3}$/.test(part)) return true;
      const n = Number(part);
      return n > 255 || (part.length > 1 && part.startsWith('0'));
    })
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${field}`);
  }
  return address;
}

export function proxyNameField(value: unknown): string {
  const name = str(value, 'proxyName', 1, 200).trim();
  if (!name || /[\r\n\0]/.test(name)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid proxyName');
  }
  return name;
}

export async function defaultProxyNameField(e: Env, value: unknown): Promise<string | null> {
  if (value === undefined || value === null || value === '') return null;
  const name = str(value, 'defaultProxyName', 1, 200);
  const clash = await e.DB.prepare(
    'SELECT 1 FROM home_exits WHERE proxy_name = ?',
  ).bind(name).first<Row>();
  if (clash) {
    throw new ApiError(400, 'INVALID_DEFAULT_PROXY', 'defaultProxyName must not match any home exit proxyName');
  }
  return name;
}

// A socks5 upstream host is a public IPv4 literal or a plain hostname (the
// residential gateway is always a public address; it is dialed through the
// tunnel, never directly). Keep the grammar intentionally narrow.
export function socks5HostField(value: unknown): string {
  const host = str(value, 'socks5Host', 1, 253).trim();
  const ipv4 = host.split('.');
  const isIpv4 =
    ipv4.length === 4 &&
    ipv4.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const n = Number(part);
      return n <= 255 && (part.length === 1 || !part.startsWith('0'));
    });
  const isHostname =
    /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(host) &&
    // A dotted all-numeric string that is not a valid IPv4 literal is not a
    // hostname either — it is a mistyped address.
    !/^[0-9.]+$/.test(host);
  if (!isIpv4 && !isHostname) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid socks5Host');
  }
  return host;
}

export function socks5PortField(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid socks5Port');
  }
  return value as number;
}

// kind='socks5' requires all four upstream fields; kind='catalog' forbids them.
export function validateHomeSocks5(
  kind: string,
  host: string | null,
  port: number | null,
  username: string | null,
  password: string | null,
) {
  if (kind === 'socks5') {
    if (host === null || port === null || username === null || password === null) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'socks5Host, socks5Port, socks5Username and socks5Password are required when kind is socks5');
    }
    return;
  }
  if (host !== null || port !== null || username !== null || password !== null) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'socks5 fields require kind to be socks5');
  }
}

export function publicHomeExit(row: Row) {
  return {
    id: String(row.id),
    proxyName: String(row.proxy_name),
    displayName: String(row.display_name),
    egressIpv4: row.egress_ipv4 == null ? undefined : String(row.egress_ipv4),
    kind: String(row.kind ?? 'catalog'),
    // Credentials (socks5Username/socks5Password) are never echoed back by any
    // GET endpoint; they only ride the bound user's own catalog routing.
    socks5Host: row.socks5_host == null ? undefined : String(row.socks5_host),
    socks5Port: row.socks5_port == null ? undefined : Number(row.socks5_port),
    status: String(row.status),
    notes: row.notes == null || row.notes === '' ? undefined : String(row.notes),
    bindCount: row.bind_count === undefined || row.bind_count === null ? undefined : Number(row.bind_count),
    lastProbedAt: row.last_probed_at == null ? undefined : Number(row.last_probed_at),
    probeStatus: row.probe_status == null ? undefined : String(row.probe_status),
    probeAlive: row.probe_alive == null ? undefined : Number(row.probe_alive),
    probeTotal: row.probe_total == null ? undefined : Number(row.probe_total),
    probeUptimeRatio: row.probe_uptime_ratio == null ? undefined : Number(row.probe_uptime_ratio),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function publicHomeBinding(row: Row) {
  return {
    userId: String(row.user_id),
    email: row.email == null ? undefined : String(row.email),
    homeExitId: String(row.home_exit_id),
    proxyName: String(row.proxy_name),
    displayName: String(row.display_name),
    egressIpv4: row.egress_ipv4 == null ? undefined : String(row.egress_ipv4),
    kind: row.kind == null ? undefined : String(row.kind),
    socks5Host: row.socks5_host == null ? undefined : String(row.socks5_host),
    socks5Port: row.socks5_port == null ? undefined : Number(row.socks5_port),
    defaultProxyName: row.default_proxy_name == null || row.default_proxy_name === ''
      ? undefined
      : String(row.default_proxy_name),
    homeStatus: String(row.home_status ?? row.status),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export type ParsedHomeLine = {
  host: string;
  port: number;
  username: string;
  password: string;
  notes: string | null;
};

export function parseHomeLine(raw: unknown): ParsedHomeLine {
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'INVALID_HOME_LINE', 'Home line must be a string');
  }
  const line = raw.trim().replace(/^\uFEFF/, '').replace(/^['"]|['"]$/g, '').trim();
  if (!line || line.length > 2_000) {
    throw new ApiError(400, 'INVALID_HOME_LINE', 'Home line is empty or too long');
  }

  let host = '';
  let port = 0;
  let username = '';
  let password = '';
  let notes: string | null = null;

  if (/^socks5:\/\//i.test(line)) {
    let url: URL;
    try {
      url = new URL(line);
    } catch {
      throw new ApiError(400, 'INVALID_HOME_LINE', 'Invalid socks5 URL');
    }
    host = url.hostname;
    port = Number(url.port);
    try {
      username = decodeURIComponent(url.username);
      password = decodeURIComponent(url.password);
    } catch {
      throw new ApiError(400, 'INVALID_HOME_LINE', 'Invalid socks5 URL credentials');
    }
  } else if (line.includes('@')) {
    const at = line.lastIndexOf('@');
    const auth = line.slice(0, at);
    const hostport = line.slice(at + 1);
    const colon = auth.indexOf(':');
    const hp = hostport.lastIndexOf(':');
    if (colon < 1 || hp < 1) {
      throw new ApiError(400, 'INVALID_HOME_LINE', 'Expected user:pass@host:port');
    }
    username = auth.slice(0, colon);
    password = auth.slice(colon + 1);
    host = hostport.slice(0, hp);
    port = Number(hostport.slice(hp + 1));
  } else {
    const parts = line.split(':');
    if (parts.length !== 4 && parts.length !== 5) {
      throw new ApiError(400, 'INVALID_HOME_LINE', 'Expected host:port:user:pass');
    }
    host = parts[0];
    port = Number(parts[1]);
    username = parts[2];
    password = parts[3];
    notes = parts[4] !== undefined && parts[4] !== '' ? parts[4] : null;
  }

  if (!username || !password) {
    throw new ApiError(400, 'INVALID_HOME_LINE', 'Username and password are required');
  }
  host = socks5HostField(host);
  const octets = host.split('.').map(Number);
  const isIpv4 = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isIpv4) {
    const [a, b] = octets;
    if (
      a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
    ) {
      throw new ApiError(400, 'INVALID_HOME_LINE', 'Home line host must be a public address');
    }
  }
  if (!Number.isSafeInteger(port)) {
    throw new ApiError(400, 'INVALID_HOME_LINE', 'Invalid port');
  }
  port = socks5PortField(port);
  username = str(username, 'socks5Username', 1, 255);
  password = str(password, 'socks5Password', 1, 255);
  if (notes !== null) notes = str(notes, 'notes', 1, 1000);
  return { host, port, username, password, notes };
}

export function socks5ProxyName() {
  return `home-socks5-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

const HOME_BINDING_SELECT = `
  SELECT
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
`;

export async function loadHomeBinding(e: Env, userId: string) {
  return e.DB.prepare(`${HOME_BINDING_SELECT} WHERE user_home_bindings.user_id = ?`).bind(userId).first<Row>();
}

export async function findSocks5Home(e: Env, host: string, port: number, username: string) {
  return e.DB.prepare(
    `SELECT * FROM home_exits
     WHERE kind = 'socks5' AND socks5_host = ? AND socks5_port = ? AND socks5_username = ?`,
  ).bind(host, port, username).first<Row>();
}

export async function insertSocks5HomeExit(
  e: Env,
  parsed: ParsedHomeLine,
  displayName: string,
): Promise<Row> {
  const existing = await findSocks5Home(e, parsed.host, parsed.port, parsed.username);
  if (existing) {
    throw new ApiError(409, 'HOME_LINE_EXISTS', 'A home exit with this host, port and username already exists');
  }
  const homeId = id();
  const t = now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const proxyName = socks5ProxyName();
    try {
      const egressIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.host) ? parsed.host : null;
      await e.DB.prepare(
        `INSERT INTO home_exits(
           id, proxy_name, display_name, egress_ipv4, kind,
           socks5_host, socks5_port, socks5_username, socks5_password,
           status, notes, created_at, updated_at
         ) VALUES(?, ?, ?, ?, 'socks5', ?, ?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(
        homeId, proxyName, displayName, egressIpv4,
        parsed.host, parsed.port, parsed.username, parsed.password,
        parsed.notes, t, t,
      ).run();
      const row = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(homeId).first<Row>();
      if (!row) throw new ApiError(500, 'INTERNAL_ERROR', 'Home exit insert failed');
      return row;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (attempt === 4) {
        throw new ApiError(409, 'HOME_EXIT_CONFLICT', 'A home exit with this proxyName already exists');
      }
    }
  }
  throw new ApiError(500, 'INTERNAL_ERROR', 'Home exit insert failed');
}

export async function upsertHomeBinding(
  e: Env,
  userId: string,
  homeExitId: string,
  defaultProxyName: string | null,
) {
  const t = now();
  const existing = await e.DB.prepare(
    'SELECT created_at FROM user_home_bindings WHERE user_id = ?',
  ).bind(userId).first<Row>();
  if (existing) {
    await e.DB.prepare(
      `UPDATE user_home_bindings
       SET home_exit_id = ?, default_proxy_name = ?, updated_at = ?
       WHERE user_id = ?`,
    ).bind(homeExitId, defaultProxyName, t, userId).run();
    return { created: false };
  }
  await e.DB.prepare(
    `INSERT INTO user_home_bindings(user_id, home_exit_id, default_proxy_name, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?)`,
  ).bind(userId, homeExitId, defaultProxyName, t, t).run();
  return { created: true };
}
