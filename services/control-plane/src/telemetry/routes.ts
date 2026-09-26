import { type Env, type Row, envInt, now, id, str } from '../env';
import { ApiError } from '../errors';
import { auth } from '../auth';
import { body, rejectUnexpectedKeys, diagnosticsInt } from '../request';
import { canonicalTelemetryWindow } from '../telemetry-window';
import { DIAGNOSTICS_DAY_SECONDS, DIAGNOSTICS_MAX_REPORTED_AT_MS } from '../diagnostics-limits';
import { rateLimitDiagnostics, rateLimitDiagnosticsLog, rateLimitTelemetry } from '../ops/ingest-limits';
import { afterLogSegment, afterTelemetryWindow, ingestConnectFailure } from '../ops/ingest-hooks';

// A degraded client on the kill-switch recovery channel gets one bounded
// upload, never a log firehose. Anything larger is rejected, not truncated:
// a silently trimmed report is worse than none for support.
export const DIAGNOSTICS_BODY_MAX_BYTES = 32 * 1024;
// Backstop matching the column CHECK. The per-field bounds below already keep a
// fully-populated report under 8 KiB, so this only catches a schema change that
// forgets to re-check the total.
export const DIAGNOSTICS_REPORT_MAX_BYTES = 16 * 1024;
export const DIAGNOSTICS_RETENTION_DEFAULT_SECONDS = 30 * DIAGNOSTICS_DAY_SECONDS;
// Gzip, not text. Matches the column CHECK; a client that wants to send more
// splits into more segments rather than having one truncated.
export const DIAGNOSTICS_LOG_MAX_BYTES = 2 * 1024 * 1024;
export const DIAGNOSTICS_LOG_RETENTION_DEFAULT_SECONDS = 14 * DIAGNOSTICS_DAY_SECONDS;
// Every component of an R2 key is either a fixed string or matched against
// this, so a session identifier can never introduce a path segment.
export const DIAGNOSTICS_LOG_SESSION_PATTERN = /^[0-9A-Za-z-]{1,64}$/;

export const TELEMETRY_BODY_MAX_BYTES = 72 * 1024;
export const TELEMETRY_RETENTION_DEFAULT_SECONDS = 30 * DIAGNOSTICS_DAY_SECONDS;
export const OPS_AUDIT_RETENTION_SECONDS = 180 * 86_400;

/** Crockford-style: no 0/O/1/I, so a code survives being read over the phone. */
const referenceAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const referencePattern = /^[2-9A-HJ-NP-Z]{8}$/;

export function referenceCode(): string {
  // The alphabet is exactly 32 symbols, so masking the low five bits of each
  // random byte is uniform without rejection sampling. 32^8 ≈ 1.1e12 codes.
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = '';
  for (const byte of bytes) code += referenceAlphabet[byte & 31];
  return code;
}

/** Accept what a support agent actually types: lowercase, spaced, hyphenated. */
export function normalizedReferenceCode(value: unknown): string {
  const parsed = str(value, 'referenceCode', 1, 40).toUpperCase().replace(/[\s-]/g, '');
  if (!referencePattern.test(parsed)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid referenceCode');
  }
  return parsed;
}

// The wire contract is owned by the client, which is already shipped:
// `crates/tono-core/src/auth.rs` (`DiagnosticsReport`) is its single
// definition and this intake mirrors it field for field. Serde emits every
// field, writing `null` for an absent optional, so a nullable field arriving
// as `null` and not arriving at all mean the same thing here: both drop out
// of the canonical form. The non-nullable fields are required.
const diagnosticsStepStates = ['pending', 'current', 'completed', 'failed'];
/** Fixed vocabulary; an unknown adapter class is rejected, not stored. */
const diagnosticsVirtualAdapters = [
  'hyperV', 'wsl', 'vmware', 'virtualBox', 'docker', 'loopbackAdapter',
];
const DIAGNOSTICS_MAX_STEPS = 32;
/** A connect attempt that "took" more than a day is a broken clock, not data. */
const DIAGNOSTICS_MAX_ELAPSED_MS = 24 * 60 * 60 * 1000;
/** Required strings: [key, minLength, maxLength]. Only the two that are
 *  promoted to columns must be non-empty (the column CHECKs say so); an empty
 *  state name from a degraded client should not cost the whole upload. */
