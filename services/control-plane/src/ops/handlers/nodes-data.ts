import { decryptCatalog } from '../../crypto';
import { requiredCatalogKey } from '../../env';
import { ApiError } from '../../errors';
import { splitManagedCatalogProxies, catalogBaseName } from '../../catalog-yaml';
import {
  healthWordForVerdict,
  NODE_VERDICTS,
  type CarrierKey,
  type ConnectionEventDto,
  type EventSource,
  type ForwardPathDto,
  type JobDto,
  type NodeBindingsDto,
  type NodeErrorRowDto,
  type NodeFactsDto,
  type NodeHistoryEntryDto,
  type NodeLifecycle,
  type NodeOccupantDto,
  type NodeQuotaDto,
  type NodeVerdict,
  type QuotaCounts,
  type QuotaCycleKind,
  type QuotaLevel,
  type ReturnPathDto,
} from '../contract';
import { type NodeJob } from '../jobs';
import { operationsLive } from '../live';
import { quotaSummary } from '../quota';
import {
  Env,
  Row,
  asPlatform,
  missingTable,
  now,
  nullInt,
  nullNum,
  nullText,
  TOKEN_FRESH_SEC,
} from './common';

const CARRIERS: CarrierKey[] = ['unicom', 'telecom', 'mobile', 'other'];
const QUOTA_CYCLES: readonly QuotaCycleKind[] = ['calendar_day', 'anniversary', 'rolling_30d', 'manual'];
const QUOTA_COUNT_VALUES: readonly QuotaCounts[] = ['in', 'out', 'in_out'];
const QUOTA_LEVEL_VALUES: readonly QuotaLevel[] = ['ok', 'chore', 'warn', 'severe'];

export function isVerdict(value: string): value is NodeVerdict {
  return (NODE_VERDICTS as readonly string[]).includes(value);
}

function asQuotaLevel(level: string): QuotaLevel {
  return (QUOTA_LEVEL_VALUES as readonly string[]).includes(level) ? level as QuotaLevel : 'ok';
}

function asCounts(value: unknown): QuotaCounts {
  const text = nullText(value);
  if (text && (QUOTA_COUNT_VALUES as readonly string[]).includes(text)) return text as QuotaCounts;
  return 'in_out';
}

function asCycleKind(value: unknown): QuotaCycleKind {
  const text = nullText(value);
  if (text && (QUOTA_CYCLES as readonly string[]).includes(text)) return text as QuotaCycleKind;
  return 'manual';
}

function carrierFromOrg(org: string | null): CarrierKey | null {
  if (!org) return null;
  const s = org.toLowerCase();
  if (s.includes('mobile') || s.includes('cmcc') || s.includes('移动')) return 'mobile';
  if (s.includes('telecom') || s.includes('chinanet') || s.includes('电信')) return 'telecom';
  if (s.includes('unicom') || s.includes('联通')) return 'unicom';
  return 'other';
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}

function eventSource(raw: unknown): EventSource {
  const text = nullText(raw);
  if (text === 'window' || text === 'direct' || text === 'diagnostics' || text === 'failure') {
    return text;
  }
  return 'window';
}

export function jobDto(job: NodeJob): JobDto {
  const params: JobDto['params'] = {};
  for (const [key, value] of Object.entries(job.params)) {
    const kind = typeof value;
    if (value === null || kind === 'string' || kind === 'boolean') {
      params[key] = value as string | boolean | null;
    } else if (kind === 'number' && Number.isFinite(value as number)) {
      params[key] = value as number;
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      params[key] = value as string[];
    }
  }
  return {
    id: job.id, type: job.type, executor: job.executor, status: job.status,
    subjectType: 'node', subjectId: job.nodeName, params,
    attempts: job.attempts, maxAttempts: job.maxAttempts,
    idempotencyKey: job.idempotencyKey, requestedBy: job.requestedBy,
    incidentId: job.incidentId, notBefore: job.notBefore, expiresAt: job.expiresAt,
    leasedUntil: job.leaseExpiresAt, resultSummary: job.resultSummary,
    createdAt: job.createdAt, updatedAt: job.updatedAt, finishedAt: job.completedAt,
  };
}

