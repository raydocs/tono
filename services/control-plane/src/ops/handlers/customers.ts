import { ApiError } from '../../errors';
import { sniffPlatform } from '../customers';
import { activityHours, customerStatus } from '../customers-read';
import {
  SERVICE_FAMILIES,
  assertActivityHour,
  assertConnectionEvent,
  assertCustomerDetail,
  assertCustomerSummary,
  assertDestinationRow,
  assertServiceUsage,
  customerHealthWord,
  type ActivityHourDto,
  type ChoreDto,
  type CustomerDetailDto,
  type CustomerNowDto,
  type CustomerSummaryDto,
  type CustomerVerdict,
  type DestinationRowDto,
  type Platform,
  type RouteKind,
  type ServiceFamily,
  type ServiceUsageDto,
} from '../contract';
import { eventDto } from './nodes-data';
import {
  Env,
  Row,
  afterCursor,
  asPlatform,
  decodeName,
  encodeCursor,
  entityJson,
  listJson,
  measured,
  missingTable,
  now,
  nullInt,
  nullText,
  pageParams,
  parseRange,
  rangeSeconds,
  weakEtag,
  HEARTBEAT_FRESH_SEC,
} from './common';

const ROUTE_MAP: Record<string, RouteKind> = {
  cloud: 'cloud', residential: 'residential', direct: 'direct', blocked: 'blocked', reject: 'blocked',
};

function customerVerdict(user: Row, status: Awaited<ReturnType<typeof customerStatus>>, t: number): {
  verdict: CustomerVerdict; lifecycle: CustomerDetailDto['lifecycle'];
} {
  const lifecycle = user.status !== 'active'
    ? 'suspended'
    : (nullInt(user.expires_at) != null && Number(user.expires_at) < t ? 'expired' : 'active');
  if (!status || status.lastSeenAt == null) return { verdict: 'unreported', lifecycle };
  if (t - status.lastSeenAt > HEARTBEAT_FRESH_SEC) {
    return { verdict: status.lastSeenAt > 0 ? 'offline' : 'unreported', lifecycle };
  }
  if (status.fails30m >= 3 && (status.lastFailAt ?? 0) >= (status.lastSeenAt ?? 0) - HEARTBEAT_FRESH_SEC) {
    return { verdict: 'unreachable', lifecycle };
  }
  if (status.connected) return { verdict: 'ok', lifecycle };
  if (status.lastFailAt != null && t - status.lastFailAt < 30 * 60) return { verdict: 'unstable', lifecycle };
  return { verdict: 'offline', lifecycle };
}

function asFamily(value: string): ServiceFamily {
  return (SERVICE_FAMILIES as readonly string[]).includes(value) ? value as ServiceFamily : 'other';
}

async function servicesFor(e: Env, userId: string, fromSec: number): Promise<ServiceFamily[]> {
  try {
    const rows = await e.DB.prepare(
      `SELECT DISTINCT family FROM service_usage_daily WHERE user_id = ? AND day_at >= ?`,
    ).bind(userId, fromSec).all<Row>();
    const out: ServiceFamily[] = [];
    for (const row of rows.results ?? []) {
      const family = asFamily(String(row.family));
      if (!out.includes(family)) out.push(family);
    }
    return out;
  } catch (error) {
    if (!missingTable(error)) throw error;
    return [];
  }
}

async function liveIncidents(e: Env, userId: string): Promise<number> {
  try {
    const row = await e.DB.prepare(
      `SELECT COUNT(*) AS n FROM ops_incidents
       WHERE subject_type = 'user' AND subject_id = ? AND status <> 'resolved'`,
    ).bind(userId).first<Row>();
    return Number(row?.n ?? 0);
  } catch (error) {
    if (!missingTable(error)) throw error;
    return 0;
  }
}