const diagnosticsStrings: Array<[string, number, number]> = [
  ['appVersion', 1, 40],
  ['osVersion', 1, 80],
  ['osArch', 0, 32],
  ['uiState', 0, 40],
  ['accountState', 0, 40],
  ['auditLogPath', 0, 400],
  ['serviceLogPath', 0, 400],
];
/** Nullable strings: [key, maxLength]. The error texts are redacted client-side. */
const diagnosticsNullableStrings: Array<[string, number]> = [
  ['serviceProtocol', 20],
  ['serviceBuild', 40],
  ['selectedServer', 100],
  ['killSwitchMode', 40],
  ['killSwitchLastError', 500],
  ['dnsLastError', 500],
  ['failedStage', 60],
  ['error', 500],
];
const diagnosticsNullableBools = ['killSwitchWanted', 'killSwitchLive', 'dnsEnabled'];
/** Numbers: [key, min, max, nullable]. */
const diagnosticsNumbers: Array<[string, number, number, boolean]> = [
  // Recorded rather than pinned to 1: a newer client must still be able to
  // reach support, and support needs to tell payload generations apart.
  ['schemaVersion', 1, 1_000, false],
  ['reportedAtMs', 0, DIAGNOSTICS_MAX_REPORTED_AT_MS, false],
  ['retryAttempt', 0, 1_000, false],
  ['catalogRevision', 0, 1_000_000_000_000, true],
  ['totalElapsedMs', 0, DIAGNOSTICS_MAX_ELAPSED_MS, true],
];
const diagnosticsKeys = [
  'schemaVersion', 'reportedAtMs', 'appVersion', 'osVersion', 'osArch',
  'serviceProtocol', 'serviceBuild', 'uiState', 'accountState', 'selectedServer',
  'catalogRevision', 'killSwitchMode', 'killSwitchWanted', 'killSwitchLive',
  'killSwitchLastError', 'dnsEnabled', 'dnsLastError', 'failedStage', 'error',
  'retryAttempt', 'totalElapsedMs', 'steps', 'virtualAdapters',
  'auditLogPath', 'serviceLogPath',
];

/**
 * Whitelist the structured report. Nothing outside the schema is stored, the
 * bounds refuse rather than truncate, and the payload is never echoed back to
 * the uploader. `appVersion`/`osVersion` are also lifted into their own
 * columns by the caller, so their bounds match the column CHECKs exactly.
 */
export function canonicalDiagnosticsReport(value: unknown) {
  rejectUnexpectedKeys(value, diagnosticsKeys);
  const source = value as Row;
  const parsed: Row = {};
  for (const [key, min, max] of diagnosticsStrings) {
    parsed[key] = str(source[key], key, min, max);
  }
  for (const [key, max] of diagnosticsNullableStrings) {
    if (source[key] === undefined || source[key] === null) continue;
    parsed[key] = str(source[key], key, 0, max);
  }
  for (const key of diagnosticsNullableBools) {
    if (source[key] === undefined || source[key] === null) continue;
    if (typeof source[key] !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
    }
    parsed[key] = source[key];
  }
  for (const [key, min, max, nullable] of diagnosticsNumbers) {
    const parsedNumber = diagnosticsInt(source, key, min, max, nullable);
    if (parsedNumber !== undefined) parsed[key] = parsedNumber;
  }
  if (!Array.isArray(source.steps) || source.steps.length > DIAGNOSTICS_MAX_STEPS) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid steps');
  }
  parsed.steps = source.steps.map((raw: unknown) => {
    rejectUnexpectedKeys(raw, ['key', 'state', 'elapsedMs']);
    const entry = raw as Row;
    const key = str(entry.key, 'step key', 0, 60);
    const state = str(entry.state, 'step state', 0, 20);
    if (!diagnosticsStepStates.includes(state)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid step state');
    }
    const step: Row = { key, state };
    const elapsedMs = diagnosticsInt(entry, 'elapsedMs', 0, DIAGNOSTICS_MAX_ELAPSED_MS, true);
    if (elapsedMs !== undefined) step.elapsedMs = elapsedMs;
    return step;
  });
  // Bounded by the vocabulary itself: repeating a class carries no information
  // and is the shape a buggy collector produces, so it is refused.
  if (!Array.isArray(source.virtualAdapters) ||
      source.virtualAdapters.length > diagnosticsVirtualAdapters.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid virtualAdapters');
  }
  const seenAdapters = new Set<string>();
  parsed.virtualAdapters = source.virtualAdapters.map((raw: unknown) => {
    if (typeof raw !== 'string' || !diagnosticsVirtualAdapters.includes(raw) || seenAdapters.has(raw)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid virtualAdapters');
    }
    seenAdapters.add(raw);
    return raw;
  });
  // Re-emit in the contract's own key order so stored reports diff cleanly.
  const report: Row = {};
  for (const key of diagnosticsKeys) {
    if (parsed[key] !== undefined) report[key] = parsed[key];
  }
  const json = JSON.stringify(report);
  if (new TextEncoder().encode(json).byteLength > DIAGNOSTICS_REPORT_MAX_BYTES) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Diagnostics report is too large');
  }
  return {
    json,
    appVersion: report.appVersion as string,
    osVersion: report.osVersion as string,
  };
}

