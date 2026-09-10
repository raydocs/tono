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
  type CustomerDeviceDto,
  type CustomerNowDto,
  type CustomerSummaryDto,
  type CustomerVerdict,
  type DestinationRowDto,
  type Platform,
  type RouteKind,
  type ServiceFamily,
  type ServiceUsageDto,
} from '../contract';
import { customerFreshnessVerdict } from '../verdict-customers';
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
} from './common';

const ROUTE_MAP: Record<string, RouteKind> = {
  cloud: 'cloud', residential: 'residential', direct: 'direct', reject: 'reject', unknown: 'unknown',
};

const INCIDENT_VERDICT: Record<string, CustomerVerdict> = {
  'customer-repeat-fail': 'unreachable',
  'customer-path-slow': 'unstable',
  'customer-switch-churn': 'unstable',
};

type OpenCustomerIncident = { kind: string; title: string };

function lifecycleOf(user: Row, t: number): CustomerDetailDto['lifecycle'] {
  return user.status !== 'active'
    ? 'suspended'
    : (nullInt(user.expires_at) != null && Number(user.expires_at) < t ? 'expired' : 'active');
}

function verdictFrom(
  user: Row,
  status: Awaited<ReturnType<typeof customerStatus>>,
  incident: OpenCustomerIncident | undefined,
  t: number,
): { verdict: CustomerVerdict; lifecycle: CustomerDetailDto['lifecycle']; reason: string | null } {
  const lifecycle = lifecycleOf(user, t);
  if (incident) {
    const mapped = INCIDENT_VERDICT[incident.kind];
    if (mapped) return { verdict: mapped, lifecycle, reason: incident.title };
  }
  const freshness = customerFreshnessVerdict(status?.lastSeenAt, t);
  if (freshness !== 'fresh') return { verdict: freshness, lifecycle, reason: null };
  return { verdict: status?.connected ? 'ok' : 'offline', lifecycle, reason: null };
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

async function openCustomerIncidents(e: Env): Promise<Map<string, OpenCustomerIncident>> {
  const byUser = new Map<string, OpenCustomerIncident>();
  try {
    const rows = await e.DB.prepare(
      `SELECT subject_id, kind, title FROM ops_incidents
       WHERE subject_type = 'user' AND status <> 'resolved'
         AND kind IN ('customer-repeat-fail', 'customer-path-slow', 'customer-switch-churn')`,
    ).all<Row>();
    for (const row of rows.results ?? []) {
      const userId = String(row.subject_id);
      const kind = String(row.kind);
      const current = byUser.get(userId);
      if (!current || (kind === 'customer-repeat-fail' && current.kind !== 'customer-repeat-fail')) {
        byUser.set(userId, { kind, title: String(row.title ?? '') });
      }
    }
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  return byUser;
}

export async function getCustomers(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const { cursor, limit, since } = pageParams(url);
  const qRaw = url.searchParams.get('q');
  const q = qRaw == null || qRaw.trim() === '' ? null : qRaw.trim().toLowerCase();
  if (q != null && q.length > 200) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid q');
  let users: Row[] = [];
  try {
    users = (await e.DB.prepare(
      'SELECT * FROM users ORDER BY email ASC, id ASC',
    ).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const t = now();
  const incidents = await openCustomerIncidents(e);
  const items: CustomerSummaryDto[] = [];
  for (const user of users) {
    const email = String(user.email);
    const userId = String(user.id);
    if (q && !email.toLowerCase().includes(q) && !(nullText(user.wechat_id) ?? '').toLowerCase().includes(q)) {
      continue;
    }
    if (!afterCursor(cursor, email, userId, 'asc')) continue;
    const updatedAt = Number(user.updated_at) || t;
    if (since != null && updatedAt < since) continue;
    const status = await customerStatus(e.DB, userId);
    const { verdict, lifecycle, reason } = verdictFrom(user, status, incidents.get(userId), t);
    const word = customerHealthWord(verdict);
    const platforms: Platform[] = [];
    const p = asPlatform(status?.platform);
    if (p) platforms.push(p);
    items.push({
      userId, email, wechatId: nullText(user.wechat_id),
      verdict, health: word.word, tone: word.tone, reason,
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
  const incidents = await openCustomerIncidents(e);
  const { verdict, lifecycle, reason } = verdictFrom(user, status, incidents.get(userId), t);
  const word = customerHealthWord(verdict);
  let devices: Row[] = [];
  try {
    devices = (await e.DB.prepare(
      'SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC',
    ).bind(userId).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const liveById = new Map<string, Row>();
  try {
    const live = await e.DB.prepare(
      'SELECT * FROM ops_device_status WHERE user_id = ?',
    ).bind(userId).all<Row>();
    for (const row of live.results ?? []) liveById.set(String(row.device_id), row);
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
    userId, email: String(user.email),
    wechatId: nullText(user.wechat_id), contact: nullText(user.contact), notes: nullText(user.notes),
    verdict, health: word.word, tone: word.tone,
    reason, lifecycle, now: nowBlock,
    devices: devices.map((row) => deviceDto(row, liveById.get(String(row.id)), status)),
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

function parseDeviceId(raw: string | null): string | null {
  if (raw == null || raw === '') return null;
  if (raw.length > 128 || /[\r\n\0]/.test(raw)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid deviceId');
  }
  return raw;
}

function deviceDto(
  row: Row,
  live: Row | undefined,
  status: Awaited<ReturnType<typeof customerStatus>>,
): CustomerDeviceDto {
  const id = String(row.id);
  const fromCustomer = status?.deviceId === id;
  return {
    id, name: String(row.name),
    platform: asPlatform(live?.platform)
      ?? asPlatform(sniffPlatform(nullText(row.os_version) ?? status?.osVersion)),
    appVersion: nullText(live?.app_version) ?? (fromCustomer ? status?.appVersion ?? null : null),
    osVersion: nullText(live?.os_version) ?? (fromCustomer ? status?.osVersion ?? null : null),
    status: String(row.status),
    selectedServer: nullText(live?.selected_server)
      ?? (fromCustomer ? status?.selectedServer ?? null : null),
    lastSeenAt: nullInt(live?.last_seen_at)
      ?? (fromCustomer ? status?.lastSeenAt ?? null : nullInt(row.updated_at)),
    createdAt: Number(row.created_at),
    connected: Number(live?.connected) === 1,
    lastFailAt: nullInt(live?.last_fail_at),
    lastFailCode: nullText(live?.last_fail_code),
    lastFailNode: nullText(live?.last_fail_node),
  };
}

export async function getCustomerConnections(req: Request, e: Env, rawId: string): Promise<Response> {
  const userId = decodeName(rawId, 'id');
  await loadUser(e, userId);
  const url = new URL(req.url);
  const { cursor, limit } = pageParams(url);
  const deviceId = parseDeviceId(url.searchParams.get('deviceId'));
  let rows: Row[] = [];
  try {
    rows = deviceId
      ? (await e.DB.prepare(
        'SELECT * FROM connection_events WHERE user_id = ? AND device_id = ? ORDER BY at_ms DESC, id DESC LIMIT 500',
      ).bind(userId, deviceId).all<Row>()).results ?? []
      : (await e.DB.prepare(
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
  return listJson(
    e, req, sliced, nextCursor, updatedAt,
    weakEtag([userId, deviceId, updatedAt, rows.length]), assertConnectionEvent,
  );
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
