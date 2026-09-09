// Operator asks (enqueue), agent performs (lease/complete). Same contract as
// device_actions: the row is the ask, status changes are the perform. Not wired
// into index.ts; this module is the whole surface.

import { sha256 } from '../crypto';
import { type Env, type Row, id, str } from '../env';
import { ApiError } from '../errors';
import { opsAuditStatement } from '../product-account';
import { rejectUnexpectedKeys } from '../request';

const DEFAULT_TTL_SECONDS = 900;
const DEFAULT_LEASE_SECONDS = 120;
const BATCH_LIMIT = 50;
const PARAMS_MAX = 2048;
const SUMMARY_MAX = 500;
const RESULT_JSON_MAX = 16384;
const NAME_MAX = 200;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PASSWORD_RE = /\bpassword\b/gi;
const CARRIERS = new Set(['ct', 'cu', 'cm']);
const EXECUTORS = new Set(['hub', 'exit_agent', 'worker']);
const STATUSES = new Set(['queued', 'leased', 'succeeded', 'failed', 'cancelled', 'expired']);
const RESULT_STATUSES = new Set(['ok', 'error', 'timeout']);

export type Executor = 'hub' | 'exit_agent' | 'worker';
export type JobStatus = 'queued' | 'leased' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
export type ResultStatus = 'ok' | 'error' | 'timeout';
type ParamGuard = (value: unknown) => void;

export type JobTypeConfig = {
  executor: Executor;
  leaseSeconds: number;
  destructive: boolean;
  readOnly: boolean;
  requiredParams?: readonly string[];
  paramsSchema: Record<string, ParamGuard>;
};

const intAtMost = (name: string, max: number, min = 0): ParamGuard => (value) => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
};

const carriersParam: ParamGuard = (value) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !CARRIERS.has(item))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid carriers');
  }
};

const homeExitIdParam: ParamGuard = (value) => {
  str(value, 'homeExitId', 1, NAME_MAX);
};

const read = (executor: Executor, leaseSeconds: number, schema: JobTypeConfig['paramsSchema'] = {}, required?: readonly string[]): JobTypeConfig => ({
  executor, leaseSeconds, destructive: false, readOnly: true, paramsSchema: schema, requiredParams: required,
});
const write = (executor: Executor, leaseSeconds: number): JobTypeConfig => ({
  executor, leaseSeconds, destructive: true, readOnly: false, paramsSchema: {},
});

// v1 executor policy: everything that touches a machine runs on the hub, which
// already holds the SSH keys and the collector token. `catalog_*` never leaves
// the Worker (it is a catalog publish, not a node operation). `exit_agent` is
// reserved for a later `/api/v1/home/jobs` and is not assigned to any type yet.
export const JOB_TYPES = {
  xray_dial_errors: read('hub', DEFAULT_LEASE_SECONDS, { sinceMinutes: intAtMost('sinceMinutes', 240), maxLines: intAtMost('maxLines', 400, 1) }),
  xray_error_digest: read('hub', DEFAULT_LEASE_SECONDS, { sinceMinutes: intAtMost('sinceMinutes', 240) }),
  collect_quality: read('hub', 600),
  node_probe: read('hub', 600, { carriers: carriersParam }),
  node_config_snapshot: read('hub', 600),
  xray_restart: write('hub', 60),
  identity_sync: write('hub', DEFAULT_LEASE_SECONDS),
  agent_reinstall: write('hub', DEFAULT_LEASE_SECONDS),
  catalog_retire: write('worker', DEFAULT_LEASE_SECONDS),
  catalog_relist: write('worker', DEFAULT_LEASE_SECONDS),
  home_line_probe: read('hub', DEFAULT_LEASE_SECONDS, { homeExitId: homeExitIdParam }, ['homeExitId']),
} as const satisfies Record<string, JobTypeConfig>;

export type JobTypeName = keyof typeof JOB_TYPES;

