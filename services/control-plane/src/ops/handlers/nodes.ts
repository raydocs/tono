import { str } from '../../env';
import { ApiError } from '../../errors';
import { body, rejectUnexpectedKeys } from '../../request';
import {
  QUOTA_COUNTS,
  QUOTA_CYCLE_KINDS,
  assertConnectionEvent,
  assertJob,
  assertNodeBindings,
  assertNodeDetail,
  assertNodeErrorRow,
  assertNodeHistoryEntry,
  assertNodeSummary,
  healthWordForVerdict,
  type NodeDetailDto,
  type NodeSummaryDto,
  type NodeVerdict,
} from '../contract';
import { enqueueJob, JOB_TYPES, listJobs, type JobTypeName } from '../jobs';
import { operationsLive } from '../live';
import { closeOpenCycle, readAgentNetCounters, rollNodeCycle } from '../quota';
import {
  Actor,
  Env,
  Row,
  afterCursor,
  auditWrite,
  check,
  decodeName,
  encodeCursor,
  entityJson,
  id,
  jsonNoStore,
  jsonWithEtag,
  listJson,
  measured,
  missingTable,
  notModified,
  now,
  nullInt,
  nullNum,
  nullText,
  pageParams,
  parseListed,
  parseRange,
  rangeSeconds,
  weakEtag,
} from './common';
import {
  bindingsOf,
  catalogNames,
  eventDto,
  factsFrom,
  forwardPath,
  historyDto,
  incidentCount,
  isVerdict,
  jobDto,
  lifecycleOf,
  loadProfile,
  occupancy,
  quotaDto,
  recentErrors,
  requireNode,
  returnPath,
  summaryChores,
  worstForward,
  worstReturn,
} from './nodes-data';

export { jobDto };

