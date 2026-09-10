// Onboarding funnel: pure stage helpers plus one batched loader.

import type { FunnelDto, FunnelRowDto, FunnelStage } from './contract';
import { FUNNEL_STAGES } from './contract';

type Row = Record<string, any>;

const DAY = 86_400;

function missingTable(error: unknown): boolean {
  const text = String(error);
  return text.includes('no such table') || text.includes('no such column');
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length ? s : null;
}

async function allRows(db: D1Database, sql: string): Promise<Row[]> {
  try {
    return (await db.prepare(sql).all<Row>()).results ?? [];
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export function funnelDays(nowSec: number, since: number): number {
  if (!Number.isFinite(since) || !Number.isFinite(nowSec)) return 0;
  return Math.max(0, Math.floor((nowSec - since) / DAY));
}

export function stageSentence(stage: FunnelStage, days: number): string {
  if (stage === 'invited') return `开通 ${days} 天还没注册`;
  if (stage === 'registered') return `注册 ${days} 天，还没装客户端`;
  if (stage === 'device_added') return `装了客户端 ${days} 天，还没上报`;
  if (stage === 'reported') return `上报过，还没连上过`;
  return '';
}

export type StageFacts = {
  hasUser: boolean;
  deviceCount: number;
  firstDeviceAt: number | null;
  hasStatus: boolean;
  hasActivity: boolean;
  firstOnlineAt: number | null;
  statusUpdatedAt: number | null;
  firstConnectedAt: number | null;
  userCreatedAt: number | null;
  allowlistCreatedAt: number | null;
};

export function classifyStage(facts: StageFacts): { stage: FunnelStage; stageSinceAt: number } {
  if (!facts.hasUser) {
    return { stage: 'invited', stageSinceAt: facts.allowlistCreatedAt ?? 0 };
  }
  if (facts.firstConnectedAt != null) {
    return { stage: 'connected', stageSinceAt: facts.firstConnectedAt };
  }
  if (facts.hasStatus || facts.hasActivity) {
    const since = facts.firstOnlineAt ?? facts.statusUpdatedAt ?? facts.firstDeviceAt ?? facts.userCreatedAt ?? 0;
    return { stage: 'reported', stageSinceAt: since };
  }
  if (facts.deviceCount > 0) {
    return { stage: 'device_added', stageSinceAt: facts.firstDeviceAt ?? facts.userCreatedAt ?? 0 };
  }
  return { stage: 'registered', stageSinceAt: facts.userCreatedAt ?? 0 };
}

export function resolveFirstConnectedAt(input: {
  statusFirst: number | null;
  connectedHourAt: number | null;
  connectOkSec: number | null;
  currentlyConnected: boolean;
  connectedSince: number | null;
  lastSeenAt: number | null;
}): number | null {
  if (input.statusFirst != null) return input.statusFirst;
  if (input.connectedHourAt != null) return input.connectedHourAt;
  if (input.connectOkSec != null) return input.connectOkSec;
  if (input.currentlyConnected) return input.connectedSince ?? input.lastSeenAt;
  return null;
}

export type FunnelPerson = FunnelRowDto & { firstConnectedAt: number | null };

export type FunnelIndex = {
  people: FunnelPerson[];
  byUserId: Map<string, FunnelPerson>;
};

export async function loadFunnelFacts(db: D1Database, nowSec: number): Promise<FunnelIndex> {
  const allowlist = await allRows(db, 'SELECT email, created_at, wechat_id, contact, notes FROM signup_allowlist');
  const users = await allRows(db, 'SELECT id, email, wechat_id, contact, notes, created_at FROM users');
  const devices = await allRows(db, 'SELECT user_id, COUNT(*) AS n, MIN(created_at) AS first_device_at FROM devices GROUP BY user_id');
  const statuses = await allRows(db, 'SELECT * FROM ops_customer_status');
  const hours = await allRows(db, `SELECT user_id,
      MIN(CASE WHEN online_minutes > 0 THEN hour_at END) AS first_online_at,
      MIN(CASE WHEN connected_minutes > 0 THEN hour_at END) AS first_connected_hour_at
    FROM customer_activity_hours GROUP BY user_id`);
  const events = await allRows(db, `SELECT user_id, MIN(at_ms) AS first_ok_ms FROM connection_events WHERE kind = 'connectOk' GROUP BY user_id`);

  const deviceByUser = new Map(devices.map((row) => [String(row.user_id), {
    n: Number(row.n) || 0,
    firstAt: finite(row.first_device_at),
  }]));
  const statusByUser = new Map(statuses.map((row) => [String(row.user_id), row]));
  const hoursByUser = new Map(hours.map((row) => [String(row.user_id), row]));
  const okByUser = new Map(events.map((row) => [String(row.user_id), finite(row.first_ok_ms)]));
  const allowByEmail = new Map(allowlist.map((row) => [String(row.email).toLowerCase(), row]));
  const userEmails = new Set<string>();

  const people: FunnelPerson[] = [];
  const byUserId = new Map<string, FunnelPerson>();

  for (const user of users) {
    const userId = String(user.id);
    const email = String(user.email);
    userEmails.add(email.toLowerCase());
    const device = deviceByUser.get(userId);
    const status = statusByUser.get(userId);
    const hour = hoursByUser.get(userId);
    const okMs = okByUser.get(userId) ?? null;
    const firstConnectedAt = resolveFirstConnectedAt({
      statusFirst: finite(status?.first_connected_at),
      connectedHourAt: finite(hour?.first_connected_hour_at),
      connectOkSec: okMs != null ? Math.floor(okMs / 1000) : null,
      currentlyConnected: Number(status?.connected) === 1,
      connectedSince: finite(status?.connected_since),
      lastSeenAt: finite(status?.last_seen_at),
    });
    const { stage, stageSinceAt } = classifyStage({
      hasUser: true,
      deviceCount: device?.n ?? 0,
      firstDeviceAt: device?.firstAt ?? null,
      hasStatus: status != null,
      hasActivity: hour != null,
      firstOnlineAt: finite(hour?.first_online_at),
      statusUpdatedAt: finite(status?.updated_at),
      firstConnectedAt,
      userCreatedAt: finite(user.created_at) ?? nowSec,
      allowlistCreatedAt: finite(allowByEmail.get(email.toLowerCase())?.created_at),
    });
    const person: FunnelPerson = {
      key: userId,
      userId,
      email,
      wechatId: text(user.wechat_id),
      contact: text(user.contact),
      notes: text(user.notes),
      stage,
      stageSinceAt,
      lastSeenAt: finite(status?.last_seen_at),
      firstConnectedAt,
    };
    people.push(person);
    byUserId.set(userId, person);
  }

  for (const row of allowlist) {
    const email = String(row.email);
    if (userEmails.has(email.toLowerCase())) continue;
    people.push({
      key: `invite:${email}`,
      userId: null,
      email,
      wechatId: text(row.wechat_id),
      contact: text(row.contact),
      notes: text(row.notes),
      stage: 'invited',
      stageSinceAt: finite(row.created_at) ?? nowSec,
      lastSeenAt: null,
      firstConnectedAt: null,
    });
  }

  return { people, byUserId };
}

export function toFunnelDto(index: FunnelIndex, nowSec: number): FunnelDto {
  const counts = new Map<FunnelStage, number>(FUNNEL_STAGES.map((stage) => [stage, 0]));
  for (const person of index.people) {
    counts.set(person.stage, (counts.get(person.stage) ?? 0) + 1);
  }
  const items = index.people
    .filter((person) => person.stage !== 'connected')
    .map(({ firstConnectedAt: _drop, ...row }) => row)
    .sort((a, b) => b.stageSinceAt - a.stageSinceAt || a.key.localeCompare(b.key));
  const updatedAt = index.people.reduce((max, person) => Math.max(max, person.stageSinceAt), nowSec);
  return {
    stages: FUNNEL_STAGES.map((stage) => ({ stage, count: counts.get(stage) ?? 0 })),
    items,
    updatedAt,
  };
}

export async function loadFunnel(db: D1Database, nowSec: number): Promise<FunnelDto> {
  return toFunnelDto(await loadFunnelFacts(db, nowSec), nowSec);
}