/** Header-carried metadata for a log segment, validated as strictly as a body. */
export function diagnosticsLogMetadata(req: Request) {
  const header = (name: string, max: number) => {
    const value = req.headers.get(name);
    if (value === null) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Missing ${name}`);
    }
    // Header values are ASCII by transport but not by content: reject anything
    // that could smuggle a control character into a stored column.
    if (value.length < 1 || value.length > max || /[^\x20-\x7E]/.test(value)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
    }
    return value;
  };
  const integer = (name: string, max: number) => {
    const raw = header(name, 20);
    if (!/^\d{1,19}$/.test(raw)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
    }
    return parsed;
  };
  const sessionId = header('X-Tono-Log-Session', 64);
  if (!DIAGNOSTICS_LOG_SESSION_PATTERN.test(sessionId)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid X-Tono-Log-Session');
  }
  return {
    sessionId,
    sequence: integer('X-Tono-Log-Sequence', 1_000_000),
    lineCount: integer('X-Tono-Log-Lines', 10_000_000),
    clientVersion: header('X-Tono-Log-Client-Version', 40),
    osVersion: header('X-Tono-Log-Os-Version', 80),
  };
}

// Raw-bytes twin of `body`. Same oversize discipline — drain the stream before
// responding so neither workerd nor the sender is left feeding an abandoned
// request — but no JSON parse: the log pipeline uploads gzip, and base64 in a
// JSON envelope would inflate every segment by a third for nothing.
export async function binaryBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  let tooLarge = Number.isFinite(declared) && declared > maxBytes;
  const reader = req.body?.getReader();
  if (!reader) {
    if (tooLarge) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    throw new ApiError(400, 'VALIDATION_ERROR', 'Expected a request body');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (tooLarge) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        continue;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (tooLarge) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (total === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Expected a request body');
  const raw = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
}

export async function storeDiagnosticsLogSegment(
  e: Env,
  uid: string,
  deviceId: string | null,
  meta: ReturnType<typeof diagnosticsLogMetadata>,
  payload: Uint8Array,
) {
  // Every component of the key is server-derived. Retention finds objects
  // through D1, never by listing the bucket. The UTC day in the key is also
  // what lets the orphan sweep know no later upload can write it again.
  const t = now();
  const id = crypto.randomUUID();
  const day = new Date(t * 1000).toISOString().slice(0, 10);
  const key = `logs/${uid}/${day}/${meta.sessionId}-${String(meta.sequence).padStart(7, '0')}.jsonl.gz`;
  // Record the key before the object exists, in the same statement that checks
  // for a replay. If the index row below never lands (a D1 error, a cancelled
  // request), this pending row is the only thing still pointing at the object
  // and the scheduled sweep deletes the object from it. An index insert clears
  // the pending row by trigger (migration 0088).
  const pending = await e.DB.prepare(
    `INSERT INTO diagnostics_log_pending_objects(r2_key, created_at)
     SELECT ?, ? WHERE NOT EXISTS (
       SELECT 1 FROM diagnostics_log_objects WHERE user_id = ? AND session_id = ? AND sequence = ?
     )
     ON CONFLICT(r2_key) DO UPDATE SET created_at = excluded.created_at
     RETURNING r2_key`,
  ).bind(key, t, uid, meta.sessionId, meta.sequence).first<Row>();
  if (!pending) {
    // A client that loses its upload cursor replays from the last segment it
    // is sure about. Answering the replay from the index — rather than writing
    // the object again — is what keeps that cheap and keeps `sequence`
    // meaningful.
    const existing = await e.DB.prepare(
      'SELECT id, received_at FROM diagnostics_log_objects WHERE user_id = ? AND session_id = ? AND sequence = ?',
    ).bind(uid, meta.sessionId, meta.sequence).first<Row>();
    if (!existing) {
      throw new ApiError(503, 'DIAGNOSTICS_LOG_UNAVAILABLE', 'Could not record the log segment');
    }
    return {
      id: String(existing.id),
      receivedAt: Number(existing.received_at),
      duplicate: true,
    };
  }
  await e.DIAGNOSTICS_LOGS.put(key, payload, {
    httpMetadata: { contentType: 'application/gzip', contentEncoding: 'gzip' },
  });
  try {
    await e.DB.prepare(
      `INSERT INTO diagnostics_log_objects(
         id, user_id, device_id, session_id, sequence, r2_key,
         byte_size, line_count, received_at, client_version, os_version
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, uid, deviceId, meta.sessionId, meta.sequence, key,
      payload.byteLength, meta.lineCount, t, meta.clientVersion, meta.osVersion,
    ).run();
  } catch {
    // Two concurrent uploads of the same sequence: the object is already the
    // right content, so resolve to the row that won instead of failing a client
    // that did nothing wrong. If the two straddled a UTC day, this key is not
    // the winner's; its pending row stays and the sweep deletes this object.
    const winner = await e.DB.prepare(
      'SELECT id, received_at FROM diagnostics_log_objects WHERE user_id = ? AND session_id = ? AND sequence = ?',
    ).bind(uid, meta.sessionId, meta.sequence).first<Row>();
    if (!winner) {
      throw new ApiError(503, 'DIAGNOSTICS_LOG_UNAVAILABLE', 'Could not record the log segment');
    }
    return {
      id: String(winner.id),
      receivedAt: Number(winner.received_at),
      duplicate: true,
    };
  }
  return { id, receivedAt: t, duplicate: false };
}

