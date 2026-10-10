import { type Env, now } from './env';
import { authenticateExitNode } from './auth';
import { ApiError } from './errors';
import { body, rejectUnexpectedKeys } from './request';
import { API_RELAYS, type ApiRelay, relayKey } from './api-relays';

// A relay node's own end-to-end check (decision 077): every five minutes it
// makes a full HTTPS request through its local :2053 to the Cloudflare-fronted
// API, certificate verification on (`tooling/ops/relay/relay-probe.py`), and
// reports the outcome here. The Worker's cron only proves the port is open;
// this proves the TLS pass-through reaches the API.
//
// No new credential: the report carries the exit-agent token already on the
// node (`exit_nodes.token_hash`, looked up by hash like every exit-agent
// route), and the relay is derived from the authenticated node, never named by
// the caller, so one node cannot write another relay's row.

const ERROR_MAX = 200;
/** A report older than this is a replay or a stuck clock, not the current state. */
const OBSERVED_MAX_AGE_S = 900;
const OBSERVED_MAX_SKEW_S = 300;
const LATENCY_MAX_MS = 120_000;

function relayFor(nodeId: string, relays: readonly ApiRelay[]): ApiRelay {
  const relay = relays.find((candidate) => candidate.exitNodeId === nodeId);
  if (!relay) throw new ApiError(403, 'NOT_AN_API_RELAY', 'This exit node runs no API relay');
  return relay;
}

function boundedInt(value: unknown, name: string, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value;
}

/** Printable, single-line, bounded: the text ends up in an operator's tooltip. */
function errorText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid error');
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, ERROR_MAX);
  return clean === '' ? null : clean;
}

/**
 * `POST /api/v1/home/relay-probe` with `{ observedAt, httpStatus, latencyMs, error }`.
 *
 * `ok` is decided here, not by the node: a 2xx and no error. A report no newer
 * than the stored one changes nothing, so a delayed retry cannot overwrite a
 * later result.
 */
export async function relayReportRoute(
  req: Request,
  e: Env,
  p: string,
  m: string,
  relays: readonly ApiRelay[] = API_RELAYS,
): Promise<Response | null> {
  if (p !== '/api/v1/home/relay-probe' || m !== 'POST') return null;
  const node = await authenticateExitNode(req, e);
  const relay = relayFor(node!.id, relays);
  const b = await body(req, 4 * 1024);
  rejectUnexpectedKeys(b, ['observedAt', 'httpStatus', 'latencyMs', 'error']);
  const t = now();
  const observedAt = boundedInt(b.observedAt, 'observedAt', t - OBSERVED_MAX_AGE_S, t + OBSERVED_MAX_SKEW_S);
  if (observedAt === null) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid observedAt');
  const httpStatus = boundedInt(b.httpStatus, 'httpStatus', 100, 599);
  const latencyMs = boundedInt(b.latencyMs, 'latencyMs', 0, LATENCY_MAX_MS);
  const reported = errorText(b.error);
  const ok = reported === null && httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
  const error = ok ? null : (reported ?? (httpStatus === null ? 'no response' : `http ${httpStatus}`));
  await e.DB.prepare(
    `INSERT INTO api_relay_reports(
       relay, node_id, observed_at, received_at, ok, http_status, latency_ms, error, ok_since, failing_since)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(relay) DO UPDATE SET
       node_id = excluded.node_id,
       observed_at = excluded.observed_at,
       received_at = excluded.received_at,
       ok = excluded.ok,
       http_status = excluded.http_status,
       latency_ms = excluded.latency_ms,
       error = excluded.error,
       ok_since = CASE WHEN excluded.ok = 1
         THEN COALESCE(CASE WHEN api_relay_reports.ok = 1 THEN api_relay_reports.ok_since END, excluded.observed_at)
         END,
       failing_since = CASE WHEN excluded.ok = 0
         THEN COALESCE(CASE WHEN api_relay_reports.ok = 0 THEN api_relay_reports.failing_since END, excluded.observed_at)
         END
     WHERE excluded.observed_at > api_relay_reports.observed_at`,
  ).bind(
    relayKey(relay), node!.id, observedAt, t, ok ? 1 : 0, httpStatus, latencyMs, error,
    ok ? observedAt : null, ok ? null : observedAt,
  ).run();
  return Response.json({ relay: relayKey(relay), observedAt, ok });
}
