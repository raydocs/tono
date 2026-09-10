// Side effects that ride on existing ingest routes. Failures here must never
// change the HTTP response the client already earned.

import { type Env, type Row, now, id, str } from '../env';
import { ApiError } from '../errors';
import { DIAGNOSTICS_MAX_REPORTED_AT_MS } from '../diagnostics-limits';
import { redactJobResult } from './jobs';
import { rejectUnexpectedKeys, body } from '../request';
import {
  edgeAttribution,
  flattenWindow,
  sniffPlatform,
  type EdgeCf,
  type FlattenWindowRow,
} from './flatten';
import { accrueActivityHours, applyFailureToStatus, applyWindowToStatus } from './customers';
import { parseAuditSegment, writeParsedSegment } from './traffic-parse';
import { planAndSendAlerts, runCustomerVerdictPass, runNodeVerdictPass } from './verdict-run';
import { loadKnownExitAsns, upsertExitAsn } from './exit-asns';

const LOG_PARSE_MAX = 2 * 1024 * 1024;
// 20k realistic JSONL lines inflate to ~5-6 MiB. 16 MiB is a generous
// backstop so a 2 MiB gzip cannot expand ~1000x before the line cap runs.
export const LOG_INFLATED_MAX_BYTES = 16 * 1024 * 1024;
const CORE_ERRORS_MAX = 20;
const CORE_ERROR_CHARS = 200;
const FAILURE_KEYS = [
  'ts', 'stage', 'code', 'error', 'node', 'appVersion', 'osVersion', 'osArch',
  'platform', 'coreErrors', 'tcpDelayMs', 'exitDelayMs',
  'attemptId',
];
const PLATFORMS = new Set(['windows', 'macos', 'linux', 'android', 'ios']);

function clip(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).slice(0, 300);
}

function requestCf(req: Request): EdgeCf | undefined {
  return req.cf as EdgeCf | undefined;
}

async function swallow(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(label, clip(error));
  }
}

async function knownExitAsnsOrEmpty(db: D1Database): Promise<Set<number>> {
  try {
    return await loadKnownExitAsns(db);
  } catch (error) {
    console.error('ops known exit asns failed', clip(error));
    return new Set();
  }
}

export async function recordExitAgentAsn(
  e: Env,
  req: Request,
  nodeHint: string | null,
): Promise<void> {
  await swallow('ops exit asn failed', () =>
    upsertExitAsn(e.DB, requestCf(req), nodeHint, now()),
  );
}

async function inflateGzipBounded(bytes: Uint8Array, maxBytes: number): Promise<string | null> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(out);
}

export type StoredTelemetryWindow = FlattenWindowRow & {
  window_start_ms?: number | null;
  window_end_ms?: number | null;
};

export async function afterTelemetryWindow(
  e: Env,
  req: Request,
  row: StoredTelemetryWindow,
): Promise<void> {
  const knownExitAsns = await knownExitAsnsOrEmpty(e.DB);
  const edge = edgeAttribution(requestCf(req), knownExitAsns);
  const customerEdge = {
    asn: edge.edge_asn,
    asOrg: edge.edge_as_org,
    country: edge.edge_country,
    region: edge.edge_region,
  };
  const t = now();
  await swallow('ops telemetry flatten failed', () => flattenWindow(e.DB, row, edge));
  await swallow('ops telemetry status failed', () => applyWindowToStatus(e.DB, row, customerEdge, t));
  await swallow('ops telemetry hours failed', () => accrueActivityHours(e.DB, row, t));
  await alertAfterCustomerPass(e, row.user_id, t, 'ops telemetry');
}

/**
 * A customer's pass is where a customer incident opens, and an incident
 * emits its 'open' transition exactly once. Dropping it here meant every
 * user-subject alert rule was silent forever: the cron pass five minutes
 * later found the incident already live and had nothing to announce.
 */
async function alertAfterCustomerPass(e: Env, userId: string, t: number, what: string): Promise<void> {
  let transitions: Awaited<ReturnType<typeof runCustomerVerdictPass>>['transitions'] = [];
  await swallow(`${what} verdict failed`, async () => {
    transitions = (await runCustomerVerdictPass(e, userId, t)).transitions;
  });
  if (transitions.length === 0) return;
  await swallow(`${what} alerts failed`, () => planAndSendAlerts(e, transitions, t));
}

export async function afterSnapshot(e: Env, nowSec: number): Promise<void> {
  let transitions: Awaited<ReturnType<typeof runNodeVerdictPass>>['transitions'] = [];
  await swallow('ops snapshot verdict failed', async () => {
    const result = await runNodeVerdictPass(e, nowSec);
    transitions = result.transitions;
  });
  await swallow('ops snapshot alerts failed', () => planAndSendAlerts(e, transitions, nowSec));
}