/** Scheduled retention for raw log segments, run from the Worker cron. */
export async function sweepDiagnosticsLogs(e: Env, t: number) {
  // Raw log segments: delete the payload before the index row. Losing the row
  // first would orphan the object with nothing left pointing at it, and this
  // bucket is the one place in the system holding unredacted hostnames.
  const logRetention = envInt(
    e,
    'DIAGNOSTICS_LOG_RETENTION_SECONDS',
    DIAGNOSTICS_LOG_RETENTION_DEFAULT_SECONDS,
  );
  const expiredLogs = await e.DB.prepare(
    'SELECT id, r2_key FROM diagnostics_log_objects WHERE received_at <= ? LIMIT 50',
  ).bind(t - logRetention).all<Row>();
  if (expiredLogs.results.length > 0) {
    const keys = expiredLogs.results.map((r) => String(r.r2_key));
    const ids = expiredLogs.results.map((r) => String(r.id));
    try {
      await e.DIAGNOSTICS_LOGS.delete(keys);
      // Only delete index rows from D1 if R2 deletion succeeded.
      // Retaining the rows on failure allows the next sweep to retry deletion,
      // preventing unredacted logs from remaining orphaned in R2.
      const placeholders = ids.map(() => '?').join(',');
      await e.DB.prepare(`DELETE FROM diagnostics_log_objects WHERE id IN (${placeholders})`)
        .bind(...ids).run();
    } catch (x) {
      console.error('batch r2 deletion failed', x instanceof Error ? x.message : String(x));
    }
  }
  // An object whose index row never landed is reachable only through its
  // pending row. The key carries the UTC day of the upload that wrote it, so
  // two days on no upload can still be writing that key and an unindexed one
  // is an orphan. An indexed one keeps its object; only the pending row goes.
  const pendingCutoff = t - 2 * DIAGNOSTICS_DAY_SECONDS;
  const pendingLogs = await e.DB.prepare(
    `SELECT p.r2_key,
            EXISTS (SELECT 1 FROM diagnostics_log_objects o WHERE o.r2_key = p.r2_key) AS indexed
     FROM diagnostics_log_pending_objects p
     WHERE p.created_at <= ? LIMIT 50`,
  ).bind(pendingCutoff).all<Row>();
  if (pendingLogs.results.length > 0) {
    const keys = pendingLogs.results.map((r) => String(r.r2_key));
    const orphaned = pendingLogs.results.filter((r) => !Number(r.indexed)).map((r) => String(r.r2_key));
    try {
      if (orphaned.length > 0) await e.DIAGNOSTICS_LOGS.delete(orphaned);
      // Same order as above: the pending row is dropped only once R2 said yes.
      const placeholders = keys.map(() => '?').join(',');
      await e.DB.prepare(
        `DELETE FROM diagnostics_log_pending_objects WHERE created_at <= ? AND r2_key IN (${placeholders})`,
      ).bind(pendingCutoff, ...keys).run();
    } catch (x) {
      console.error('orphaned log deletion failed', x instanceof Error ? x.message : String(x));
    }
  }
}