export async function getNodes(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const { cursor, limit, since } = pageParams(url);
  const verdictFilter = url.searchParams.get('verdict');
  if (verdictFilter != null && verdictFilter !== '' && !isVerdict(verdictFilter)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid verdict');
  }
  const listed = parseListed(url.searchParams.get('listed'));
  const names = await catalogNames(e);
  let statusRows: Row[] = [];
  let profileRows: Row[] = [];
  try {
    statusRows = (await e.DB.prepare('SELECT * FROM ops_node_status').all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  try {
    profileRows = (await e.DB.prepare('SELECT * FROM ops_node_profiles').all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const statusBy = new Map(statusRows.map((row) => [String(row.node_name), row]));
  const profileBy = new Map(profileRows.map((row) => [String(row.catalog_name), row]));
  const allNames = new Set<string>([...statusBy.keys(), ...profileBy.keys(), ...(names ?? [])]);
  const live = await operationsLive(e);
  for (const agent of live.agents ?? []) {
    if (typeof agent?.name === 'string') allNames.add(agent.name);
  }
  const t = now();
  const items: NodeSummaryDto[] = [];
  for (const name of allNames) {
    const status = statusBy.get(name) ?? null;
    const profile = profileBy.get(name) ?? null;
    const catalogListed = names
      ? names.has(name)
      : (status?.catalog_listed == null ? null : Number(status.catalog_listed) === 1);
    const verdict: NodeVerdict = status && isVerdict(String(status.verdict))
      ? String(status.verdict) as NodeVerdict
      : 'unknown';
    if (verdictFilter && verdict !== verdictFilter) continue;
    if (listed != null && catalogListed !== listed) continue;
    const updatedAt = nullInt(status?.evaluated_at) ?? nullInt(profile?.updated_at) ?? t;
    if (since != null && updatedAt < since) continue;
    const word = healthWordForVerdict(verdict);
    const agent = (live.agents ?? []).find((row) => row?.name === name) ?? null;
    const [quota, forward, ret, occ, bindings, incidents] = await Promise.all([
      quotaDto(e, name, profile),
      forwardPath(e, name, t - 86_400),
      Promise.resolve(returnPath(agent)),
      occupancy(e, name),
      bindingsOf(e, name, catalogListed, agent),
      incidentCount(e, name),
    ]);
    const facts = factsFrom(profile, agent, updatedAt);
    items.push({
      name, verdict, health: word.word, tone: word.tone,
      reason: status?.reason == null ? null : String(status.reason),
      lifecycle: lifecycleOf(profile, catalogListed), catalogListed,
      region: facts.region, provider: facts.provider,
      occupancy: measured(occ.rows.length, occ.asOf, 'telemetry'),
      quota: measured(quota.dto, quota.asOf, 'profile'),
      forwardWorst: measured(worstForward(forward.rows), forward.asOf, 'telemetry'),
      returnWorst: measured(worstReturn(ret.rows), ret.asOf, 'komari'),
      renewsAt: facts.renewsAt, expiresAt: facts.expiresAt,
      choreCount: summaryChores(bindings, quota.dto, facts, t),
      incidentCount: incidents, updatedAt,
    });
  }
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const filtered = items.filter((row) => afterCursor(cursor, row.name, row.name, 'asc'));
  const page = filtered.slice(0, limit + 1);
  const sliced = page.length > limit ? page.slice(0, limit) : page;
  const last = sliced[sliced.length - 1];
  const nextCursor = page.length > limit && last ? encodeCursor(last.name, last.name) : null;
  const updatedAt = items.reduce((max, row) => Math.max(max, row.updatedAt), t);
  return listJson(
    e, req, sliced, nextCursor, updatedAt,
    weakEtag([updatedAt, items.length, verdictFilter, listed == null ? '-' : listed ? 1 : 0, since]),
    assertNodeSummary, items.length,
  );
}

export async function getNode(req: Request, e: Env, rawName: string): Promise<Response> {
  const name = decodeName(rawName);
  const { profile, status, listed, agent } = await requireNode(e, name);
  const t = now();
  const verdict: NodeVerdict = status && isVerdict(String(status.verdict))
    ? String(status.verdict) as NodeVerdict
    : 'unknown';
  const word = healthWordForVerdict(verdict);
  const updatedAt = nullInt(status?.evaluated_at) ?? nullInt(profile?.updated_at) ?? t;
  const etag = weakEtag([name, updatedAt]);
  const [quota, forward, ret, occ, errors, jobs, history, bindings] = await Promise.all([
    quotaDto(e, name, profile),
    forwardPath(e, name, t - 86_400),
    Promise.resolve(returnPath(agent)),
    occupancy(e, name),
    recentErrors(e, name, t - 7 * 86_400),
    listJobs(e.DB, { nodeName: name, limit: 10 }),
    (async () => {
      try {
        return (await e.DB.prepare(
          'SELECT * FROM ops_node_status_history WHERE node_name = ? ORDER BY at DESC, id DESC LIMIT 20',
        ).bind(name).all<Row>()).results ?? [];
      } catch (error) {
        if (!missingTable(error)) throw error;
        return [] as Row[];
      }
    })(),
    bindingsOf(e, name, listed, agent),
  ]);
  const dto: NodeDetailDto = {
    name, verdict, health: word.word, tone: word.tone,
    reason: status?.reason == null ? null : String(status.reason),
    lifecycle: lifecycleOf(profile, listed), catalogListed: listed,
    facts: factsFrom(profile, agent, updatedAt), bindings,
    forwardPath: measured(forward.rows, forward.asOf, 'telemetry'),
    returnPath: measured(ret.rows, ret.asOf, 'komari'),
    occupancy: measured(occ.rows, occ.asOf, 'telemetry'),
    quota: measured(quota.dto, quota.asOf, 'profile'),
    recentErrors: measured(errors.rows, errors.asOf, 'jobs'),
    jobs: jobs.jobs.map(jobDto),
    history: history.map(historyDto),
    updatedAt,
  };
  return entityJson(e, req, dto, etag, assertNodeDetail);
}

export async function getNodeBindings(req: Request, e: Env, rawName: string): Promise<Response> {
  const name = decodeName(rawName);
  const { listed, agent } = await requireNode(e, name);
  const dto = await bindingsOf(e, name, listed, agent);
  return entityJson(
    e, req, dto,
    weakEtag([name, dto.asOfSec, Number(dto.catalog), Number(dto.exitToken), Number(dto.komari)]),
    assertNodeBindings,
  );
}

export async function getNodeHistory(req: Request, e: Env, rawName: string): Promise<Response> {
  const name = decodeName(rawName);
  await requireNode(e, name);
  const { cursor, limit } = pageParams(new URL(req.url));
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      'SELECT * FROM ops_node_status_history WHERE node_name = ? ORDER BY at DESC, id DESC LIMIT 500',
    ).bind(name).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items = rows.map(historyDto).filter((row) => afterCursor(cursor, String(row.at), `${row.at}:${row.verdict}`, 'desc'));
  const page = items.slice(0, limit + 1);
  const sliced = page.length > limit ? page.slice(0, limit) : page;
  const last = sliced[sliced.length - 1];
  const nextCursor = page.length > limit && last ? encodeCursor(String(last.at), `${last.at}:${last.verdict}`) : null;
  const updatedAt = sliced[0]?.at ?? now();
  return listJson(e, req, sliced, nextCursor, updatedAt, weakEtag([name, updatedAt, rows.length]), assertNodeHistoryEntry);
}

export async function getNodeConnections(req: Request, e: Env, rawName: string): Promise<Response> {
  const name = decodeName(rawName);
  await requireNode(e, name);
  const { cursor, limit } = pageParams(new URL(req.url));
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      'SELECT * FROM connection_events WHERE node = ? ORDER BY at_ms DESC, id DESC LIMIT 500',
    ).bind(name).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items = rows.map(eventDto).filter((row) => afterCursor(cursor, String(row.atMs), row.id, 'desc'));
  const page = items.slice(0, limit + 1);
  const sliced = page.length > limit ? page.slice(0, limit) : page;
  const last = sliced[sliced.length - 1];
  const nextCursor = page.length > limit && last ? encodeCursor(String(last.atMs), last.id) : null;
  const updatedAt = sliced[0] ? Math.floor(sliced[0].atMs / 1000) : now();
  return listJson(e, req, sliced, nextCursor, updatedAt, weakEtag([name, updatedAt, rows.length]), assertConnectionEvent);
}

export async function getNodeErrors(req: Request, e: Env, rawName: string): Promise<Response> {
  const name = decodeName(rawName);
  await requireNode(e, name);
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  const errors = await recentErrors(e, name, now() - rangeSeconds(range));
  const dto = measured(errors.rows, errors.asOf, 'jobs');
  const etag = weakEtag([name, range, errors.asOf, errors.rows.length]);
  const hit = notModified(req, etag);
  if (hit) return hit;
  check(e, () => {
    for (const row of errors.rows) assertNodeErrorRow(row);
  });
  return jsonWithEtag(dto, etag);
}

export async function getNodeJobs(req: Request, e: Env, rawName: string): Promise<Response> {
  const name = decodeName(rawName);
  await requireNode(e, name);
  const { limit } = pageParams(new URL(req.url));
  const listed = await listJobs(e.DB, { nodeName: name, limit });
  const items = listed.jobs.map(jobDto);
  const updatedAt = items[0]?.updatedAt ?? now();
  return listJson(e, req, items, null, updatedAt, weakEtag([name, updatedAt, items.length]), assertJob);
}

export async function postNodeJob(req: Request, e: Env, rawName: string, actor: Actor): Promise<Response> {
  const name = decodeName(rawName);
  await requireNode(e, name);
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, ['type', 'params', 'confirmName', 'incidentId', 'idempotencyKey']);
  const type = String(b.type ?? '');
  if (!Object.prototype.hasOwnProperty.call(JOB_TYPES, type)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown job type');
  }
  if (JOB_TYPES[type as JobTypeName].destructive && b.confirmName !== name) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'confirmName must match the node name');
  }
  const result = await enqueueJob(e.DB, {
    nodeName: name, type, params: b.params, requestedBy: actor.email,
    incidentId: b.incidentId == null ? null : String(b.incidentId),
    idempotencyKey: b.idempotencyKey == null ? undefined : String(b.idempotencyKey),
  }, now());
  await auditWrite(e, actor.email, 'node.job.enqueue', 'node', name, `queued ${type} for ${name}`);
  const dto = jobDto(result.job);
  check(e, () => { assertJob(dto); });
  return jsonNoStore(dto, result.created ? 201 : 200);
}