export async function afterLogSegment(
  e: Env,
  input: { userId: string; deviceId: string | null; bytes: Uint8Array; receivedAt: number; segmentId: string },
): Promise<void> {
  if (e.OPS_TRAFFIC_PARSE === '0') return;
  if (input.bytes.byteLength > LOG_PARSE_MAX) {
    console.error('ops traffic parse: segment exceeds 2 MiB, skipping', input.bytes.byteLength);
    return;
  }
  await swallow('ops traffic parse failed', async () => {
    const inflated = await inflateGzipBounded(input.bytes, LOG_INFLATED_MAX_BYTES);
    if (inflated == null) {
      console.error('ops traffic parse: inflated segment exceeds 16 MiB, skipping');
      return;
    }
    const parsed = await parseAuditSegment(inflated, {
      userId: input.userId,
      deviceId: input.deviceId,
      receivedAt: input.receivedAt,
      gunzip: false,
    });
    await writeParsedSegment(e.DB, parsed, now(), input.segmentId);
  });
}

function optionalInt(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 120_000) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value;
}

function coreErrorsOf(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > CORE_ERRORS_MAX) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid coreErrors');
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length > CORE_ERROR_CHARS) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid coreErrors');
    }
    if (item.length) out.push(item);
  }
  return out;
}

function failureError(b: Row, cores: string[]): string | null {
  if (typeof b.error === 'string' && b.error.trim()) {
    return redactJobResult(b.error).slice(0, 200);
  }
  if (cores[0]) return redactJobResult(cores[0]).slice(0, 200);
  return null;
}

export async function ingestConnectFailure(
  req: Request,
  e: Env,
  a: { userId: string; deviceId: string | null },
): Promise<Response> {
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, FAILURE_KEYS);
  if (typeof b.ts !== 'number' || !Number.isSafeInteger(b.ts) || b.ts < 0
      || b.ts > DIAGNOSTICS_MAX_REPORTED_AT_MS) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid ts');
  }
  const stage = str(b.stage, 'stage', 1, 40);
  const code = str(b.code, 'code', 1, 80);
  const node = str(b.node, 'node', 1, 120);
  const appVersion = str(b.appVersion, 'appVersion', 1, 40);
  const osVersion = str(b.osVersion, 'osVersion', 1, 80);
  const osArch = str(b.osArch, 'osArch', 1, 32);
  let platform: string | null = null;
  if (b.platform !== undefined && b.platform !== null) {
    platform = str(b.platform, 'platform', 1, 20);
    if (!PLATFORMS.has(platform)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid platform');
  } else {
    platform = sniffPlatform(osVersion);
  }
  const cores = coreErrorsOf(b.coreErrors);
  const tcpDelayMs = optionalInt(b.tcpDelayMs, 'tcpDelayMs');
  const exitDelayMs = optionalInt(b.exitDelayMs, 'exitDelayMs');
  let attemptId: string | null = null;
  if (b.attemptId !== undefined && b.attemptId !== null) {
    attemptId = str(b.attemptId, 'attemptId', 1, 64);
  }
  const errorText = failureError(b, cores);
  const t = now();
  // A client clock ahead of ours must not plant a failure that every
  // "recent" window counts for a month: like flatten, cap at receipt time.
  const atMs = Math.min(b.ts >= 1_000_000_000_000 ? b.ts : b.ts * 1000, t * 1000);
  const edge = edgeAttribution(requestCf(req), await knownExitAsnsOrEmpty(e.DB));
  const inserted = await e.DB.prepare(
    `INSERT OR IGNORE INTO connection_events(
       id, at_ms, received_at, source, window_id, user_id, device_id,
       platform, app_version, os_version, os_arch,
       kind, node, stage, outcome, code, error,
       elapsed_ms, delay_ms, exit_delay_ms, tcp_delay_ms, catalog_revision,
       edge_asn, edge_as_org, edge_country, edge_region, edge_via_exit, attempt_id
     ) VALUES(?, ?, ?, 'failure', NULL, ?, ?, ?, ?, ?, ?, 'connectFail', ?, ?, NULL, ?, ?,
              NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id(), atMs, t, a.userId, a.deviceId,
    platform, appVersion, osVersion, osArch,
    node, stage, code, errorText,
    exitDelayMs, tcpDelayMs,
    edge.edge_asn, edge.edge_as_org, edge.edge_country, edge.edge_region, edge.edge_via_exit,
    attemptId,
  ).run();
  if (Number(inserted.meta.changes ?? 0) > 0) {
    await swallow('ops failure status failed', () => applyFailureToStatus(e.DB, {
      userId: a.userId,
      deviceId: a.deviceId,
      code,
      node,
      nowSec: t,
      platform,
      appVersion,
      osVersion,
      tcpDelayMs,
      exitDelayMs,
    }));
  }
  await alertAfterCustomerPass(e, a.userId, t, 'ops failure');
  return Response.json({ accepted: true }, { status: 202 });
}
