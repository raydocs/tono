import { ApiError } from '../../errors';
import { body, rejectUnexpectedKeys } from '../../request';
import {
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
  jsonNoStore,
  jsonWithEtag,
  listJson,
  measured,
  missingTable,
  notModified,
  now,
  nullInt,
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