const PROFILE_KEYS = [
  'provider', 'providerAccountId', 'region', 'lineTags', 'port', 'price',
  'currency', 'billingCycle', 'renewsAt', 'expiresAt', 'notes', 'quota',
];

type QuotaPatch = { quotaBytes: number; cycleKind: string; cycleAnchorDay: number; counts: string };
type ProfilePatch = {
  provider?: string | null; providerAccountId?: string | null; region?: string | null;
  lineTags?: string[] | null; price?: number | null; currency?: string | null;
  billingCycle?: number | null; renewsAt?: number | null; expiresAt?: number | null;
  notes?: string | null; quota?: QuotaPatch | null;
};

function optionalText(value: unknown, name: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return str(value, name, 1, max);
}

function optionalInt(value: unknown, name: string, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value as number;
}

function optionalPrice(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid price');
  }
  return value;
}

function optionalCurrency3(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid currency');
  }
  return value.toUpperCase();
}

function optionalLineTags(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 8) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid lineTags');
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.length < 1 || item.length > 32) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid lineTags');
    }
  }
  return value as string[];
}

function parseQuotaPatch(value: unknown): QuotaPatch | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  rejectUnexpectedKeys(value, ['quotaBytes', 'cycleKind', 'cycleAnchorDay', 'counts']);
  const quotaBytes = value.quotaBytes;
  if (!Number.isSafeInteger(quotaBytes) || (quotaBytes as number) < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid quotaBytes');
  }
  const cycleKind = String(value.cycleKind ?? '');
  if (!(QUOTA_CYCLE_KINDS as readonly string[]).includes(cycleKind)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cycleKind');
  }
  const cycleAnchorDay = value.cycleAnchorDay;
  if (!Number.isSafeInteger(cycleAnchorDay) || (cycleAnchorDay as number) < 1 || (cycleAnchorDay as number) > 31) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cycleAnchorDay');
  }
  const counts = String(value.counts ?? '');
  if (!(QUOTA_COUNTS as readonly string[]).includes(counts)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid counts');
  }
  return { quotaBytes: quotaBytes as number, cycleKind, cycleAnchorDay: cycleAnchorDay as number, counts };
}