export async function storeDiagnosticsReport(
  e: Env,
  uid: string,
  clientVersion: string,
  osVersion: string,
  reportJson: string,
) {
  const receivedAt = now();
  // The unique index is the arbiter; a collision only costs another draw.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = referenceCode();
    const inserted = await e.DB.prepare(
      `INSERT OR IGNORE INTO diagnostics_reports(
         id, reference_code, user_id, received_at, client_version, os_version, report_json
       ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id(), code, uid, receivedAt, clientVersion, osVersion, reportJson).run();
    if (inserted.meta.changes) return { referenceCode: code, receivedAt };
  }
  throw new ApiError(503, 'DIAGNOSTICS_UNAVAILABLE', 'Could not allocate a reference code; try again');
}

export const publicDiagnosticsReport = (r: Row) => ({
  id: r.id,
  referenceCode: r.reference_code,
  userId: r.user_id,
  receivedAt: Number(r.received_at),
  clientVersion: r.client_version,
  osVersion: r.os_version,
  report: JSON.parse(r.report_json),
});

export async function storeTelemetryWindow(
  e: Env,
  uid: string,
  deviceId: string | null,
  clientVersion: string,
  osVersion: string,
  windowStartMs: number,
  windowEndMs: number,
  payloadJson: string,
) {
  const receivedAt = now();
  const rowId = id();
  // The immutable row is itself the device-attributed heartbeat used by the
  // operations activity view. Rewriting devices.last_seen_at with the same
  // receipt merely doubles every telemetry upload's D1 writes; login and token
  // refresh continue to maintain that account/device lifecycle watermark.
  await e.DB.prepare(
    `INSERT INTO telemetry_windows(
       id, user_id, device_id, received_at, window_start_ms, window_end_ms, client_version, os_version, payload_json
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    rowId, uid, deviceId, receivedAt, windowStartMs, windowEndMs,
    clientVersion, osVersion, payloadJson,
  ).run();
  return { id: rowId, receivedAt };
}

export const publicTelemetryWindow = (r: Row) => ({
  id: r.id,
  userId: r.user_id,
  receivedAt: Number(r.received_at),
  windowStartMs: Number(r.window_start_ms),
  windowEndMs: Number(r.window_end_ms),
  clientVersion: r.client_version,
  osVersion: r.os_version,
  window: JSON.parse(r.payload_json),
});

export async function telemetryRoutes(
  req: Request,
  e: Env,
  p: string,
  m: string,
): Promise<Response | null> {
  // User-initiated only: there is no silent reporting path, and the normal
  // access token is required so every stored report has an owner (and inherits
  // account rate limiting). An unauthenticated fallback for "auth itself is
  // broken" is deliberately not offered: a token this endpoint would accept is
  // a token the client can also spend on /auth/refresh over the same recovery
  // channel, and an anonymous write endpoint on a VPN control plane is a worse
  // trade than losing reports from an unauthenticatable client.
  if (p === '/api/v1/diagnostics/reports' && m === 'POST') {
    const a = await auth(req, e);
    const b = await body(req, DIAGNOSTICS_BODY_MAX_BYTES);
    // The client sends `{report}` and nothing else; the version columns are
    // lifted out of the report rather than repeated at the top level.
    rejectUnexpectedKeys(b, ['report']);
    const { json: reportJson, appVersion, osVersion } = canonicalDiagnosticsReport(b.report);
    await rateLimitDiagnostics(e, a.userId);
    // The reference code (plus the display-only receipt time) is the entire
    // response; the payload is never echoed.
    return Response.json(
      await storeDiagnosticsReport(e, a.userId, appVersion, osVersion, reportJson),
      { status: 201 },
    );
  }

  // Continuous network-log ingest. Unlike `/diagnostics/reports` this carries
  // the unredacted audit log — hostnames, process paths, rules, routes — so the
  // client only sends it while its own upload setting is on, and the Settings
  // and Support copy states plainly that it leaves the device. The body is gzip
  // rather than JSON; metadata rides in headers so the payload is stored exactly
  // as received.
  if (p === '/api/v1/diagnostics/logs' && m === 'POST') {
    const a = await auth(req, e);
    const receivedAt = now();
    const access = await e.DB.prepare(
      `SELECT 1 FROM diagnostics_log_access
       WHERE user_id = ? AND device_id = ? AND expires_at > ?`,
    ).bind(a.userId, a.deviceId, receivedAt).first<Row>();
    if (!access) {
      // Old clients advance their local cursor only after decoding the existing
      // segment receipt. Preserve that successful shape while making the
      // no-store decision before metadata validation, body reads, rate-limit
      // counters, R2, or the D1 object index. The additive fields are ignored by
      // shipped decoders and make the decision visible to newer tooling.
      return Response.json({
        segment: { id: 'not-stored', receivedAt },
        stored: false,
        reason: 'not_enabled',
      });
    }
    const meta = diagnosticsLogMetadata(req);
    const payload = await binaryBody(req, DIAGNOSTICS_LOG_MAX_BYTES);
    // Cheap shape check with real value: it catches a client that uploads plain
    // JSONL by mistake before a day of unreadable objects accumulates.
    if (payload.byteLength < 2 || payload[0] !== 0x1f || payload[1] !== 0x8b) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Expected a gzip body');
    }
    await rateLimitDiagnosticsLog(e, a.userId);
    const stored = await storeDiagnosticsLogSegment(
      e,
      a.userId,
      a.deviceId ?? null,
      meta,
      payload,
    );
    if (!stored.duplicate) {
      await afterLogSegment(e, {
        userId: a.userId,
        deviceId: a.deviceId ?? null,
        bytes: payload, segmentId: stored.id,
        receivedAt: stored.receivedAt,
      });
    }
    // 200 on a replay, 201 on a new segment: the client advances its cursor on
    // either, but the distinction is what makes a cursor bug visible in logs.
    return Response.json(
      { segment: { id: stored.id, receivedAt: stored.receivedAt }, stored: true },
      { status: stored.duplicate ? 200 : 201 },
    );
  }

  // Periodic testing timeline: signed-in clients may upload a short event
  // window (~20 minutes). Users can disable the client toggle; this endpoint
  // still requires a valid access token and never accepts account emails.
  if (p === '/api/v1/telemetry/windows' && m === 'POST') {
    const a = await auth(req, e);
    const b = await body(req, TELEMETRY_BODY_MAX_BYTES);
    rejectUnexpectedKeys(b, ['window']);
    const parsed = canonicalTelemetryWindow(b.window);
    await rateLimitTelemetry(e, a.userId);
    const stored = await storeTelemetryWindow(
      e,
      a.userId,
      a.deviceId,
      parsed.appVersion,
      parsed.osVersion,
      parsed.windowStartMs,
      parsed.windowEndMs,
      parsed.json,
    );
    await afterTelemetryWindow(e, req, {
      id: stored.id,
      user_id: a.userId,
      device_id: a.deviceId,
      received_at: stored.receivedAt,
      client_version: parsed.appVersion,
      os_version: parsed.osVersion,
      payload_json: parsed.json,
      window_start_ms: parsed.windowStartMs,
      window_end_ms: parsed.windowEndMs,
    });
    return Response.json({ ...stored, routeBytesIntervalVersion: 1 }, { status: 201 });
  }

  if (p === '/api/v1/telemetry/failures' && m === 'POST') {
    const a = await auth(req, e);
    await rateLimitTelemetry(e, a.userId, 'FAILURE');
    return ingestConnectFailure(req, e, a);
  }

  return null;
}
