// Privacy-safe automatic diagnostics. This is not the raw hostname log:
// do not gate it on diagnostics_log_access, and do not accept domains, URLs,
// emails, cookies, or full IP addresses. The client default must stay on;
// see docs/diagnostics-privacy.md.

import { ApiError } from '../errors';
import { id, now, str, type Row } from '../env';
import { diagnosticsInt, rejectUnexpectedKeys } from '../request';
import { DIAGNOSTICS_MAX_REPORTED_AT_MS } from '../diagnostics-limits';
import { redactJobResult } from '../ops/job-redaction';
import { isPlatform } from '../ops/platform';
import { recordFailureCluster, type ClusterEnv } from './failure-clusters';

export const DIAGNOSTICS_BUNDLE_MAX_BYTES = 32 * 1024;
const AI_RETENTION_NOTE = 'ai routes require aiServicesConsent and expire after 60 days';

const CLIENT_KEYS = [
  'appVersion', 'appBuild', 'gitCommit', 'platform', 'osVersion', 'coreVersion', 'channel',
];
const SESSION_KEYS = [
  'id', 'startedAtMs', 'endedAtMs', 'node', 'entryNodeId', 'residentialExitId',
  'bytesUp', 'bytesDown', 'outcome', 'reason',
];
const HOP_KEYS = ['index', 'role', 'nodeId', 'connected', 'handshakeMs', 'failureCode', 'atMs'];
const EXIT_KEYS = [
  'atMs', 'ipPrefix', 'ipHash', 'asn', 'country', 'city', 'networkKind',
  'previousAsn', 'previousCountry', 'previousCity',
];
const DNS_KEYS = [
  'atMs', 'resolver', 'leakOutside', 'geoMatchesExit', 'mode', 'ipv6Leak',
  'resolverAsn', 'resolverCountry', 'exitAsn', 'exitCountry',
];
const EVENT_KEYS = [
  'ts', 'kind', 'stage', 'code', 'node', 'elapsedMs', 'reason', 'outcome', 'transport',
];
const AI_KEYS = [
  'bucketStartMs', 'service', 'exitKind', 'exitId', 'exitAsn', 'exitCountry', 'exitCity',
  'routingLeak', 'exitSwitched', 'dnsOk', 'tzMismatch', 'locale',
];
const BUNDLE_KEYS = [
  'schemaVersion', 'aiServicesConsent', 'client', 'session', 'hops', 'exitObservations',
  'dnsCheck', 'events', 'aiRoutes', 'logExcerpt',
];

const FAILURE_KINDS = new Set([
  'connectFail', 'signInFail', 'releaseFail', 'syncFail', 'healthProbeFail', 'appCrash', 'killSwitchFail',
]);
const EVENT_KINDS = new Set([
  ...FAILURE_KINDS,
  'connectBegin', 'connectOk', 'disconnectOk', 'networkRestore', 'networkChange', 'protectedOffline',
]);

const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const PREFIX = /^(?:\d{1,3}\.){3}0\/24$/;
const HASH = /^[a-f0-9]{64}$/;
const NODE_ID = /^[A-Za-z0-9 .·_\-]{1,80}$/;

export type StoredBundle = { sessionId: string | null; events: number };

type ClientFields = {
  appVersion: string;
  appBuild: string | null;
  gitCommit: string | null;
  platform: string;
  osVersion: string;
  coreVersion: string | null;
  channel: string | null;
};

function optionalText(value: unknown, name: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return str(value, name, 1, max);
}