export async function getCustomers(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const { cursor, limit, since } = pageParams(url);
  let users: Row[] = [];
  try {
    users = (await e.DB.prepare(
      'SELECT * FROM users ORDER BY email ASC, id ASC',
    ).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const t = now();
  const items: CustomerSummaryDto[] = [];
  for (const user of users) {
    const email = String(user.email);
    const userId = String(user.id);
    if (!afterCursor(cursor, email, userId, 'asc')) continue;
    const updatedAt = Number(user.updated_at) || t;
    if (since != null && updatedAt < since) continue;
    const status = await customerStatus(e.DB, userId);
    const { verdict, lifecycle } = customerVerdict(user, status, t);
    const word = customerHealthWord(verdict);
    const platforms: Platform[] = [];
    const p = asPlatform(status?.platform);
    if (p) platforms.push(p);
    items.push({
      userId, email, verdict, health: word.word, tone: word.tone, reason: null,
      lifecycle, deviceCount: 0, platforms,
      selectedServer: status?.selectedServer ?? null,
      connected: measured(status?.connected === true, status?.lastSeenAt ?? null, 'telemetry'),
      lastFailure: status?.lastFailAt
        ? { at: status.lastFailAt, node: status.lastFailNode, stage: null, code: status.lastFailCode }
        : null,
      usageBytes: measured(Number(user.usage_bytes ?? 0), updatedAt, 'manual'),
      quotaBytes: nullInt(user.quota_bytes),
      services: await servicesFor(e, userId, t - 30 * 86_400),
      minAppVersion: status?.appVersion ?? null,
      expiresAt: nullInt(user.expires_at),
      lastSeenAt: status?.lastSeenAt ?? null,
      updatedAt,
    });
  }
  // Fill device counts in one query.
  try {
    const counts = await e.DB.prepare(
      `SELECT user_id, COUNT(*) AS n FROM devices GROUP BY user_id`,
    ).all<Row>();
    const byUser = new Map((counts.results ?? []).map((row) => [String(row.user_id), Number(row.n)]));
    for (const item of items) item.deviceCount = byUser.get(item.userId) ?? 0;
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  void liveIncidents;
  const page = items.slice(0, limit + 1);
  const sliced = page.length > limit ? page.slice(0, limit) : page;
  const last = sliced[sliced.length - 1];
  const nextCursor = page.length > limit && last ? encodeCursor(last.email, last.userId) : null;
  const updatedAt = sliced.reduce((max, row) => Math.max(max, row.updatedAt), t);
  return listJson(
    e, req, sliced, nextCursor, updatedAt,
    weakEtag([updatedAt, items.length, since]),
    assertCustomerSummary, items.length,
  );
}

async function loadUser(e: Env, userId: string): Promise<Row> {
  const user = await e.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<Row>();
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  return user;
}

function choresFor(user: Row, status: Awaited<ReturnType<typeof customerStatus>>, t: number): ChoreDto[] {
  const chores: ChoreDto[] = [];
  const expiresAt = nullInt(user.expires_at);
  if (expiresAt != null && expiresAt - t < 7 * 86_400) {
    chores.push({
      id: `expiry:${user.id}`, kind: 'expiry',
      summary: expiresAt < t ? '账号已到期' : '账号即将到期',
      dueAt: expiresAt, createdAt: Number(user.created_at) || t,
    });
  }
  const quota = nullInt(user.quota_bytes);
  const used = Number(user.usage_bytes ?? 0);
  if (quota != null && quota > 0 && used / quota >= 0.8) {
    chores.push({
      id: `quota:${user.id}`, kind: 'quota',
      summary: '用量接近配额', dueAt: null, createdAt: Number(user.updated_at) || t,
    });
  }
  if (status?.appVersion && /^0\.0\./.test(status.appVersion)) {
    chores.push({
      id: `version:${user.id}`, kind: 'version',
      summary: `客户端版本 ${status.appVersion}`, dueAt: null, createdAt: status.lastSeenAt ?? t,
    });
  }
  return chores;
}

export async function getCustomer(req: Request, e: Env, rawId: string): Promise<Response> {
  const userId = decodeName(rawId, 'id');
  const user = await loadUser(e, userId);
  const t = now();
  const status = await customerStatus(e.DB, userId);
  const { verdict, lifecycle } = customerVerdict(user, status, t);
  const word = customerHealthWord(verdict);
  let devices: Row[] = [];
  try {
    devices = (await e.DB.prepare(
      'SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC',
    ).bind(userId).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const nowBlock: CustomerNowDto = {
    connected: measured(status?.connected === true, status?.lastSeenAt ?? null, 'telemetry'),
    node: status?.selectedServer ?? null,
    connectedSince: status?.connectedSince ?? null,
    deviceId: status?.deviceId ?? null,
    platform: asPlatform(status?.platform),
    appVersion: status?.appVersion ?? null,
    osVersion: status?.osVersion ?? null,
    carrier: status?.edgeAsOrg ?? null,
    asn: status?.edgeAsn ?? null,
    region: status?.edgeRegion ?? null,
  };
  const dto: CustomerDetailDto = {
    userId, email: String(user.email), verdict, health: word.word, tone: word.tone,
    reason: null, lifecycle, now: nowBlock,
    devices: devices.map((row) => ({
      id: String(row.id), name: String(row.name),
      platform: asPlatform(sniffPlatform(nullText(row.os_version) ?? status?.osVersion)),
      appVersion: status?.deviceId === String(row.id) ? status.appVersion : null,
      osVersion: status?.deviceId === String(row.id) ? status.osVersion : null,
      status: String(row.status),
      selectedServer: status?.deviceId === String(row.id) ? status.selectedServer : null,
      lastSeenAt: status?.deviceId === String(row.id) ? status.lastSeenAt : nullInt(row.updated_at),
      createdAt: Number(row.created_at),
    })),
    chores: choresFor(user, status, t),
    billing: {
      plan: nullText(user.plan),
      deviceLimit: Number(user.device_limit ?? 2),
      quotaBytes: nullInt(user.quota_bytes),
      usageBytes: measured(Number(user.usage_bytes ?? 0), Number(user.updated_at) || t, 'manual'),
      expiresAt: nullInt(user.expires_at),
      firstEntitledAt: nullInt(user.first_entitled_at),
      createdAt: Number(user.created_at),
    },
    updatedAt: Number(user.updated_at) || t,
  };
  return entityJson(e, req, dto, weakEtag([userId, dto.updatedAt]), assertCustomerDetail);
}

export async function getCustomerConnections(req: Request, e: Env, rawId: string): Promise<Response> {
  const userId = decodeName(rawId, 'id');
  await loadUser(e, userId);
  const { cursor, limit } = pageParams(new URL(req.url));
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      'SELECT * FROM connection_events WHERE user_id = ? ORDER BY at_ms DESC, id DESC LIMIT 500',
    ).bind(userId).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items = rows.map(eventDto).filter((row) => afterCursor(cursor, String(row.atMs), row.id, 'desc'));
  const page = items.slice(0, limit + 1);
  const sliced = page.length > limit ? page.slice(0, limit) : page;
  const last = sliced[sliced.length - 1];
  const nextCursor = page.length > limit && last ? encodeCursor(String(last.atMs), last.id) : null;
  const updatedAt = sliced[0] ? Math.floor(sliced[0].atMs / 1000) : now();
  return listJson(e, req, sliced, nextCursor, updatedAt, weakEtag([userId, updatedAt, rows.length]), assertConnectionEvent);
}

export async function getCustomerActivity(req: Request, e: Env, rawId: string): Promise<Response> {
  const userId = decodeName(rawId, 'id');
  await loadUser(e, userId);
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  const t = now();
  const hours = await activityHours(e.DB, userId, { fromSec: t - rangeSeconds(range), toSec: t });
  const items: ActivityHourDto[] = hours.map((row) => ({
    hourAt: row.hourAt,
    onlineMinutes: row.onlineMinutes,
    connectedMinutes: row.connectedMinutes,
    bytesUp: row.bytesUp,
    bytesDown: row.bytesDown,
    node: row.node,
    platform: asPlatform(row.platform),
    appVersion: row.appVersion,
  }));
  const updatedAt = items[items.length - 1]?.hourAt ?? t;
  return listJson(e, req, items, null, updatedAt, weakEtag([userId, range, items.length]), assertActivityHour, items.length);
}

export async function getCustomerDestinations(req: Request, e: Env, rawId: string): Promise<Response> {
  const userId = decodeName(rawId, 'id');
  await loadUser(e, userId);
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  const from = now() - rangeSeconds(range);
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT day_at, etld1, route, node, connections, bytes_up, bytes_down, top_process
       FROM traffic_destination_daily WHERE user_id = ? AND day_at >= ?
       ORDER BY day_at DESC, bytes_down DESC`,
    ).bind(userId, from).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items: DestinationRowDto[] = [];
  for (const row of rows) {
    const route = ROUTE_MAP[String(row.route)];
    if (!route) continue;
    const top = nullText(row.top_process);
    items.push({
      dayAt: Number(row.day_at), etld1: String(row.etld1), route,
      node: nullText(row.node) || null,
      connections: Number(row.connections) || 0,
      bytesUp: Number(row.bytes_up) || 0,
      bytesDown: Number(row.bytes_down) || 0,
      topProcesses: top ? top.split(',').filter(Boolean) : [],
    });
  }
  const updatedAt = items[0]?.dayAt ?? now();
  return listJson(e, req, items, null, updatedAt, weakEtag([userId, range, items.length]), assertDestinationRow, items.length);
}

export async function getCustomerServices(req: Request, e: Env, rawId: string): Promise<Response> {
  const userId = decodeName(rawId, 'id');
  await loadUser(e, userId);
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  const from = now() - rangeSeconds(range);
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT day_at, family, route, bytes, sessions, last_seen_at
       FROM service_usage_daily WHERE user_id = ? AND day_at >= ?
       ORDER BY day_at DESC, bytes DESC`,
    ).bind(userId, from).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items: ServiceUsageDto[] = [];
  for (const row of rows) {
    const route = ROUTE_MAP[String(row.route)];
    if (!route) continue;
    items.push({
      dayAt: Number(row.day_at),
      family: asFamily(String(row.family)),
      route,
      bytes: Number(row.bytes) || 0,
      sessions: Number(row.sessions) || 0,
      lastSeenAt: nullInt(row.last_seen_at),
    });
  }
  const updatedAt = items[0]?.dayAt ?? now();
  return listJson(e, req, items, null, updatedAt, weakEtag([userId, range, items.length]), assertServiceUsage, items.length);
}