function parseProfilePatch(b: Row): ProfilePatch {
  optionalInt(b.port, 'port', 1, 65_535);
  return {
    provider: optionalText(b.provider, 'provider', 80),
    providerAccountId: optionalText(b.providerAccountId, 'providerAccountId', 100),
    region: optionalText(b.region, 'region', 80),
    lineTags: optionalLineTags(b.lineTags),
    price: optionalPrice(b.price),
    currency: optionalCurrency3(b.currency),
    billingCycle: optionalInt(b.billingCycle, 'billingCycle', 1, 3660),
    renewsAt: optionalInt(b.renewsAt, 'renewsAt', 1, Number.MAX_SAFE_INTEGER),
    expiresAt: optionalInt(b.expiresAt, 'expiresAt', 1, Number.MAX_SAFE_INTEGER),
    notes: optionalText(b.notes, 'notes', 2000),
    quota: parseQuotaPatch(b.quota),
  };
}

function pick<T>(patch: T | undefined, existing: T | null): T | null {
  return patch === undefined ? existing : patch;
}

async function applyProfilePatch(e: Env, name: string, patch: ProfilePatch): Promise<void> {
  const t = now();
  if (patch.providerAccountId) {
    const account = await e.DB.prepare('SELECT id FROM provider_accounts WHERE id = ?')
      .bind(patch.providerAccountId).first<Row>();
    if (!account) throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown providerAccountId');
  }
  const existing = await loadProfile(e, name);
  const tagsJson = patch.lineTags === undefined
    ? (existing?.line_tags_json == null ? null : String(existing.line_tags_json))
    : (patch.lineTags == null || patch.lineTags.length === 0 ? null : JSON.stringify(patch.lineTags));
  let quotaBytes = existing?.traffic_quota_bytes == null ? null : Number(existing.traffic_quota_bytes);
  let quotaCounts = nullText(existing?.quota_counts);
  let cycleKind = nullText(existing?.cycle_kind);
  let cycleAnchorDay = nullInt(existing?.cycle_anchor_day);
  if (patch.quota === null) {
    quotaBytes = null;
    quotaCounts = null;
    cycleKind = null;
    cycleAnchorDay = null;
  } else if (patch.quota) {
    quotaBytes = patch.quota.quotaBytes;
    quotaCounts = patch.quota.counts;
    cycleKind = patch.quota.cycleKind;
    cycleAnchorDay = patch.quota.cycleAnchorDay;
  }
  const provider = pick(patch.provider, nullText(existing?.provider));
  const providerAccountId = pick(patch.providerAccountId, nullText(existing?.provider_account_id));
  const region = pick(patch.region, nullText(existing?.region));
  const price = pick(patch.price, nullNum(existing?.price));
  const currency = pick(patch.currency, nullText(existing?.currency));
  const billingCycle = pick(patch.billingCycle, nullInt(existing?.billing_cycle));
  const renewsAt = pick(patch.renewsAt, nullInt(existing?.renews_at));
  const expiresAt = pick(patch.expiresAt, nullInt(existing?.expires_at));
  const notes = pick(patch.notes, nullText(existing?.notes));
  if (!existing) {
    await e.DB.prepare(
      `INSERT INTO ops_node_profiles(
         id, catalog_name, status, created_at, updated_at,
         provider, provider_account_id, region, line_tags_json, price, currency, billing_cycle,
         renews_at, expires_at, notes, traffic_quota_bytes, quota_counts, cycle_kind, cycle_anchor_day
       ) VALUES(?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id(), name, t, t,
      provider, providerAccountId, region, tagsJson, price, currency, billingCycle,
      renewsAt, expiresAt, notes, quotaBytes, quotaCounts, cycleKind, cycleAnchorDay,
    ).run();
  } else {
    await e.DB.prepare(
      `UPDATE ops_node_profiles SET
         provider = ?, provider_account_id = ?, region = ?, line_tags_json = ?,
         price = ?, currency = ?, billing_cycle = ?, renews_at = ?, expires_at = ?, notes = ?,
         traffic_quota_bytes = ?, quota_counts = ?, cycle_kind = ?, cycle_anchor_day = ?, updated_at = ?
       WHERE catalog_name = ?`,
    ).bind(
      provider, providerAccountId, region, tagsJson,
      price, currency, billingCycle, renewsAt, expiresAt, notes,
      quotaBytes, quotaCounts, cycleKind, cycleAnchorDay, t, name,
    ).run();
  }
  if (patch.quota === null) {
    await closeOpenCycle(e.DB, name, t);
  } else if (patch.quota) {
    const counters = await readAgentNetCounters(e.DB, name) ?? { in: 0, out: 0, at: t };
    await rollNodeCycle(e.DB, name, {
      trafficQuotaBytes: patch.quota.quotaBytes,
      cycleKind: patch.quota.cycleKind,
      cycleAnchorDay: patch.quota.cycleAnchorDay,
      quotaCounts: patch.quota.counts,
    }, counters, t);
  }
}

export async function patchNodeProfile(req: Request, e: Env, rawName: string, actor: Actor): Promise<Response> {
  const name = decodeName(rawName);
  await requireNode(e, name);
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, PROFILE_KEYS);
  await applyProfilePatch(e, name, parseProfilePatch(b));
  await auditWrite(e, actor.email, 'node.profile.update', 'node', name, `updated profile for ${name}`);
  return getNode(req, e, rawName);
}