function flag(value: unknown, name: string): number {
  if (typeof value !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  return value ? 1 : 0;
}

function optionalFlag(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  return flag(value, name);
}

function rejectSecrets(value: string, name: string) {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) || value.includes('://') || value.includes('@')) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${name} must not contain an email, URL, or credential`);
  }
}

function nodeId(value: unknown, name: string): string | null {
  const text = optionalText(value, name, 80);
  if (!text) return null;
  rejectSecrets(text, name);
  if (!NODE_ID.test(text)) throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  return text;
}

function clientOf(value: unknown): ClientFields {
  rejectUnexpectedKeys(value, CLIENT_KEYS);
  const row = value as Row;
  const platform = str(row.platform, 'platform', 1, 20);
  if (!isPlatform(platform)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid platform');
  const channel = optionalText(row.channel, 'channel', 16);
  if (channel && channel !== 'release' && channel !== 'beta') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid channel');
  }
  return {
    appVersion: str(row.appVersion, 'appVersion', 1, 40),
    appBuild: optionalText(row.appBuild, 'appBuild', 40),
    gitCommit: optionalText(row.gitCommit, 'gitCommit', 40),
    platform,
    osVersion: str(row.osVersion, 'osVersion', 1, 80),
    coreVersion: optionalText(row.coreVersion, 'coreVersion', 40),
    channel,
  };
}

export async function storeDiagnosticsBundle(
  db: D1Database,
  userId: string,
  deviceId: string | null,
  body: unknown,
  env: ClusterEnv,
): Promise<StoredBundle> {
  rejectUnexpectedKeys(body, BUNDLE_KEYS);
  const root = body as Row;
  const schema = diagnosticsInt(root, 'schemaVersion', 1, 1, false);
  if (schema !== 1) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid schemaVersion');
  if (typeof root.aiServicesConsent !== 'boolean') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid aiServicesConsent');
  }
  const client = clientOf(root.client);
  const received = now();
  let sessionKey: string | null = null;

  if (root.session !== undefined && root.session !== null) {
    rejectUnexpectedKeys(root.session, SESSION_KEYS);
    const session = root.session as Row;
    const sessionId = str(session.id, 'session.id', 8, 64);
    if (!SESSION_ID.test(sessionId)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid session.id');
    const started = diagnosticsInt(session, 'startedAtMs', 1, DIAGNOSTICS_MAX_REPORTED_AT_MS, false)!;
    const ended = diagnosticsInt(session, 'endedAtMs', 1, DIAGNOSTICS_MAX_REPORTED_AT_MS, true);
    if (ended !== undefined && ended < started) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid session end');
    const bytesUp = diagnosticsInt(session, 'bytesUp', 0, 1_000_000_000_000_000, true) ?? 0;
    const bytesDown = diagnosticsInt(session, 'bytesDown', 0, 1_000_000_000_000_000, true) ?? 0;
    const outcome = optionalText(session.outcome, 'outcome', 40);
    const reason = optionalText(session.reason, 'reason', 80);
    if (reason) rejectSecrets(reason, 'reason');
    const excerpt = optionalText(root.logExcerpt, 'logExcerpt', 1500);
    const redacted = excerpt ? redactJobResult(excerpt).slice(0, 1500) : null;
    if (redacted && /https?:\/\//i.test(redacted)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'logExcerpt must not contain a URL');
    }
    sessionKey = `${userId}:${sessionId}`;
    await db.prepare(
      `INSERT INTO client_sessions(
         id, user_id, device_id, started_at_ms, ended_at_ms, node, entry_node_id, residential_exit_id,
         bytes_up, bytes_down, outcome, reason, app_version, app_build, git_commit, platform, os_version,
         core_version, channel, log_excerpt, received_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         ended_at_ms = excluded.ended_at_ms,
         bytes_up = excluded.bytes_up,
         bytes_down = excluded.bytes_down,
         outcome = excluded.outcome,
         reason = excluded.reason,
         log_excerpt = excluded.log_excerpt,
         received_at = excluded.received_at
       WHERE client_sessions.user_id = excluded.user_id
         AND (client_sessions.ended_at_ms IS NULL OR excluded.ended_at_ms IS NOT NULL)`,
    ).bind(
      sessionKey, userId, deviceId, started, ended ?? null,
      nodeId(session.node, 'node'), nodeId(session.entryNodeId, 'entryNodeId'),
      nodeId(session.residentialExitId, 'residentialExitId'),
      bytesUp, bytesDown, outcome, reason,
      client.appVersion, client.appBuild, client.gitCommit, client.platform, client.osVersion,
      client.coreVersion, client.channel, redacted, received,
    ).run();
  } else if (root.logExcerpt !== undefined && root.logExcerpt !== null) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'logExcerpt requires a session');
  }

  const hops = Array.isArray(root.hops) ? root.hops : [];
  if (hops.length > 8) throw new ApiError(400, 'VALIDATION_ERROR', 'Too many hops');
  if (hops.length && !sessionKey) throw new ApiError(400, 'VALIDATION_ERROR', 'hops require a session');
  for (const hop of hops) {
    rejectUnexpectedKeys(hop, HOP_KEYS);
    const row = hop as Row;
    const index = diagnosticsInt(row, 'index', 0, 7, false)!;
    const role = str(row.role, 'role', 1, 20);
    if (role !== 'entry' && role !== 'residential') throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid hop role');
    const atMs = diagnosticsInt(row, 'atMs', 1, DIAGNOSTICS_MAX_REPORTED_AT_MS, false)!;
    await db.prepare(
      `INSERT INTO chain_hops(
         id, session_id, user_id, device_id, hop_index, hop_role, node_id, connected,
         handshake_ms, failure_code, at_ms, received_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         connected = excluded.connected,
         handshake_ms = excluded.handshake_ms,
         failure_code = excluded.failure_code,
         received_at = excluded.received_at
       WHERE chain_hops.user_id = excluded.user_id`,
    ).bind(
      `${sessionKey}:${index}`, sessionKey, userId, deviceId, index, role,
      nodeId(row.nodeId, 'nodeId'), flag(row.connected, 'connected'),
      diagnosticsInt(row, 'handshakeMs', 0, 120_000, true) ?? null,
      optionalText(row.failureCode, 'failureCode', 80), atMs, received,
    ).run();
  }

  const exits = Array.isArray(root.exitObservations) ? root.exitObservations : [];
  if (exits.length > 8) throw new ApiError(400, 'VALIDATION_ERROR', 'Too many exit observations');
  if (exits.length && !sessionKey) throw new ApiError(400, 'VALIDATION_ERROR', 'exit observations require a session');
  for (const [index, exit] of exits.entries()) {
    rejectUnexpectedKeys(exit, EXIT_KEYS);
    const row = exit as Row;
    const prefix = optionalText(row.ipPrefix, 'ipPrefix', 20);
    if (prefix && !PREFIX.test(prefix)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'ipPrefix must be an IPv4 /24');
    }
    const hash = optionalText(row.ipHash, 'ipHash', 64);
    if (hash && !HASH.test(hash)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid ipHash');
    const kind = str(row.networkKind, 'networkKind', 1, 20);
    if (kind !== 'residential' && kind !== 'datacenter' && kind !== 'unknown') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid networkKind');
    }
    const atMs = diagnosticsInt(row, 'atMs', 1, DIAGNOSTICS_MAX_REPORTED_AT_MS, false)!;
    await db.prepare(
      `INSERT INTO session_exit_observations(
         id, session_id, user_id, device_id, at_ms, ip_prefix, ip_hash, asn, country, city,
         network_kind, previous_asn, previous_country, previous_city, received_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id(), sessionKey, userId, deviceId, atMs, prefix, hash,
      diagnosticsInt(row, 'asn', 0, 4_294_967_295, true) ?? null,
      optionalText(row.country, 'country', 8), optionalText(row.city, 'city', 40), kind,
      diagnosticsInt(row, 'previousAsn', 0, 4_294_967_295, true) ?? null,
      optionalText(row.previousCountry, 'previousCountry', 8),
      optionalText(row.previousCity, 'previousCity', 40), received,
    ).run();
    void index;
  }

  if (root.dnsCheck !== undefined && root.dnsCheck !== null) {
    rejectUnexpectedKeys(root.dnsCheck, DNS_KEYS);
    const dns = root.dnsCheck as Row;
    const resolver = str(dns.resolver, 'resolver', 1, 20);
    if (resolver !== 'system' && resolver !== 'tunnel' && resolver !== 'unknown') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid resolver');
    }
    const mode = str(dns.mode, 'mode', 1, 20);
    if (mode !== 'fake-ip' && mode !== 'real-ip' && mode !== 'unknown') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid dns mode');
    }
    await db.prepare(
      `INSERT INTO dns_checks(
         id, user_id, device_id, session_id, at_ms, received_at, resolver, leak_outside,
         geo_matches_exit, mode, ipv6_leak, resolver_asn, resolver_country, exit_asn, exit_country,
         app_version, app_build, git_commit, platform, os_version, core_version, channel
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id(), userId, deviceId, sessionKey,
      diagnosticsInt(dns, 'atMs', 1, DIAGNOSTICS_MAX_REPORTED_AT_MS, false), received,
      resolver, flag(dns.leakOutside, 'leakOutside'), optionalFlag(dns.geoMatchesExit, 'geoMatchesExit'),
      mode, flag(dns.ipv6Leak, 'ipv6Leak'),
      diagnosticsInt(dns, 'resolverAsn', 0, 4_294_967_295, true) ?? null,
      optionalText(dns.resolverCountry, 'resolverCountry', 8),
      diagnosticsInt(dns, 'exitAsn', 0, 4_294_967_295, true) ?? null,
      optionalText(dns.exitCountry, 'exitCountry', 8),
      client.appVersion, client.appBuild, client.gitCommit, client.platform, client.osVersion,
      client.coreVersion, client.channel,
    ).run();
  }

  const events = Array.isArray(root.events) ? root.events : [];
  if (events.length > 20) throw new ApiError(400, 'VALIDATION_ERROR', 'Too many events');
  for (const event of events) {
    rejectUnexpectedKeys(event, EVENT_KEYS);
    const row = event as Row;
    const kind = str(row.kind, 'kind', 1, 40);
    if (!EVENT_KINDS.has(kind)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid event kind');
    if ('email' in row || 'host' in row || 'domain' in row || 'url' in row) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Events must not carry identity or destinations');
    }
    const atMs = Math.min(
      diagnosticsInt(row, 'ts', 1, DIAGNOSTICS_MAX_REPORTED_AT_MS, false)!,
      received * 1000,
    );
    const code = optionalText(row.code, 'code', 80);
    const stage = optionalText(row.stage, 'stage', 40);
    const node = nodeId(row.node, 'node');
    await db.prepare(
      `INSERT INTO connection_events(
         id, at_ms, received_at, source, user_id, device_id, platform, app_version, os_version,
         kind, node, stage, outcome, code, elapsed_ms, edge_via_exit,
         app_build, git_commit, core_version, channel
       ) VALUES(?, ?, ?, 'diagnostics', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    ).bind(
      id(), atMs, received, userId, deviceId, client.platform, client.appVersion, client.osVersion,
      kind, node, stage, optionalText(row.outcome, 'outcome', 40), code,
      diagnosticsInt(row, 'elapsedMs', 0, 600_000, true) ?? null,
      client.appBuild, client.gitCommit, client.coreVersion, client.channel,
    ).run();
    if (FAILURE_KINDS.has(kind) && code && stage && node) {
      await recordFailureCluster(db, {
        atMs, code, stage, appVersion: client.appVersion, platform: client.platform, node,
        userId, deviceId, appBuild: client.appBuild, gitCommit: client.gitCommit,
        coreVersion: client.coreVersion, channel: client.channel,
      }, env, received);
    }
  }

  const ai = Array.isArray(root.aiRoutes) ? root.aiRoutes : [];
  if (ai.length > 8) throw new ApiError(400, 'VALIDATION_ERROR', 'Too many ai routes');
  if (ai.length && root.aiServicesConsent !== true) {
    throw new ApiError(400, 'VALIDATION_ERROR', AI_RETENTION_NOTE);
  }
  for (const route of ai) {
    rejectUnexpectedKeys(route, AI_KEYS);
    const row = route as Row;
    const service = str(row.service, 'service', 1, 16);
    if (service !== 'claude' && service !== 'openai') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'AI service is not on the allowlist');
    }
    const exitKind = str(row.exitKind, 'exitKind', 1, 20);
    if (!['residential', 'datacenter', 'direct', 'unknown'].includes(exitKind)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid exitKind');
    }
    const locale = optionalText(row.locale, 'locale', 16);
    if (locale) rejectSecrets(locale, 'locale');
    await db.prepare(
      `INSERT INTO ai_service_routes(
         id, user_id, device_id, bucket_start_ms, service, exit_kind, exit_id, exit_asn, exit_country,
         exit_city, routing_leak, exit_switched, dns_ok, tz_mismatch, locale, app_version, app_build,
         git_commit, platform, os_version, core_version, channel, received_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id(), userId, deviceId,
      diagnosticsInt(row, 'bucketStartMs', 1, DIAGNOSTICS_MAX_REPORTED_AT_MS, false),
      service, exitKind, nodeId(row.exitId, 'exitId'),
      diagnosticsInt(row, 'exitAsn', 0, 4_294_967_295, true) ?? null,
      optionalText(row.exitCountry, 'exitCountry', 8), optionalText(row.exitCity, 'exitCity', 40),
      flag(row.routingLeak, 'routingLeak'), flag(row.exitSwitched, 'exitSwitched'),
      optionalFlag(row.dnsOk, 'dnsOk'), optionalFlag(row.tzMismatch, 'tzMismatch'), locale,
      client.appVersion, client.appBuild, client.gitCommit, client.platform, client.osVersion,
      client.coreVersion, client.channel, received,
    ).run();
  }

  return { sessionId: sessionKey, events: events.length };
}