export type NodeJob = {
  id: string;
  nodeName: string;
  executor: Executor;
  type: JobTypeName;
  params: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  requestedBy: string;
  incidentId: string | null;
  createdAt: number;
  notBefore: number;
  expiresAt: number;
  leaseId: string | null;
  leaseExpiresAt: number | null;
  leasedAt: number | null;
  completedAt: number | null;
  resultStatus: ResultStatus | null;
  resultSummary: string | null;
  resultJson: string | null;
  updatedAt: number;
};

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function asEnv(db: D1Database): Env {
  return { DB: db } as Env;
}

function jobType(type: string): JobTypeName {
  if (!Object.prototype.hasOwnProperty.call(JOB_TYPES, type)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown job type');
  }
  return type as JobTypeName;
}

function canonicalParams(params: unknown): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>).sort().map((key) => [key, sort((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  return JSON.stringify(sort(params ?? {}));
}

function parseParams(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw === '') return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const optStr = (v: unknown) => v == null ? null : String(v);
const optNum = (v: unknown) => v == null ? null : Number(v);

function rowToJob(row: Row): NodeJob {
  return {
    id: String(row.id), nodeName: String(row.node_name), executor: String(row.executor) as Executor,
    type: String(row.type) as JobTypeName, params: parseParams(row.params_json),
    status: String(row.status) as JobStatus, attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts),
    idempotencyKey: String(row.idempotency_key), requestedBy: String(row.requested_by),
    incidentId: optStr(row.incident_id), createdAt: Number(row.created_at), notBefore: Number(row.not_before),
    expiresAt: Number(row.expires_at), leaseId: optStr(row.lease_id), leaseExpiresAt: optNum(row.lease_expires_at),
    leasedAt: optNum(row.leased_at), completedAt: optNum(row.completed_at),
    resultStatus: optStr(row.result_status) as ResultStatus | null,
    resultSummary: optStr(row.result_summary), resultJson: optStr(row.result_json), updatedAt: Number(row.updated_at),
  };
}

function decodeCursor(cursor: string): { createdAt: number; id: string } {
  let decoded: string;
  try {
    decoded = atob(cursor.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((cursor.length + 3) % 4));
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cursor');
  }
  const parsed = decoded.match(/^(\d{1,12}):(.{1,100})$/);
  if (!parsed) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cursor');
  return { createdAt: Number(parsed[1]), id: parsed[2] };
}

function leaseSecondsSql(): string {
  const arms = Object.entries(JOB_TYPES)
    .filter(([, config]) => config.leaseSeconds !== DEFAULT_LEASE_SECONDS)
    .map(([type, config]) => `WHEN '${type}' THEN ${config.leaseSeconds}`)
    .join(' ');
  return `CASE type ${arms} ELSE ${DEFAULT_LEASE_SECONDS} END`;
}

function idsIn(where: string): string {
  // Nested SELECT so SQLite will apply ORDER BY/LIMIT when the outer UPDATE
  // reads the same table; a bare IN-subquery drops the order without LIMIT.
  return `id IN (SELECT id FROM (SELECT id FROM ops_node_jobs WHERE ${where} ORDER BY created_at ASC, id ASC LIMIT ?) AS batch)`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

export function redactJobResult(text: string, allowlistedIp?: string | null): string {
  const allow = typeof allowlistedIp === 'string' && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(allowlistedIp) ? allowlistedIp : null;
  for (const re of [UUID_RE, EMAIL_RE, IPV4_RE, PASSWORD_RE]) re.lastIndex = 0;
  return text
    .replace(UUID_RE, '[redacted]')
    .replace(EMAIL_RE, '[redacted]')
    .replace(IPV4_RE, (match) => (allow && match === allow ? match : '[redacted]'))
    .replace(PASSWORD_RE, '[redacted]');
}

export function validateJobRequest(type: string, params: unknown): { ok: true } {
  const name = jobType(type);
  const config = JOB_TYPES[name];
  const body = params === undefined || params === null ? {} : params;
  rejectUnexpectedKeys(body, Object.keys(config.paramsSchema));
  for (const key of config.requiredParams ?? []) {
    if ((body as Record<string, unknown>)[key] === undefined) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Missing ${key}`);
    }
  }
  for (const [key, guard] of Object.entries(config.paramsSchema)) {
    const value = (body as Record<string, unknown>)[key];
    if (value !== undefined) guard(value);
  }
  return { ok: true };
}

export async function defaultIdempotencyKey(
  type: string,
  node: string,
  params: unknown,
  nowSec: number,
): Promise<string> {
  return sha256(`${jobType(type)}|${node}|${canonicalParams(params)}|${Math.floor(nowSec / 60)}`);
}

export async function enqueueJob(
  db: D1Database,
  request: { nodeName: string; type: string; params?: unknown; requestedBy: string; incidentId?: string | null; idempotencyKey?: string },
  nowSec: number,
): Promise<{ job: NodeJob; created: boolean }> {
  validateJobRequest(request.type, request.params);
  const type = request.type as JobTypeName;
  const nodeName = str(request.nodeName, 'nodeName', 1, NAME_MAX);
  const requestedBy = str(request.requestedBy, 'requestedBy', 1, 254);
  const incidentId = request.incidentId == null || request.incidentId === ''
    ? null
    : str(request.incidentId, 'incidentId', 1, 200);
  const paramsJson = canonicalParams(request.params);
  if (paramsJson.length > PARAMS_MAX) throw new ApiError(400, 'VALIDATION_ERROR', 'params too large');
  const idempotencyKey = request.idempotencyKey
    ? str(request.idempotencyKey, 'idempotencyKey', 1, 200)
    : await defaultIdempotencyKey(type, nodeName, request.params, nowSec);
  const jobId = id();
  const config = JOB_TYPES[type];
  try {
    const inserted = await db.batch([
      db.prepare(
        `INSERT INTO ops_node_jobs(
           id, node_name, executor, type, params_json, status, attempts, max_attempts,
           idempotency_key, requested_by, incident_id, created_at, not_before, expires_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, 'queued', 0, 3, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      ).bind(
        jobId, nodeName, config.executor, type, paramsJson, idempotencyKey, requestedBy, incidentId,
        nowSec, nowSec, nowSec + DEFAULT_TTL_SECONDS, nowSec,
      ),
      opsAuditStatement(
        asEnv(db), requestedBy, 'node.job.enqueue', 'node', nodeName,
        truncate(`queued ${type} for ${nodeName}`, SUMMARY_MAX), true,
        { actorType: requestedBy === 'system' ? 'system' : 'access_admin', actorRole: 'owner' },
      ),
    ]);
    const row = await db.prepare('SELECT * FROM ops_node_jobs WHERE idempotency_key = ?').bind(idempotencyKey).first<Row>();
    if (!row) throw new ApiError(500, 'INTERNAL_ERROR', 'Job enqueue did not persist');
    return { job: rowToJob(row), created: Number(inserted[0].meta.changes ?? 0) > 0 };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (missingTable(error)) throw new ApiError(503, 'UNAVAILABLE', 'ops_node_jobs is not available');
    throw error;
  }
}

export async function leaseJobs(
  db: D1Database,
  executor: string,
  max: number,
  nowSec: number,
): Promise<{ leaseId: string; jobs: NodeJob[]; leaseExpiresAt: number }> {
  if (!EXECUTORS.has(executor)) throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown executor');
  const leaseId = id();
  const take = Math.min(Math.max(Number(max) || 0, 0), BATCH_LIMIT);
  if (take === 0) return { leaseId, jobs: [], leaseExpiresAt: nowSec };
  const sql = `UPDATE ops_node_jobs
    SET status = 'leased', lease_id = ?, leased_at = ?,
        lease_expires_at = ? + (${leaseSecondsSql()}),
        attempts = attempts + 1, updated_at = ?
    WHERE ${idsIn('executor = ? AND status = \'queued\' AND not_before <= ? AND expires_at > ?')}`;
  const binds = [leaseId, nowSec, nowSec, nowSec, executor, nowSec, nowSec, take];
  try {
    let rows: Row[] = [];
    try {
      const returning = await db.prepare(`${sql} RETURNING *`).bind(...binds).all<Row>();
      rows = returning.results ?? [];
      if (rows.length === 0 && Number(returning.meta.changes ?? 0) > 0) {
        rows = (await db.prepare('SELECT * FROM ops_node_jobs WHERE lease_id = ?').bind(leaseId).all<Row>()).results;
      }
    } catch (error) {
      if (missingTable(error)) throw error;
      // D1 has supported RETURNING, but a local/old SQLite build may not; claim
      // with the same lease_id and read the rows back.
      await db.prepare(sql).bind(...binds).run();
      rows = (await db.prepare('SELECT * FROM ops_node_jobs WHERE lease_id = ?').bind(leaseId).all<Row>()).results;
    }
    const jobs = rows.map(rowToJob);
    const leaseExpiresAt = jobs.reduce(
      (min, job) => (job.leaseExpiresAt != null && job.leaseExpiresAt < min ? job.leaseExpiresAt : min),
      jobs[0]?.leaseExpiresAt ?? nowSec,
    );
    return { leaseId, jobs, leaseExpiresAt };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (missingTable(error)) return { leaseId, jobs: [], leaseExpiresAt: nowSec };
    throw error;
  }
}

async function requireLeased(db: D1Database, jobId: string, leaseId: string, nowSec: number, extraSet: string, extraBinds: unknown[]): Promise<Row> {
  const changed = await db.prepare(
    `UPDATE ops_node_jobs SET ${extraSet}, updated_at = ?
     WHERE id = ? AND lease_id = ? AND status = 'leased'`,
  ).bind(...extraBinds, nowSec, jobId, leaseId).run();
  if (!Number(changed.meta.changes ?? 0)) {
    throw new ApiError(409, 'JOB_LEASE_CONFLICT', 'Job is not leased by this lease');
  }
  const row = await db.prepare('SELECT * FROM ops_node_jobs WHERE id = ?').bind(jobId).first<Row>();
  if (!row) throw new ApiError(409, 'JOB_LEASE_CONFLICT', 'Job is not leased by this lease');
  return row;
}

export async function heartbeatJob(db: D1Database, jobId: string, leaseId: string, nowSec: number): Promise<NodeJob> {
  try {
    return rowToJob(await requireLeased(db, jobId, leaseId, nowSec, `lease_expires_at = ? + (${leaseSecondsSql()})`, [nowSec]));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (missingTable(error)) throw new ApiError(409, 'JOB_LEASE_CONFLICT', 'Job is not leased by this lease');
    throw error;
  }
}

export async function completeJob(
  db: D1Database,
  jobId: string,
  leaseId: string,
  result: { status: ResultStatus; summary?: string; resultJson?: unknown },
  nowSec: number,
  allowlistedIp?: string | null,
): Promise<NodeJob> {
  if (!RESULT_STATUSES.has(result.status)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid result status');
  const summary = truncate(redactJobResult(String(result.summary ?? ''), allowlistedIp), SUMMARY_MAX);
  const resultJson = result.resultJson === undefined || result.resultJson === null
    ? null
    : truncate(
      redactJobResult(typeof result.resultJson === 'string' ? result.resultJson : JSON.stringify(result.resultJson), allowlistedIp),
      RESULT_JSON_MAX,
    );
  const status = result.status === 'ok' ? 'succeeded' : 'failed';
  try {
    const updated = await db.batch([
      db.prepare(
        `UPDATE ops_node_jobs
         SET status = ?, completed_at = ?, result_status = ?, result_summary = ?, result_json = ?,
             lease_id = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND lease_id = ? AND status = 'leased'`,
      ).bind(status, nowSec, result.status, summary || null, resultJson, nowSec, jobId, leaseId),
      opsAuditStatement(
        asEnv(db), 'system', 'node.job.result', 'node_job', jobId,
        truncate(`${status} ${result.status}: ${summary}`.trim(), SUMMARY_MAX), true,
        { actorType: 'system', actorRole: 'owner' },
      ),
    ]);
    if (!Number(updated[0].meta.changes ?? 0)) {
      throw new ApiError(409, 'JOB_LEASE_CONFLICT', 'Job is not leased by this lease');
    }
    const row = await db.prepare('SELECT * FROM ops_node_jobs WHERE id = ?').bind(jobId).first<Row>();
    return rowToJob(row!);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (missingTable(error)) throw new ApiError(409, 'JOB_LEASE_CONFLICT', 'Job is not leased by this lease');
    throw error;
  }
}

export async function cancelJob(db: D1Database, jobId: string, requestedBy: string, nowSec: number): Promise<NodeJob> {
  str(requestedBy, 'requestedBy', 1, 254);
  try {
    const changed = await db.prepare(
      `UPDATE ops_node_jobs
       SET status = 'cancelled', completed_at = ?, lease_id = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'leased')`,
    ).bind(nowSec, nowSec, jobId).run();
    const row = await db.prepare('SELECT * FROM ops_node_jobs WHERE id = ?').bind(jobId).first<Row>();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
    if (!Number(changed.meta.changes ?? 0)) throw new ApiError(409, 'JOB_NOT_CANCELLABLE', 'Job is not cancellable');
    return rowToJob(row);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (missingTable(error)) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
    throw error;
  }
}

export async function expireStaleJobs(db: D1Database, nowSec: number, limit = 200): Promise<number> {
  let remaining = Math.min(Math.max(limit, 0), 200);
  let changed = 0;
  const run = async (where: string, set: string, binds: unknown[]) => {
    if (remaining <= 0) return;
    const chunk = Math.min(BATCH_LIMIT, remaining);
    const result = await db.prepare(
      `UPDATE ops_node_jobs SET ${set} WHERE ${idsIn(where)}`,
    ).bind(...binds, chunk).run();
    const n = Number(result.meta.changes ?? 0);
    remaining -= n;
    changed += n;
  };
  try {
    while (remaining > 0) {
      const before = changed;
      await run(
        "status = 'leased' AND lease_expires_at <= ? AND attempts < max_attempts",
        "status = 'queued', lease_id = NULL, lease_expires_at = NULL, leased_at = NULL, updated_at = ?",
        [nowSec, nowSec],
      );
      await run(
        "status = 'leased' AND lease_expires_at <= ? AND attempts >= max_attempts",
        "status = 'failed', result_status = 'timeout', result_summary = 'lease_expired', completed_at = ?, lease_id = NULL, lease_expires_at = NULL, updated_at = ?",
        [nowSec, nowSec, nowSec],
      );
      await run(
        "status = 'queued' AND expires_at <= ?",
        "status = 'expired', completed_at = ?, updated_at = ?",
        [nowSec, nowSec, nowSec],
      );
      if (changed === before) break;
    }
    return changed;
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}

export async function listJobs(
  db: D1Database,
  query: { nodeName?: string; status?: string; executor?: string; cursor?: string; limit?: number },
): Promise<{ jobs: NodeJob[]; nextCursor: string | null }> {
  if (query.status != null && !STATUSES.has(query.status)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
  if (query.executor != null && !EXECUTORS.has(query.executor)) throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown executor');
  const nodeName = query.nodeName == null ? '' : str(query.nodeName, 'nodeName', 1, NAME_MAX);
  const limit = Math.min(Math.max(query.limit ?? BATCH_LIMIT, 1), BATCH_LIMIT);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  try {
    const rows = await db.prepare(
      `SELECT * FROM ops_node_jobs
       WHERE (? = '' OR node_name = ?)
         AND (? = '' OR status = ?)
         AND (? = '' OR executor = ?)
         AND (? = 0 OR created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    ).bind(
      nodeName, nodeName,
      query.status ?? '', query.status ?? '',
      query.executor ?? '', query.executor ?? '',
      cursor ? 1 : 0, cursor?.createdAt ?? 0, cursor?.createdAt ?? 0, cursor?.id ?? '',
      limit + 1,
    ).all<Row>();
    const hasMore = rows.results.length > limit;
    const page = hasMore ? rows.results.slice(0, limit) : rows.results;
    const last = page[page.length - 1];
    return {
      jobs: page.map(rowToJob),
      nextCursor: hasMore && last
        ? btoa(`${last.created_at}:${last.id}`).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
        : null,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (missingTable(error)) return { jobs: [], nextCursor: null };
    throw error;
  }
}