function parseLineTags(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function factsFrom(profile: Row | null, agent: Row | null, fallbackAt: number): NodeFactsDto {
  const createdAt = nullInt(profile?.created_at) ?? fallbackAt;
  const updatedAt = nullInt(profile?.updated_at) ?? createdAt;
  return {
    publicIp: nullText(profile?.public_ip) ?? nullText(agent?.publicIp) ?? nullText(agent?.host),
    os: nullText(profile?.os) ?? nullText(agent?.os),
    region: nullText(profile?.region),
    provider: nullText(profile?.provider),
    providerAccountId: nullText(profile?.provider_account_id),
    lineTags: parseLineTags(profile?.line_tags_json),
    port: nullInt(profile?.port),
    price: nullNum(profile?.price) ?? nullNum(agent?.price),
    currency: nullText(profile?.currency) ?? nullText(agent?.currency),
    billingCycle: nullInt(profile?.billing_cycle) ?? nullInt(agent?.billingCycle),
    renewsAt: nullInt(profile?.renews_at),
    expiresAt: nullInt(profile?.expires_at) ?? nullInt(agent?.expiredAt),
    notes: nullText(profile?.notes),
    createdAt: createdAt > 0 ? createdAt : fallbackAt,
    updatedAt: updatedAt > 0 ? updatedAt : fallbackAt,
    ...(nullInt(profile?.hy2_port) != null
      ? {
        transports: ['tcp', 'hy2'] as Array<'tcp' | 'hy2'>,
        hy2: { port: nullInt(profile?.hy2_port), udpOk: null },
      }
      : {}),
  };
}

export function lifecycleOf(profile: Row | null, catalogListed: boolean | null): NodeLifecycle {
  if (nullText(profile?.status) === 'retired') return 'retired';
  if (catalogListed === true) return 'listed';
  return 'unlisted';
}

export async function catalogNames(e: Env): Promise<Set<string> | null> {
  try {
    const row = await e.DB.prepare(
      'SELECT ciphertext, nonce FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<Row>();
    if (!row) return new Set();
    const yaml = await decryptCatalog(String(row.ciphertext), String(row.nonce), requiredCatalogKey(e));
    return new Set(splitManagedCatalogProxies(yaml).items.map((item) => catalogBaseName(item.name)));
  } catch {
    return null;
  }
}

export async function quotaDto(e: Env, name: string, profile: Row | null): Promise<{ dto: NodeQuotaDto; asOf: number | null }> {
  const empty = {
    asOf: null as number | null,
    dto: {
      quota: null, used: null, pct: null, projectedExhaustAt: null,
      level: 'ok' as QuotaLevel, cycleKind: 'manual' as QuotaCycleKind,
      cycleStart: null, cycleEnd: null, counts: 'in_out' as QuotaCounts,
    },
  };
  try {
    const summary = await quotaSummary(e.DB, name);
    const has = summary.cycleStart != null || summary.quota != null;
    return {
      asOf: has ? now() : null,
      dto: {
        quota: summary.quota,
        used: has ? summary.used : null,
        pct: has ? summary.pct : null,
        projectedExhaustAt: summary.projectedExhaustAt,
        level: has ? asQuotaLevel(summary.level) : 'ok',
        cycleKind: asCycleKind(profile?.cycle_kind),
        cycleStart: summary.cycleStart,
        cycleEnd: summary.cycleEnd,
        counts: asCounts(profile?.quota_counts),
      },
    };
  } catch (error) {
    if (!missingTable(error)) throw error;
    return empty;
  }
}

export async function forwardPath(e: Env, name: string, sinceSec: number): Promise<{ rows: ForwardPathDto[]; asOf: number | null }> {
  const empty = CARRIERS.map((carrier) => ({
    carrier, successRate: null, medianTcpMs: null, topFailure: null, attempts: 0, users: 0,
  }));
  try {
    const rows = await e.DB.prepare(
      `SELECT kind, edge_as_org, tcp_delay_ms, code, user_id, at_ms
       FROM connection_events
       WHERE node = ? AND at_ms >= ? AND kind IN ('connectOk', 'connectFail')`,
    ).bind(name, sinceSec * 1000).all<Row>();
    const buckets = new Map<CarrierKey, {
      ok: number; fail: number; delays: number[]; codes: Map<string, number>; users: Set<string>; last: number;
    }>();
    for (const carrier of CARRIERS) {
      buckets.set(carrier, { ok: 0, fail: 0, delays: [], codes: new Map(), users: new Set(), last: 0 });
    }
    let any = false;
    for (const row of rows.results ?? []) {
      const carrier = carrierFromOrg(nullText(row.edge_as_org));
      if (!carrier) continue;
      const bucket = buckets.get(carrier)!;
      any = true;
      if (String(row.kind) === 'connectOk') bucket.ok += 1;
      else {
        bucket.fail += 1;
        const code = nullText(row.code);
        if (code) bucket.codes.set(code, (bucket.codes.get(code) ?? 0) + 1);
      }
      const delay = nullInt(row.tcp_delay_ms);
      if (delay != null) bucket.delays.push(delay);
      if (row.user_id) bucket.users.add(String(row.user_id));
      const at = nullInt(row.at_ms);
      if (at != null) bucket.last = Math.max(bucket.last, Math.floor(at / 1000));
    }
    const out = CARRIERS.map((carrier) => {
      const bucket = buckets.get(carrier)!;
      const attempts = bucket.ok + bucket.fail;
      let topFailure: string | null = null;
      let top = 0;
      for (const [code, count] of bucket.codes) {
        if (count > top) { top = count; topFailure = code; }
      }
      return {
        carrier, successRate: attempts === 0 ? null : bucket.ok / attempts,
        medianTcpMs: median(bucket.delays), topFailure, attempts, users: bucket.users.size,
      };
    });
    const asOf = Math.max(0, ...[...buckets.values()].map((b) => b.last));
    return { rows: out, asOf: any && asOf > 0 ? asOf : null };
  } catch (error) {
    if (!missingTable(error)) throw error;
    return { rows: empty, asOf: null };
  }
}

export function returnPath(agent: Row | null): { rows: ReturnPathDto[]; asOf: number | null } {
  const carriers = agent?.carriers && typeof agent.carriers === 'object' ? agent.carriers as Row : null;
  const rows: ReturnPathDto[] = CARRIERS.map((carrier) => {
    const raw = carriers?.[carrier];
    if (!raw || typeof raw !== 'object') return { carrier, latencyMs: null, lossPct: null, samples: 0 };
    const sample = raw as Row;
    return {
      carrier,
      latencyMs: nullInt(sample.latencyMs),
      lossPct: nullNum(sample.lossPct),
      samples: nullInt(sample.samples) ?? 0,
    };
  });
  return { rows, asOf: nullInt(agent?.observedAt) };
}

export function worstForward(rows: ForwardPathDto[]): ForwardPathDto | null {
  const ranked = rows.filter((row) => row.attempts > 0);
  if (ranked.length === 0) return null;
  return ranked.reduce((a, b) => (a.successRate ?? 1) <= (b.successRate ?? 1) ? a : b);
}

export function worstReturn(rows: ReturnPathDto[]): ReturnPathDto | null {
  const ranked = rows.filter((row) => row.samples > 0);
  if (ranked.length === 0) return null;
  return ranked.reduce((a, b) => (a.lossPct ?? -1) >= (b.lossPct ?? -1) ? a : b);
}

export async function occupancy(e: Env, name: string): Promise<{ rows: NodeOccupantDto[]; asOf: number | null }> {
  try {
    const rows = await e.DB.prepare(
      `SELECT s.user_id, u.email, s.device_id, s.platform, s.app_version, s.connected, s.last_seen_at
       FROM ops_customer_status s JOIN users u ON u.id = s.user_id
       WHERE s.selected_server = ? AND s.connected = 1 ORDER BY s.last_seen_at DESC`,
    ).bind(name).all<Row>();
    let asOf: number | null = null;
    const occupants = (rows.results ?? []).map((row) => {
      const lastSeenAt = nullInt(row.last_seen_at) ?? 0;
      if (lastSeenAt > 0) asOf = Math.max(asOf ?? 0, lastSeenAt);
      return {
        userId: String(row.user_id), email: String(row.email),
        deviceId: nullText(row.device_id), platform: asPlatform(row.platform),
        appVersion: nullText(row.app_version), online: Number(row.connected) === 1,
        lastSeenAt: lastSeenAt > 0 ? lastSeenAt : now(),
      };
    });
    return { rows: occupants, asOf };
  } catch (error) {
    if (!missingTable(error)) throw error;
    return { rows: [], asOf: null };
  }
}

export async function recentErrors(e: Env, name: string, fromSec: number): Promise<{ rows: NodeErrorRowDto[]; asOf: number | null }> {
  try {
    const rows = await e.DB.prepare(
      `SELECT day_at, category, count, sample FROM node_error_daily
       WHERE node = ? AND day_at >= ? ORDER BY day_at DESC, category ASC`,
    ).bind(name, fromSec).all<Row>();
    let asOf: number | null = null;
    const list = (rows.results ?? []).map((row) => {
      const dayAt = Number(row.day_at);
      if (dayAt > 0) asOf = Math.max(asOf ?? 0, dayAt);
      return { dayAt, category: String(row.category), count: Number(row.count) || 0, sample: nullText(row.sample) };
    });
    return { rows: list, asOf };
  } catch (error) {
    if (!missingTable(error)) throw error;
    return { rows: [], asOf: null };
  }
}

export function historyDto(row: Row): NodeHistoryEntryDto {
  const verdict = isVerdict(String(row.to_verdict ?? row.verdict ?? 'unknown'))
    ? String(row.to_verdict ?? row.verdict) as NodeVerdict
    : 'unknown';
  const word = healthWordForVerdict(verdict);
  return {
    at: Number(row.at), verdict, health: word.word, tone: word.tone,
    reason: nullText(row.reason), source: 'engine', rulesVersion: Number(row.rules_version) || 1,
  };
}

export function eventDto(row: Row): ConnectionEventDto {
  return {
    id: String(row.id), atMs: Number(row.at_ms), receivedAt: Number(row.received_at),
    source: eventSource(row.source), userId: String(row.user_id),
    deviceId: nullText(row.device_id), platform: asPlatform(row.platform),
    appVersion: nullText(row.app_version), osVersion: nullText(row.os_version),
    kind: String(row.kind) as ConnectionEventDto['kind'], node: nullText(row.node),
    stage: nullText(row.stage), outcome: nullText(row.outcome), code: nullText(row.code),
    error: nullText(row.error), elapsedMs: nullInt(row.elapsed_ms), delayMs: nullInt(row.delay_ms),
    tcpDelayMs: nullInt(row.tcp_delay_ms), exitDelayMs: nullInt(row.exit_delay_ms),
    catalogRevision: nullInt(row.catalog_revision), edgeAsn: nullInt(row.edge_asn),
    edgeAsOrg: nullText(row.edge_as_org), edgeCountry: nullText(row.edge_country),
    edgeRegion: nullText(row.edge_region), edgeViaExit: Number(row.edge_via_exit) === 1,
    ...(row.transport === 'tcp' || row.transport === 'hy2' ? { transport: row.transport } : {}),
  };
}

export async function bindingsOf(e: Env, name: string, listed: boolean | null, agent: Row | null): Promise<NodeBindingsDto> {
  const t = now();
  let exit: Row | null = null;
  try {
    exit = await e.DB.prepare('SELECT last_roster_at, metering_last_seen_at FROM exit_nodes WHERE name = ?')
      .bind(name).first<Row>();
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const roster = nullInt(exit?.last_roster_at);
  const metering = nullInt(exit?.metering_last_seen_at);
  const asOf = Math.max(roster ?? 0, metering ?? 0, nullInt(agent?.observedAt) ?? 0) || null;
  return {
    catalog: listed === true,
    exitToken: roster != null && roster > 0 && t - roster < TOKEN_FRESH_SEC,
    komari: agent != null,
    identitySync: roster != null && roster > 0,
    metering: metering != null && metering > 0 && t - metering < TOKEN_FRESH_SEC,
    asOfSec: asOf != null && asOf > 0 ? asOf : null,
  };
}

export function summaryChores(bindings: NodeBindingsDto, quota: NodeQuotaDto, facts: NodeFactsDto, t: number): number {
  let n = 0;
  if (!bindings.catalog) n += 1;
  if (!bindings.exitToken) n += 1;
  if (!bindings.komari) n += 1;
  if (!bindings.identitySync) n += 1;
  if (!bindings.metering) n += 1;
  if (quota.level === 'warn' || quota.level === 'severe') n += 1;
  if (facts.expiresAt != null && facts.expiresAt - t < 7 * 86_400) n += 1;
  return n;
}

export async function incidentCount(e: Env, name: string): Promise<number> {
  try {
    const row = await e.DB.prepare(
      `SELECT COUNT(*) AS n FROM ops_incidents
       WHERE subject_type = 'node' AND subject_id = ? AND status <> 'resolved'`,
    ).bind(name).first<Row>();
    return Number(row?.n ?? 0);
  } catch (error) {
    if (!missingTable(error)) throw error;
    return 0;
  }
}

export async function loadProfile(e: Env, name: string): Promise<Row | null> {
  try {
    return await e.DB.prepare('SELECT * FROM ops_node_profiles WHERE catalog_name = ?').bind(name).first<Row>();
  } catch (error) {
    if (!missingTable(error)) throw error;
    return null;
  }
}

export async function loadStatus(e: Env, name: string): Promise<Row | null> {
  try {
    return await e.DB.prepare('SELECT * FROM ops_node_status WHERE node_name = ?').bind(name).first<Row>();
  } catch (error) {
    if (!missingTable(error)) throw error;
    return null;
  }
}

export async function requireNode(e: Env, name: string): Promise<{
  profile: Row | null; status: Row | null; listed: boolean | null; agent: Row | null;
}> {
  const [profile, status, names, live] = await Promise.all([
    loadProfile(e, name), loadStatus(e, name), catalogNames(e), operationsLive(e),
  ]);
  const agent = (live.agents ?? []).find((row) => row?.name === name) ?? null;
  const listed = names ? names.has(name) : (status?.catalog_listed == null ? null : Number(status.catalog_listed) === 1);
  if (!profile && !status && !agent && listed !== true) {
    throw new ApiError(404, 'NOT_FOUND', 'Node not found');
  }
  return { profile, status, listed, agent };
}
