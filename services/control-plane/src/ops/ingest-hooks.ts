// Side effects that ride on existing ingest routes. Failures here must never
// change the HTTP response the client already earned.

import { type Env, type Row, now, id, str } from '../env';
import { ApiError } from '../errors';
import { redactJobResult } from './jobs';
import { rejectUnexpectedKeys, body } from '../request';
import {
  edgeAttribution,
  flattenWindow,
  sniffPlatform,
  type EdgeCf,
  type FlattenWindowRow,
} from './flatten';
import { accrueActivityHours, applyWindowToStatus } from './customers';
import { parseAuditSegment, writeParsedSegment } from './traffic-parse';
import { planAndSendAlerts, runCustomerVerdictPass, runNodeVerdictPass } from './verdict-run';

const LOG_PARSE_MAX = 2 * 1024 * 1024;
const CORE_ERRORS_MAX = 20;
const CORE_ERROR_CHARS = 200;
const FAILURE_KEYS = [
  'ts', 'stage', 'code', 'error', 'node', 'appVersion', 'osVersion', 'osArch',
  'platform', 'coreErrors', 'tcpDelayMs', 'exitDelayMs',
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

export type StoredTelemetryWindow = FlattenWindowRow & {
  window_start_ms?: number | null;
  window_end_ms?: number | null;
};

export async function afterTelemetryWindow(
  e: Env,
  req: Request,
  row: StoredTelemetryWindow,
): Promise<void> {
  // ops_node_profiles stores public_ip, not ASN, so edge_via_exit stays 0
  // until exit ASNs are recorded.
  const knownExitAsns = new Set<number>();
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
  await swallow('ops telemetry verdict failed', () => runCustomerVerdictPass(e, row.user_id, t));
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
  input: { userId: string; deviceId: string | null; bytes: Uint8Array; receivedAt: number },
): Promise<void> {
  if (e.OPS_TRAFFIC_PARSE === '0') return;
  if (input.bytes.byteLength > LOG_PARSE_MAX) {
    console.error('ops traffic parse: segment exceeds 2 MiB, skipping', input.bytes.byteLength);
    return;
  }
  await swallow('ops traffic parse failed', async () => {
    const parsed = await parseAuditSegment(input.bytes, {
      userId: input.userId,
      deviceId: input.deviceId,
      receivedAt: input.receivedAt,
      gunzip: true,
    });
    await writeParsedSegment(e.DB, parsed, now());
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
  if (typeof b.ts !== 'number' || !Number.isSafeInteger(b.ts) || b.ts < 0) {
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
  const errorText = failureError(b, cores);
  const t = now();
  const atMs = b.ts >= 1_000_000_000_000 ? b.ts : b.ts * 1000;
  const edge = edgeAttribution(requestCf(req), new Set());
  await e.DB.prepare(
    `INSERT INTO connection_events(
       id, at_ms, received_at, source, window_id, user_id, device_id,
       platform, app_version, os_version, os_arch,
       kind, node, stage, outcome, code, error,
       elapsed_ms, delay_ms, exit_delay_ms, tcp_delay_ms, catalog_revision,
       edge_asn, edge_as_org, edge_country, edge_region, edge_via_exit
     ) VALUES(?, ?, ?, 'failure', NULL, ?, ?, ?, ?, ?, ?, 'connectFail', ?, ?, NULL, ?, ?,
              NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).bind(
    id(), atMs, t, a.userId, a.deviceId,
    platform, appVersion, osVersion, osArch,
    node, stage, code, errorText,
    exitDelayMs, tcpDelayMs,
    edge.edge_asn, edge.edge_as_org, edge.edge_country, edge.edge_region, edge.edge_via_exit,
  ).run();
  try {
    await e.DB.prepare(
      `INSERT INTO ops_customer_status (
         user_id, last_fail_at, last_fail_code, last_fail_node, fails_30m, updated_at, connected
       ) VALUES (?, ?, ?, ?, 1, ?, 0)
       ON CONFLICT(user_id) DO UPDATE SET
         last_fail_at = excluded.last_fail_at,
         last_fail_code = excluded.last_fail_code,
         last_fail_node = excluded.last_fail_node,
         fails_30m = CASE
           WHEN ops_customer_status.last_fail_at IS NOT NULL
            AND excluded.last_fail_at - ops_customer_status.last_fail_at < 1800
           THEN ops_customer_status.fails_30m + 1
           ELSE 1
         END,
         updated_at = excluded.updated_at`,
    ).bind(a.userId, t, code, node, t).run();
  } catch (error) {
    if (!String(error).includes('no such table')) {
      console.error('ops failure status failed', clip(error));
    }
  }
  await swallow('ops failure verdict failed', () => runCustomerVerdictPass(e, a.userId, t));
  return Response.json({ accepted: true }, { status: 202 });
}
