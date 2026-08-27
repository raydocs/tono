import {
  decryptCatalog,
  decryptTrafficPolicy,
  encryptCatalog,
  encryptTrafficPolicy,
  hmacSha256,
  jwtSign,
  jwtVerify,
  randomToken,
  sha256,
  TRAFFIC_POLICY_SIGNATURE_CONTEXT,
  verifyTrafficPolicySignature,
} from './crypto';
import {
  OidcVerificationError,
  verifyOidcIdToken,
  type OidcProvider,
} from './oidc';
import { AccessVerificationError, verifyAccessRequest } from './access';
import {
  isMetricField,
  queryAgentMetrics,
  queryHomeProbeHistory,
  recordAgentSamples,
  recordHomeProbeSamples,
  recordQualitySamples,
  retainOperationsTimeseries,
} from './ops-timeseries';
import { queryUserUsageHours, snapshotUserUsageHours } from './ops-usage-hours';
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  ADMIN_API_TOKEN: string;
  HOME_AGENT_TOKEN: string;
  TAILSCALE_OAUTH_CLIENT_ID: string;
  TAILSCALE_OAUTH_CLIENT_SECRET: string;
  TAILSCALE_TAILNET: string;
  TAILSCALE_ENROLLMENT_ENABLED?: string;
  ALLOWED_ORIGIN: string;
  ACCESS_TOKEN_TTL_SECONDS: string;
  REFRESH_TOKEN_TTL_SECONDS: string;
  PENDING_DEVICE_TTL_SECONDS: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  RATE_LIMIT_EMAIL_START_IP?: string;
  RATE_LIMIT_EMAIL_START_EMAIL?: string;
  RATE_LIMIT_EMAIL_VERIFY_IP?: string;
  RATE_LIMIT_EMAIL_VERIFY_CHALLENGE?: string;
  RATE_LIMIT_OIDC_START_IP?: string;
  RATE_LIMIT_OIDC_START_INSTALLATION?: string;
  RATE_LIMIT_OIDC_VERIFY_IP?: string;
  RATE_LIMIT_OIDC_VERIFY_CHALLENGE?: string;
  EMAIL_CODE_TTL_SECONDS?: string;
  OIDC_CHALLENGE_TTL_SECONDS?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  APPLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  DIRECT_SIGNUP_ALLOWLIST?: string;
  CATALOG_ENCRYPTION_KEY?: string;
  // Public half of the offline policy signing key, standard base64, 32 bytes. A
  // var rather than a secret: it is a public key, and keeping it readable is what
  // lets anyone confirm which key this deployment trusts. Unset means signature
  // verification is unavailable, so a signed policy cannot be published and a
  // stored signature cannot be checked — see `publicTrafficPolicy`.
  TRAFFIC_POLICY_PUBLIC_KEY?: string;
  CONFIRM_CLAIM_TTL_SECONDS?: string;
  RATE_LIMIT_DIAGNOSTICS_IP_HOUR?: string;
  RATE_LIMIT_DIAGNOSTICS_USER_HOUR?: string;
  RATE_LIMIT_DIAGNOSTICS_USER_DAY?: string;
  DIAGNOSTICS_RETENTION_SECONDS?: string;
  // Raw audit-log segments. The bucket is required, not optional: a build
  // that forgets the binding must fail at the first upload rather than
  // silently accepting segments it cannot store.
  DIAGNOSTICS_LOGS: R2Bucket;
  RELEASES: R2Bucket;
  DIAGNOSTICS_LOG_RETENTION_SECONDS?: string;
  RATE_LIMIT_DIAGNOSTICS_LOG_USER_HOUR?: string;
  RATE_LIMIT_DIAGNOSTICS_LOG_USER_DAY?: string;
  RATE_LIMIT_TELEMETRY_IP_HOUR?: string;
  RATE_LIMIT_TELEMETRY_USER_HOUR?: string;
  RATE_LIMIT_TELEMETRY_USER_DAY?: string;
  TELEMETRY_RETENTION_SECONDS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_ADMIN_EMAILS?: string;
  // VPS collector (`ops-panel/collect.py`) pushes the quality report + Komari
  // inventory here. Optional: unset means ingest returns 503 and /ops/live
  // still falls back to the legacy Access-protected hostnames.
  OPS_COLLECTOR_TOKEN?: string;
  RATE_LIMIT_ROUTING_RESEARCH_DEVICE_REQUEST_DAY?: string;
  RATE_LIMIT_ROUTING_RESEARCH_DEVICE_DAY?: string;
  ROUTING_RESEARCH_RETENTION_SECONDS?: string;
  BUILD_SHA?: string;
}

type Row = Record<string, any>;

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const now = () => Math.floor(Date.now() / 1000);
const id = () => crypto.randomUUID();
const sha256Hex = async (value: string) => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
const routingResearchApps = [
  'wechat', 'qq', 'feishu', 'lark', 'dingtalk', 'trae', 'chrome', 'edge',
  'safari', 'firefox', 'arc', 'brave', 'claude', 'wecom', 'tencent_meeting',
  'wps', 'baidu_netdisk', 'alipan', 'douyin', 'bilibili', 'netease_music',
  'qq_music', 'xunlei', 'jianying', 'youdao', 'awesun', 'other',
] as const;
const routingResearchComponentApps = [
  'wechat', 'qq', 'feishu', 'lark', 'dingtalk', 'wecom', 'tencent_meeting',
  'wps', 'baidu_netdisk', 'alipan', 'douyin', 'bilibili', 'netease_music',
  'qq_music', 'xunlei', 'jianying', 'youdao', 'awesun',
] as const;
const routingResearchBundleComponents = ['main_executable', 'framework_helper', 'xpc_service', 'plugin_helper', 'bundle_helper'] as const;
const trafficBuckets = ['none', 'under_1_mib', '1_to_10_mib', '10_to_100_mib', '100_mib_to_1_gib', '1_to_10_gib', 'over_10_gib'] as const;
const ROUTING_RESEARCH_WINDOW_SECONDS = 6 * 60 * 60;
const ROUTING_RESEARCH_DAY_SECONDS = 24 * 60 * 60;
const ROUTING_RESEARCH_RETENTION_MAX_SECONDS = 90 * ROUTING_RESEARCH_DAY_SECONDS;
const ROUTING_RESEARCH_MIN_SUMMARY_PARTICIPANTS = 3;
// Release-host aliases rewrite to the same static asset path. Include an
// explicit revision in the inner asset request so a previously cached alias
// cannot keep serving an older Sparkle feed after an asset-only deployment.
const RELEASE_ASSET_REVISION = 'site-public-pages-20260819';

export function parseBytesRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const startText = match[1];
  const endText = match[2];
  if (startText === '' && endText === '') return null;
  let start: number;
  let end: number;
  if (startText === '') {
    const suffix = Number(endText);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Number(endText);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }
  if (end >= size) end = size - 1;
  return { offset: start, length: end - start + 1 };
}
const deviceActions = ['diagnostic_snapshot', 'claude_traffic_snapshot', 'refresh_catalog', 'retry_protection'] as const;
/** Failure vocabulary for device-action snapshots. (Diagnostics uploads carry
 *  the client's own free-text `error`/`failedStage` instead; see
 *  `canonicalDiagnosticsReport`.) */
const errorCategories = ['preparation', 'helper', 'kill_switch', 'tunnel', 'policy', 'dns', 'exit_check', 'data_plane', 'other'];
const crashLabels = ['SIGABRT', 'SIGILL', 'SIGSEGV', 'SIGBUS', 'SIGFPE', 'SIGTRAP', 'signal', 'exception'];

function fixedAction(value: unknown) {
  if (typeof value !== 'string' || !deviceActions.includes(value as typeof deviceActions[number])) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown device action');
  }
  return value;
}

function rejectUnexpectedKeys(value: unknown, allowed: string[]): asserts value is Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Expected an object');
  }
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Unexpected field');
  }
}

function canonicalRoutingResearch(value: unknown) {
  const commonKeys = ['schemaVersion', 'snapshotId', 'observedSince', 'observedUntil', 'appVersion', 'build', 'osVersion', 'architecture', 'observedConnectionCount', 'identifiedAppConnectionCount', 'connectionLimitReached', 'entries'];
  const versionTwoKeys = [...commonKeys, 'bundleComponents'];
  rejectUnexpectedKeys(value, versionTwoKeys);
  const schemaVersion = value.schemaVersion;
  const timestamp = now();
  if ((schemaVersion !== 1 && schemaVersion !== 2) ||
      !exactKeys(value, schemaVersion === 1 ? commonKeys : versionTwoKeys) ||
      typeof value.snapshotId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.snapshotId) ||
      !Number.isSafeInteger(value.observedSince) || !Number.isSafeInteger(value.observedUntil) ||
      value.observedSince < 0 || value.observedUntil > timestamp + 300 ||
      value.observedUntil < timestamp - ROUTING_RESEARCH_RETENTION_MAX_SECONDS ||
      value.observedUntil - value.observedSince !== ROUTING_RESEARCH_WINDOW_SECONDS ||
      !Number.isSafeInteger(value.observedConnectionCount) || value.observedConnectionCount < 1 || value.observedConnectionCount > 1_000_000 ||
      !Number.isSafeInteger(value.identifiedAppConnectionCount) || value.identifiedAppConnectionCount < 0 || value.identifiedAppConnectionCount > 1_000_000 ||
      typeof value.connectionLimitReached !== 'boolean' || !Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 20) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid routing research snapshot');
  }
  const appVersion = str(value.appVersion, 'appVersion', 1, 40);
  const build = str(value.build, 'build', 1, 20);
  const osVersion = str(value.osVersion, 'osVersion', 3, 12);
  const architecture = str(value.architecture, 'architecture', 5, 6);
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-z0-9][a-z0-9.-]{0,19})?$/.test(appVersion) ||
      !/^(?:0|[1-9]\d{0,9})$/.test(build) ||
      !/^\d{1,3}\.\d{1,3}$/.test(osVersion) ||
      !['arm64', 'x86_64'].includes(architecture)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid platform metadata');
  }
  const seen = new Set<string>();
  let total = 0; let identified = 0;
  const entries = value.entries.map((raw: unknown) => {
    const entryKeys = ['app', 'connectionCount', 'directConnectionCount', 'proxiedConnectionCount', 'blockedConnectionCount', 'trafficVolume'];
    rejectUnexpectedKeys(raw, entryKeys);
    if (!exactKeys(raw, entryKeys)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid routing research entry');
    const app = str(raw.app, 'app', 2, 15);
    if (!routingResearchApps.includes(app as typeof routingResearchApps[number]) || seen.has(app)) throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown or duplicate app');
    seen.add(app);
    for (const key of ['connectionCount', 'directConnectionCount', 'proxiedConnectionCount', 'blockedConnectionCount']) {
      if (!Number.isSafeInteger(raw[key]) || raw[key] < 0 || raw[key] > 1_000_000) throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
    }
    if (raw.connectionCount < 1 || raw.directConnectionCount + raw.proxiedConnectionCount + raw.blockedConnectionCount !== raw.connectionCount || !trafficBuckets.includes(raw.trafficVolume)) throw new ApiError(400, 'VALIDATION_ERROR', 'Inconsistent routing research entry');
    total += raw.connectionCount; if (app !== 'other') identified += raw.connectionCount;
    return { app, connectionCount: raw.connectionCount, directConnectionCount: raw.directConnectionCount, proxiedConnectionCount: raw.proxiedConnectionCount, blockedConnectionCount: raw.blockedConnectionCount, trafficVolume: raw.trafficVolume };
  }).sort((a, b) => a.app.localeCompare(b.app));
  if (total !== value.observedConnectionCount || identified !== value.identifiedAppConnectionCount) throw new ApiError(400, 'VALIDATION_ERROR', 'Inconsistent routing research totals');
  const base = { schemaVersion, snapshotId: value.snapshotId.toLowerCase(), observedSince: value.observedSince, observedUntil: value.observedUntil, appVersion, build, osVersion, architecture, observedConnectionCount: total, identifiedAppConnectionCount: identified, connectionLimitReached: value.connectionLimitReached, entries };
  let snapshot;
  if (schemaVersion === 1) {
    snapshot = base;
  } else {
    if (!Array.isArray(value.bundleComponents) || value.bundleComponents.length > 25) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid bundle components');
    }
    const appTotals = new Map(entries.map((entry) => [entry.app, entry]));
    const componentTotals = new Map<string, { connectionCount: number; directConnectionCount: number; proxiedConnectionCount: number; blockedConnectionCount: number }>();
    const componentSeen = new Set<string>();
    const bundleComponents = value.bundleComponents.map((raw: unknown) => {
      const componentKeys = ['app', 'bundleComponent', 'connectionCount', 'directConnectionCount', 'proxiedConnectionCount', 'blockedConnectionCount', 'trafficVolume'];
      rejectUnexpectedKeys(raw, componentKeys);
      if (!exactKeys(raw, componentKeys)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid bundle component entry');
      const app = str(raw.app, 'app', 2, 15);
      const bundleComponent = str(raw.bundleComponent, 'bundleComponent', 11, 20);
      const identity = `${app}:${bundleComponent}`;
      if (!routingResearchComponentApps.includes(app as typeof routingResearchComponentApps[number]) ||
          !routingResearchBundleComponents.includes(bundleComponent as typeof routingResearchBundleComponents[number]) ||
          componentSeen.has(identity)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown or duplicate bundle component');
      }
      componentSeen.add(identity);
      for (const key of ['connectionCount', 'directConnectionCount', 'proxiedConnectionCount', 'blockedConnectionCount']) {
        if (!Number.isSafeInteger(raw[key]) || raw[key] < 0 || raw[key] > 1_000_000) throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
      }
      if (raw.connectionCount < 1 || raw.directConnectionCount + raw.proxiedConnectionCount + raw.blockedConnectionCount !== raw.connectionCount || !trafficBuckets.includes(raw.trafficVolume)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Inconsistent bundle component entry');
      }
      const appTotal = appTotals.get(app);
      if (!appTotal) throw new ApiError(400, 'VALIDATION_ERROR', 'Bundle component app is absent');
      if (trafficBuckets.indexOf(raw.trafficVolume) >
          trafficBuckets.indexOf(appTotal.trafficVolume)) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Bundle component volume exceeds app volume',
        );
      }
      const aggregate = componentTotals.get(app) ?? { connectionCount: 0, directConnectionCount: 0, proxiedConnectionCount: 0, blockedConnectionCount: 0 };
      aggregate.connectionCount += raw.connectionCount;
      aggregate.directConnectionCount += raw.directConnectionCount;
      aggregate.proxiedConnectionCount += raw.proxiedConnectionCount;
      aggregate.blockedConnectionCount += raw.blockedConnectionCount;
      if (aggregate.connectionCount > appTotal.connectionCount ||
          aggregate.directConnectionCount > appTotal.directConnectionCount ||
          aggregate.proxiedConnectionCount > appTotal.proxiedConnectionCount ||
          aggregate.blockedConnectionCount > appTotal.blockedConnectionCount) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Bundle component exceeds app totals');
      }
      componentTotals.set(app, aggregate);
      return { app, bundleComponent, connectionCount: raw.connectionCount, directConnectionCount: raw.directConnectionCount, proxiedConnectionCount: raw.proxiedConnectionCount, blockedConnectionCount: raw.blockedConnectionCount, trafficVolume: raw.trafficVolume };
    }).sort((a, b) => a.app.localeCompare(b.app) || a.bundleComponent.localeCompare(b.bundleComponent));
    snapshot = { ...base, bundleComponents };
  }
  const json = JSON.stringify(snapshot);
  if (new TextEncoder().encode(json).length > 8192) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Routing research payload is too large');
  return { snapshot, json };
}

function canonicalClaudeTrafficResearch(value: unknown) {
  const countKeys = [
    'observedConnectionCount', 'identifiedProcessConnectionCount',
    'proxiedConnectionCount', 'directConnectionCount', 'blockedConnectionCount',
    'directRouteAttemptCount', 'managedDirectRouteCount', 'unclassifiedRouteCount',
    'unsafeProtectionObservationCount',
    'webManagedDirectConnectionCount',
    'weChatConnectionCount', 'weChatManagedDirectConnectionCount',
    'weChatProxiedConnectionCount', 'weChatBlockedConnectionCount',
    'weChatEndpointUnknownProcessConnectionCount',
    'unknownManagedDirectConnectionCount', 'otherManagedDirectConnectionCount',
    'protectedDirectConnectionCount',
  ];
  const booleanKeys = [
    'connectionLimitReached', 'connected', 'killSwitchArmed', 'tunPresent',
    'protectedDNSConfigured',
  ];
  const expectedKeys = [
    'observedSince', 'droppedEndpointCount', ...countKeys, ...booleanKeys,
    'exitIdentityConsistency', 'physicalBypassProbe', 'entries',
  ];
  rejectUnexpectedKeys(value, expectedKeys);
  if (!exactKeys(value, expectedKeys) ||
      !Number.isSafeInteger(value.observedSince) || value.observedSince < 0 || value.observedSince > now() + 300 ||
      !Number.isSafeInteger(value.droppedEndpointCount) || value.droppedEndpointCount < 0 || value.droppedEndpointCount > 64 ||
      !Array.isArray(value.entries) || value.entries.length > 10) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid Claude traffic research snapshot');
  }
  for (const key of countKeys) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1_000_000) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
    }
  }
  for (const key of booleanKeys) {
    if (typeof value[key] !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
    }
  }
  if (value.identifiedProcessConnectionCount > value.observedConnectionCount ||
      value.proxiedConnectionCount + value.directConnectionCount + value.blockedConnectionCount !== value.observedConnectionCount ||
      value.weChatConnectionCount > value.observedConnectionCount ||
      value.weChatManagedDirectConnectionCount + value.weChatProxiedConnectionCount + value.weChatBlockedConnectionCount !== value.weChatConnectionCount ||
      value.webManagedDirectConnectionCount + value.weChatManagedDirectConnectionCount + value.unknownManagedDirectConnectionCount + value.otherManagedDirectConnectionCount > value.directConnectionCount ||
      value.protectedDirectConnectionCount > value.directConnectionCount ||
      value.weChatEndpointUnknownProcessConnectionCount > value.observedConnectionCount) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Inconsistent Claude traffic research counts');
  }
  const exitIdentityConsistency = str(value.exitIdentityConsistency, 'exitIdentityConsistency', 1, 20);
  const physicalBypassProbe = str(value.physicalBypassProbe, 'physicalBypassProbe', 1, 20);
  if (!['MATCHED', 'MISMATCHED', 'INCONCLUSIVE'].includes(exitIdentityConsistency) ||
      !['BLOCKED', 'REACHABLE', 'INCONCLUSIVE'].includes(physicalBypassProbe)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid Claude leak probe verdict');
  }
  const seen = new Set<string>();
  const entries = value.entries.map((raw: unknown) => {
    rejectUnexpectedKeys(raw, ['service', 'client', 'host', 'network', 'port', 'route', 'connections', 'upBytes', 'downBytes']);
    if (!exactKeys(raw, ['service', 'client', 'host', 'network', 'port', 'route', 'connections', 'upBytes', 'downBytes'])) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid Claude traffic research entry');
    }
    const service = str(raw.service, 'service', 1, 20);
    const client = str(raw.client, 'client', 1, 20);
    const host = str(raw.host, 'host', 1, 100);
    const network = str(raw.network, 'network', 1, 3);
    const route = str(raw.route, 'route', 1, 10);
    const officialHost = service === 'claude'
      ? host === 'claude.ai' || host.endsWith('.claude.ai')
      : service === 'anthropic' && (host === 'anthropic.com' || host.endsWith('.anthropic.com'));
    const labels = host.split('.');
    const validHostname = host.length <= 100 && labels.length >= 2 && labels.every((label) =>
      label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) &&
      /^[a-z]{2,}$/.test(labels[labels.length - 1]) &&
      !['local', 'internal', 'localhost', 'home', 'lan'].includes(labels[labels.length - 1]);
    const attributedOther = service === 'other' && ['app', 'code'].includes(client);
    if ((!officialHost && !attributedOther) || !validHostname ||
        !['app', 'code', 'web', 'unknown'].includes(client) ||
        !['TCP', 'UDP'].includes(network) || !['PROXIED', 'DIRECT', 'BLOCKED'].includes(route) ||
        !Number.isSafeInteger(raw.port) || raw.port < 1 || raw.port > 65535 ||
        !Number.isSafeInteger(raw.connections) || raw.connections < 1 || raw.connections > 1_000_000 ||
        !Number.isSafeInteger(raw.upBytes) || raw.upBytes < 0 || raw.upBytes > 1_000_000_000_000_000 ||
        !Number.isSafeInteger(raw.downBytes) || raw.downBytes < 0 || raw.downBytes > 1_000_000_000_000_000) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid Claude traffic research entry');
    }
    const key = `${service}\n${client}\n${host}\n${network}\n${raw.port}\n${route}`;
    if (seen.has(key)) throw new ApiError(400, 'VALIDATION_ERROR', 'Duplicate Claude traffic research entry');
    seen.add(key);
    return {
      service, client, host, network, port: raw.port, route,
      connections: raw.connections, upBytes: raw.upBytes, downBytes: raw.downBytes,
    };
  }).sort((a, b) => {
    const left = `${a.service}\n${a.client}\n${a.host}\n${a.network}\n${String(a.port).padStart(5, '0')}\n${a.route}`;
    const right = `${b.service}\n${b.client}\n${b.host}\n${b.network}\n${String(b.port).padStart(5, '0')}\n${b.route}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return {
    observedSince: value.observedSince,
    droppedEndpointCount: value.droppedEndpointCount,
    ...Object.fromEntries(countKeys.map((key) => [key, value[key]])),
    ...Object.fromEntries(booleanKeys.map((key) => [key, value[key]])),
    exitIdentityConsistency,
    physicalBypassProbe,
    entries,
  };
}

function canonicalActionResult(value: unknown) {
  rejectUnexpectedKeys(value, ['outcome', 'message', 'snapshot', 'trafficResearch']);
  if (!['succeeded', 'failed'].includes(value.outcome)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid outcome');
  }
  if (value.snapshot !== undefined && value.trafficResearch !== undefined) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Only one result snapshot is allowed');
  }
  const result: Row = { outcome: value.outcome };
  if (value.message !== undefined) result.message = str(value.message, 'message', 0, 200);
  if (value.snapshot !== undefined) {
    if (!value.snapshot || typeof value.snapshot !== 'object' || Array.isArray(value.snapshot)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid snapshot');
    }
    const s = value.snapshot as Row;
    const bools = ['connected', 'connecting', 'disconnecting', 'protectionBlocked', 'killSwitchArmed', 'utunPresent', 'protectedDNSConfigured'];
    const strings = ['appVersion', 'build', 'selectedExit', 'connectionStage'];
    rejectUnexpectedKeys(s, [...bools, ...strings, 'reconnectAttempt', 'lastErrorCategory', 'lastCrashLabel']);
    const snapshot: Row = {};
    for (const key of bools) {
      if (s[key] !== undefined && typeof s[key] !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
      if (s[key] !== undefined) snapshot[key] = s[key];
    }
    for (const key of strings) {
      if (s[key] !== undefined) snapshot[key] = str(s[key], key, 0, 100);
    }
    if (s.lastErrorCategory !== undefined) {
      if (typeof s.lastErrorCategory !== 'string' || !errorCategories.includes(s.lastErrorCategory)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid lastErrorCategory');
      }
      snapshot.lastErrorCategory = s.lastErrorCategory;
    }
    if (s.lastCrashLabel !== undefined) {
      if (typeof s.lastCrashLabel !== 'string' || !crashLabels.includes(s.lastCrashLabel)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid lastCrashLabel');
      }
      snapshot.lastCrashLabel = s.lastCrashLabel;
    }
    if (s.reconnectAttempt !== undefined) {
      if (!Number.isSafeInteger(s.reconnectAttempt) || s.reconnectAttempt < 0 || s.reconnectAttempt > 1000) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid reconnectAttempt');
      snapshot.reconnectAttempt = s.reconnectAttempt;
    }
    result.snapshot = snapshot;
  }
  if (value.trafficResearch !== undefined) {
    result.trafficResearch = canonicalClaudeTrafficResearch(value.trafficResearch);
  }
  const json = JSON.stringify(result);
  if (new TextEncoder().encode(json).byteLength > 2048) throw new ApiError(400, 'VALIDATION_ERROR', 'Result is too large');
  return { result, json };
}

function publicAction(row: Row) {
  return {
    id: row.id, userId: row.user_id, deviceId: row.device_id, action: row.action,
    status: row.status, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
    deliveredAt: row.delivered_at === null ? null : Number(row.delivered_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    result: row.result_json ? JSON.parse(row.result_json) : null,
  };
}

const error = (e: unknown) => {
  const x = e instanceof ApiError ? e : new ApiError(500, 'INTERNAL_ERROR', 'Internal server error');
  return Response.json({ error: { code: x.code, message: x.message } }, { status: x.status });
};

async function body(req: Request, maxBytes = 1024 * 1024) {
  // A cross-site form POST (enctype=text/plain) is a no-preflight simple
  // request; requiring the JSON media type means every write that reaches a
  // parse is either same-origin or has already survived a CORS preflight.
  const mediaType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected content-type application/json');
  }
  const declared = Number(req.headers.get('content-length') ?? '0');
  const declaredTooLarge = Number.isFinite(declared) && declared > maxBytes;
  try {
    const reader = req.body?.getReader();
    if (!reader && declaredTooLarge) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    if (!reader) throw new ApiError(400, 'INVALID_JSON', 'Expected a JSON body');
    const chunks: Uint8Array[] = [];
    let total = 0;
    let tooLarge = declaredTooLarge;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        // Drain an oversized stream before responding so neither workerd nor
        // an HTTP sender is left trying to feed an abandoned request body.
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
    if (tooLarge) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    const raw = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      raw.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApiError(400, 'INVALID_JSON', 'Expected a JSON object');
    }
    return value as Row;
  } catch (x) {
    if (x instanceof ApiError) throw x;
    throw new ApiError(400, 'INVALID_JSON', 'Expected a JSON body');
  }
}

// Raw-bytes twin of `body`. Same oversize discipline — drain the stream before
// responding so neither workerd nor the sender is left feeding an abandoned
// request — but no JSON parse: the log pipeline uploads gzip, and base64 in a
// JSON envelope would inflate every segment by a third for nothing.
async function binaryBody(req: Request, maxBytes: number): Promise<Uint8Array> {
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

const str = (v: any, n: string, min = 1, max = 200) => {
  if (typeof v !== 'string' || v.length < min || v.length > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${n}`);
  }
  return v;
};

const email = (v: any) => {
  const x = str(v, 'email').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid email');
  }
  return x;
};

function bearer(req: Request) {
  const h = req.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHORIZED', 'Bearer token required');
  const token = h.slice(7);
  if (!token || token.length > 4_096 || /\s/.test(token)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid bearer token');
  }
  return token;
}

function clientIp(req: Request) {
  return req.headers.get('cf-connecting-ip') || '0.0.0.0';
}

function envInt(e: Env, key: keyof Env, fallback: number) {
  const raw = e[key];
  if (typeof raw !== 'string' || raw === '') return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function tailscaleEnrollmentEnabled(e: Env) {
  return e.TAILSCALE_ENROLLMENT_ENABLED?.trim().toLowerCase() === 'true';
}

function requiredSecret(value: unknown) {
  if (typeof value !== 'string' || value.length < 32) {
    throw new ApiError(503, 'SERVICE_MISCONFIGURED', 'Service credentials are not configured');
  }
  return value;
}

function requiredCatalogKey(e: Env) {
  const value = requiredSecret(e.CATALOG_ENCRYPTION_KEY);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new ApiError(503, 'SERVICE_MISCONFIGURED', 'Catalog encryption is not configured');
  }
  return value;
}

function managedCatalogYAML(value: unknown): string {
  const yaml = str(value, 'yaml', 11, 1024 * 1024);
  if (
    new TextEncoder().encode(yaml).byteLength > 1024 * 1024 ||
    yaml.includes('\0') ||
    yaml.split(/\r?\n/).some((line) => (
      line.length > 16 * 1024 ||
      [...line].some((character) => {
        const code = character.charCodeAt(0);
        return code < 0x09 || (code > 0x0D && code < 0x20) || code === 0x7F;
      })
    )) ||
    !/^proxies\s*:/m.test(yaml)
  ) {
    throw new ApiError(400, 'INVALID_CATALOG', 'Catalog must be bounded Clash YAML with a proxies section');
  }
  // Every identity in a published catalog must be the placeholder, never a
  // literal. One catalog served verbatim to everyone is how every account came
  // to share one exit identity, and why the exit can count bytes but not say
  // whose. Refusing it here means that state cannot be re-published by accident:
  // a real UUID in the document is rejected before it is ever encrypted.
  for (const line of yaml.split(/\r?\n/)) {
    const identity = /^\s*(?:-\s*)?uuid\s*:\s*(.+?)\s*$/.exec(line);
    if (!identity) continue;
    const value = identity[1].replace(/^['"]|['"]$/g, '');
    if (value !== CLIENT_UUID_PLACEHOLDER) {
      throw new ApiError(
        400,
        'INVALID_CATALOG',
        `Catalog identities must be ${CLIENT_UUID_PLACEHOLDER}, so each account is served its own`,
      );
    }
  }
  return yaml;
}

/** Extract the Clash proxy `name` from one list-item block under `proxies:`. */
function catalogProxyName(block: string): string | null {
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(
      // The plain-scalar branch must accept internal spaces ("Los Angeles · Mesa"):
      // the publish tooling validates names with a real YAML parser, and a name this
      // regex cannot see fails the whole catalog closed for every filtered account.
      /^\s*(?:-\s+)?name:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s#"'][^#]*?))\s*(?:#.*)?$/,
    );
    if (!match) continue;
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    return raw.replace(/\\(["'\\])/g, '$1');
  }
  return null;
}

/**
 * Split a managed catalog into `proxies:` list items without a full YAML parser.
 * Only top-level dash items under `proxies:` are treated as nodes; other document
 * keys after the list are preserved in the suffix.
 */
function splitManagedCatalogProxies(yaml: string): {
  prefix: string;
  items: Array<{ name: string; block: string }>;
  suffix: string;
} {
  const normalized = yaml.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let proxiesIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^proxies\s*:\s*(?:#.*)?$/.test(lines[i]) || /^proxies\s*:\s*\[\s*\]\s*(?:#.*)?$/.test(lines[i])) {
      proxiesIdx = i;
      break;
    }
  }
  if (proxiesIdx < 0) {
    throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog is missing a proxies list');
  }
  if (/^proxies\s*:\s*\[\s*\]\s*(?:#.*)?$/.test(lines[proxiesIdx])) {
    return {
      prefix: `${lines.slice(0, proxiesIdx + 1).join('\n')}\n`,
      items: [],
      suffix: lines.slice(proxiesIdx + 1).join('\n'),
    };
  }

  let itemIndent: number | null = null;
  const itemStarts: number[] = [];
  let listEnd = lines.length;
  for (let i = proxiesIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent === 0 && !line.trimStart().startsWith('-')) {
      listEnd = i;
      break;
    }
    if (/^\s*-\s+/.test(line)) {
      if (itemIndent === null) itemIndent = indent;
      if (indent === itemIndent) itemStarts.push(i);
    }
  }

  if (itemStarts.length === 0) {
    return {
      prefix: lines.slice(0, proxiesIdx + 1).join('\n') + '\n',
      items: [],
      suffix: lines.slice(listEnd).join('\n'),
    };
  }

  const items: Array<{ name: string; block: string }> = [];
  for (let n = 0; n < itemStarts.length; n++) {
    const start = itemStarts[n];
    const end = n + 1 < itemStarts.length ? itemStarts[n + 1] : listEnd;
    const block = lines.slice(start, end).join('\n');
    const name = catalogProxyName(block);
    if (!name) {
      throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog has an unnamed proxy entry');
    }
    items.push({ name, block });
  }

  return {
    prefix: lines.slice(0, proxiesIdx + 1).join('\n') + '\n',
    items,
    suffix: lines.slice(listEnd).join('\n'),
  };
}

/**
 * Shared proxies stay for every authenticated user. Active home-exit proxy names
 * are withheld unless the user is bound to that exact home exit.
 */
function filterCatalogYamlForUser(
  yaml: string,
  restrictedHomeNames: Set<string>,
  allowedHomeNames: Set<string>,
): string {
  if (restrictedHomeNames.size === 0) return yaml;
  const { prefix, items, suffix } = splitManagedCatalogProxies(yaml);
  if (items.length === 0) return yaml;
  const kept = items.filter(
    (item) => !restrictedHomeNames.has(item.name) || allowedHomeNames.has(item.name),
  );
  if (kept.length === items.length) return yaml;
  if (kept.length === 0) {
    const empty = 'proxies: []\n';
    return suffix.trim() ? `${empty}${suffix.startsWith('\n') ? suffix.slice(1) : suffix}` : empty;
  }
  const body = kept.map((item) => item.block.replace(/\s+$/, '')).join('\n') + '\n';
  const joined = `${prefix}${body}${suffix}`;
  return joined.endsWith('\n') ? joined : `${joined}\n`;
}

function optionalIpv4(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const address = str(value, field, 7, 45).trim();
  const parts = address.split('.');
  if (
    parts.length !== 4 ||
    parts.some((part) => {
      if (!/^\d{1,3}$/.test(part)) return true;
      const n = Number(part);
      return n > 255 || (part.length > 1 && part.startsWith('0'));
    })
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${field}`);
  }
  return address;
}

// Home-exit and binding writes change a user's served catalog (filtered node
// set) and its routing directive without touching the raw catalog YAML. The
// Windows client treats "same revision + different digest" as tampering and
// silently skips routing when the digest is unchanged, so every such write
// must advance the catalog revision to propagate. Unbound users re-install an
// identical catalog, which is harmless churn at this scale.
async function bumpCatalogRevision(e: Env) {
  await e.DB.prepare(
    'UPDATE managed_exit_catalog SET revision = revision + 1, updated_at = ? WHERE singleton_id = 1',
  ).bind(now()).run();
}

function proxyNameField(value: unknown): string {
  const name = str(value, 'proxyName', 1, 200).trim();
  if (!name || /[\r\n\0]/.test(name)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid proxyName');
  }
  return name;
}

async function defaultProxyNameField(e: Env, value: unknown): Promise<string | null> {
  if (value === undefined || value === null || value === '') return null;
  const name = str(value, 'defaultProxyName', 1, 200);
  const clash = await e.DB.prepare(
    'SELECT 1 FROM home_exits WHERE proxy_name = ?',
  ).bind(name).first<Row>();
  if (clash) {
    throw new ApiError(400, 'INVALID_DEFAULT_PROXY', 'defaultProxyName must not match any home exit proxyName');
  }
  return name;
}

// A socks5 upstream host is a public IPv4 literal or a plain hostname (the
// residential gateway is always a public address; it is dialed through the
// tunnel, never directly). Keep the grammar intentionally narrow.
function socks5HostField(value: unknown): string {
  const host = str(value, 'socks5Host', 1, 253).trim();
  const ipv4 = host.split('.');
  const isIpv4 =
    ipv4.length === 4 &&
    ipv4.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const n = Number(part);
      return n <= 255 && (part.length === 1 || !part.startsWith('0'));
    });
  const isHostname =
    /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(host) &&
    // A dotted all-numeric string that is not a valid IPv4 literal is not a
    // hostname either — it is a mistyped address.
    !/^[0-9.]+$/.test(host);
  if (!isIpv4 && !isHostname) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid socks5Host');
  }
  return host;
}

function socks5PortField(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid socks5Port');
  }
  return value as number;
}

// kind='socks5' requires all four upstream fields; kind='catalog' forbids them.
function validateHomeSocks5(
  kind: string,
  host: string | null,
  port: number | null,
  username: string | null,
  password: string | null,
) {
  if (kind === 'socks5') {
    if (host === null || port === null || username === null || password === null) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'socks5Host, socks5Port, socks5Username and socks5Password are required when kind is socks5');
    }
    return;
  }
  if (host !== null || port !== null || username !== null || password !== null) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'socks5 fields require kind to be socks5');
  }
}

function publicHomeExit(row: Row) {
  return {
    id: String(row.id),
    proxyName: String(row.proxy_name),
    displayName: String(row.display_name),
    egressIpv4: row.egress_ipv4 == null ? undefined : String(row.egress_ipv4),
    kind: String(row.kind ?? 'catalog'),
    // Credentials (socks5Username/socks5Password) are never echoed back by any
    // GET endpoint; they only ride the bound user's own catalog routing.
    socks5Host: row.socks5_host == null ? undefined : String(row.socks5_host),
    socks5Port: row.socks5_port == null ? undefined : Number(row.socks5_port),
    status: String(row.status),
    notes: row.notes == null || row.notes === '' ? undefined : String(row.notes),
    bindCount: row.bind_count === undefined || row.bind_count === null ? undefined : Number(row.bind_count),
    lastProbedAt: row.last_probed_at == null ? undefined : Number(row.last_probed_at),
    probeStatus: row.probe_status == null ? undefined : String(row.probe_status),
    probeAlive: row.probe_alive == null ? undefined : Number(row.probe_alive),
    probeTotal: row.probe_total == null ? undefined : Number(row.probe_total),
    probeUptimeRatio: row.probe_uptime_ratio == null ? undefined : Number(row.probe_uptime_ratio),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function publicHomeBinding(row: Row) {
  return {
    userId: String(row.user_id),
    email: row.email == null ? undefined : String(row.email),
    homeExitId: String(row.home_exit_id),
    proxyName: String(row.proxy_name),
    displayName: String(row.display_name),
    egressIpv4: row.egress_ipv4 == null ? undefined : String(row.egress_ipv4),
    kind: row.kind == null ? undefined : String(row.kind),
    socks5Host: row.socks5_host == null ? undefined : String(row.socks5_host),
    socks5Port: row.socks5_port == null ? undefined : Number(row.socks5_port),
    defaultProxyName: row.default_proxy_name == null || row.default_proxy_name === ''
      ? undefined
      : String(row.default_proxy_name),
    homeStatus: String(row.home_status ?? row.status),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

type ParsedHomeLine = {
  host: string;
  port: number;
  username: string;
  password: string;
  notes: string | null;
};

function parseHomeLine(raw: unknown): ParsedHomeLine {
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'INVALID_HOME_LINE', 'Home line must be a string');
  }
  const line = raw.trim().replace(/^\uFEFF/, '').replace(/^['"]|['"]$/g, '').trim();
  if (!line || line.length > 2_000) {
    throw new ApiError(400, 'INVALID_HOME_LINE', 'Home line is empty or too long');
  }

  let host = '';
  let port = 0;
  let username = '';
  let password = '';
  let notes: string | null = null;

  if (/^socks5:\/\//i.test(line)) {
    let url: URL;
    try {
      url = new URL(line);
    } catch {
      throw new ApiError(400, 'INVALID_HOME_LINE', 'Invalid socks5 URL');
    }
    host = url.hostname;
    port = Number(url.port);
    try {
      username = decodeURIComponent(url.username);
      password = decodeURIComponent(url.password);
    } catch {
      throw new ApiError(400, 'INVALID_HOME_LINE', 'Invalid socks5 URL credentials');
    }
  } else if (line.includes('@')) {
    const at = line.lastIndexOf('@');
    const auth = line.slice(0, at);
    const hostport = line.slice(at + 1);
    const colon = auth.indexOf(':');
    const hp = hostport.lastIndexOf(':');
    if (colon < 1 || hp < 1) {
      throw new ApiError(400, 'INVALID_HOME_LINE', 'Expected user:pass@host:port');
    }
    username = auth.slice(0, colon);
    password = auth.slice(colon + 1);
    host = hostport.slice(0, hp);
    port = Number(hostport.slice(hp + 1));
  } else {
    const parts = line.split(':');
    if (parts.length !== 4 && parts.length !== 5) {
      throw new ApiError(400, 'INVALID_HOME_LINE', 'Expected host:port:user:pass');
    }
    host = parts[0];
    port = Number(parts[1]);
    username = parts[2];
    password = parts[3];
    notes = parts[4] !== undefined && parts[4] !== '' ? parts[4] : null;
  }

  if (!username || !password) {
    throw new ApiError(400, 'INVALID_HOME_LINE', 'Username and password are required');
  }
  host = socks5HostField(host);
  const octets = host.split('.').map(Number);
  const isIpv4 = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isIpv4) {
    const [a, b] = octets;
    if (
      a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
    ) {
      throw new ApiError(400, 'INVALID_HOME_LINE', 'Home line host must be a public address');
    }
  }
  if (!Number.isSafeInteger(port)) {
    throw new ApiError(400, 'INVALID_HOME_LINE', 'Invalid port');
  }
  port = socks5PortField(port);
  username = str(username, 'socks5Username', 1, 255);
  password = str(password, 'socks5Password', 1, 255);
  if (notes !== null) notes = str(notes, 'notes', 1, 1000);
  return { host, port, username, password, notes };
}

function socks5ProxyName() {
  return `home-socks5-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

const HOME_BINDING_SELECT = `
  SELECT
    user_home_bindings.user_id,
    users.email,
    user_home_bindings.home_exit_id,
    user_home_bindings.default_proxy_name,
    home_exits.proxy_name,
    home_exits.display_name,
    home_exits.kind,
    home_exits.socks5_host,
    home_exits.socks5_port,
    home_exits.egress_ipv4,
    home_exits.status AS home_status,
    user_home_bindings.created_at,
    user_home_bindings.updated_at
  FROM user_home_bindings
  JOIN users ON users.id = user_home_bindings.user_id
  JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
`;

async function loadHomeBinding(e: Env, userId: string) {
  return e.DB.prepare(`${HOME_BINDING_SELECT} WHERE user_home_bindings.user_id = ?`).bind(userId).first<Row>();
}

async function findSocks5Home(e: Env, host: string, port: number, username: string) {
  return e.DB.prepare(
    `SELECT * FROM home_exits
     WHERE kind = 'socks5' AND socks5_host = ? AND socks5_port = ? AND socks5_username = ?`,
  ).bind(host, port, username).first<Row>();
}

async function insertSocks5HomeExit(
  e: Env,
  parsed: ParsedHomeLine,
  displayName: string,
): Promise<Row> {
  const existing = await findSocks5Home(e, parsed.host, parsed.port, parsed.username);
  if (existing) {
    throw new ApiError(409, 'HOME_LINE_EXISTS', 'A home exit with this host, port and username already exists');
  }
  const homeId = id();
  const t = now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const proxyName = socks5ProxyName();
    try {
      const egressIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.host) ? parsed.host : null;
      await e.DB.prepare(
        `INSERT INTO home_exits(
           id, proxy_name, display_name, egress_ipv4, kind,
           socks5_host, socks5_port, socks5_username, socks5_password,
           status, notes, created_at, updated_at
         ) VALUES(?, ?, ?, ?, 'socks5', ?, ?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(
        homeId, proxyName, displayName, egressIpv4,
        parsed.host, parsed.port, parsed.username, parsed.password,
        parsed.notes, t, t,
      ).run();
      const row = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(homeId).first<Row>();
      if (!row) throw new ApiError(500, 'INTERNAL_ERROR', 'Home exit insert failed');
      return row;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (attempt === 4) {
        throw new ApiError(409, 'HOME_EXIT_CONFLICT', 'A home exit with this proxyName already exists');
      }
    }
  }
  throw new ApiError(500, 'INTERNAL_ERROR', 'Home exit insert failed');
}

async function upsertHomeBinding(
  e: Env,
  userId: string,
  homeExitId: string,
  defaultProxyName: string | null,
) {
  const t = now();
  const existing = await e.DB.prepare(
    'SELECT created_at FROM user_home_bindings WHERE user_id = ?',
  ).bind(userId).first<Row>();
  if (existing) {
    await e.DB.prepare(
      `UPDATE user_home_bindings
       SET home_exit_id = ?, default_proxy_name = ?, updated_at = ?
       WHERE user_id = ?`,
    ).bind(homeExitId, defaultProxyName, t, userId).run();
    return { created: false };
  }
  await e.DB.prepare(
    `INSERT INTO user_home_bindings(user_id, home_exit_id, default_proxy_name, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?)`,
  ).bind(userId, homeExitId, defaultProxyName, t, t).run();
  return { created: true };
}

async function enqueueRefreshCatalogForUser(e: Env, userId: string) {
  const devices = await e.DB.prepare(
    "SELECT id FROM devices WHERE user_id = ? AND status != 'revoked'",
  ).bind(userId).all<Row>();
  const t = now();
  let queued = 0;
  for (const device of devices.results) {
    await e.DB.prepare(
      "INSERT INTO device_actions(id,user_id,device_id,action,status,created_at,expires_at) VALUES(?,?,?,?, 'pending', ?, ?)",
    ).bind(id(), userId, device.id, 'refresh_catalog', t, t + 300).run();
    queued += 1;
  }
  return queued;
}

const PRODUCT_CLAUDE = 'claude_20x';

function accountRefField(value: unknown): string {
  const raw = str(value, 'accountRef', 1, 200).trim();
  if (/[\r\n\0]/.test(raw)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid accountRef');
  return raw.includes('@') ? raw.toLowerCase() : raw;
}

function optionalNotes(value: unknown, name = 'notes', max = 2000): string | null {
  if (value === undefined || value === null || value === '') return null;
  return str(value, name, 1, max);
}

function httpsUrlField(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const url = str(value, name, 8, 500).trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${name} must be https`);
  }
  return parsed.toString();
}

function optionalUnix(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value as number;
}

function optionalByteCount(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value as number;
}

function optionalMoney(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value;
}

function optionalCurrency(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const currency = str(value, 'currency', 1, 8).trim();
  if (!/^[A-Za-z$€£¥￥]{1,8}$/.test(currency)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid currency');
  }
  return currency;
}

function optionalBillingCycle(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > 3_650) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid billingCycle');
  }
  return value as number;
}

function publicProductAccount(row: Row) {
  return {
    id: String(row.id),
    userId: row.user_id == null ? null : String(row.user_id),
    email: row.email == null ? undefined : String(row.email),
    product: String(row.product),
    accountRef: String(row.account_ref),
    status: String(row.status),
    openedAt: row.opened_at == null ? null : Number(row.opened_at),
    closedAt: row.closed_at == null ? null : Number(row.closed_at),
    closeReason: row.close_reason == null ? null : String(row.close_reason),
    notes: row.notes == null || row.notes === '' ? undefined : String(row.notes),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function publicProductEvent(row: Row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    userId: row.user_id == null ? null : String(row.user_id),
    type: String(row.type),
    at: Number(row.at),
    detail: row.detail == null ? undefined : String(row.detail),
    replacedByAccountId: row.replaced_by_account_id == null ? undefined : String(row.replaced_by_account_id),
  };
}

function publicNodeProfile(row: Row) {
  return {
    id: String(row.id),
    catalogName: String(row.catalog_name),
    publicIp: row.public_ip == null ? undefined : String(row.public_ip),
    provider: row.provider == null ? undefined : String(row.provider),
    billingUrl: row.billing_url == null ? undefined : String(row.billing_url),
    price: row.price == null ? null : Number(row.price),
    currency: row.currency == null ? null : String(row.currency),
    billingCycle: row.billing_cycle == null ? null : Number(row.billing_cycle),
    trafficQuotaBytes: row.traffic_quota_bytes == null ? null : Number(row.traffic_quota_bytes),
    trafficUsedBytes: row.traffic_used_bytes == null ? null : Number(row.traffic_used_bytes),
    trafficCycleStart: row.traffic_cycle_start == null ? null : Number(row.traffic_cycle_start),
    trafficCycleEnd: row.traffic_cycle_end == null ? null : Number(row.traffic_cycle_end),
    cycleNetIn: row.cycle_net_in == null ? null : Number(row.cycle_net_in),
    cycleNetOut: row.cycle_net_out == null ? null : Number(row.cycle_net_out),
    renewsAt: row.renews_at == null ? null : Number(row.renews_at),
    notes: row.notes == null || row.notes === '' ? undefined : String(row.notes),
    status: String(row.status),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

async function writeOpsAudit(
  e: Env,
  actorEmail: string | undefined,
  action: string,
  targetType: string,
  targetId: string | null,
  summary: string,
) {
  try {
    await e.DB.prepare(
      'INSERT INTO ops_audit(id, at, actor_email, action, target_type, target_id, summary) VALUES(?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      id(),
      now(),
      (actorEmail || 'unknown').slice(0, 254),
      action.slice(0, 80),
      targetType.slice(0, 80),
      targetId,
      summary.slice(0, 500),
    ).run();
  } catch {
    // Audit must never fail the operator action; the table may be mid-migration.
  }
}

async function markFirstEntitled(e: Env, userId: string, at: number) {
  await e.DB.prepare(
    `UPDATE users
     SET first_entitled_at = COALESCE(first_entitled_at, ?),
         plan = COALESCE(plan, ?),
         updated_at = ?
     WHERE id = ?`,
  ).bind(at, PRODUCT_CLAUDE, at, userId).run();
}

async function recordProductEvent(
  e: Env,
  accountId: string,
  userId: string | null,
  type: string,
  detail: string | null,
  replacedBy: string | null = null,
) {
  await e.DB.prepare(
    `INSERT INTO product_account_events(
       id, account_id, user_id, type, at, detail, replaced_by_account_id
     ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id(), accountId, userId, type, now(), detail, replacedBy).run();
}

async function assignedProductForUser(e: Env, userId: string) {
  return e.DB.prepare(
    "SELECT * FROM product_accounts WHERE user_id = ? AND status = 'assigned'",
  ).bind(userId).first<Row>();
}

async function replaceCountForUser(e: Env, userId: string) {
  const row = await e.DB.prepare(
    "SELECT COUNT(*) total FROM product_account_events WHERE user_id = ? AND type = 'replaced'",
  ).bind(userId).first<Row>();
  return Number(row?.total ?? 0);
}

async function createAssignedProductAccount(
  e: Env,
  userId: string,
  accountRef: string,
  openedAt: number,
  notes: string | null,
  actorEmail: string | undefined,
) {
  const current = await assignedProductForUser(e, userId);
  if (current) {
    throw new ApiError(409, 'PRODUCT_ALREADY_ASSIGNED', 'User already has an assigned Claude account; replace it instead');
  }
  const clash = await e.DB.prepare(
    'SELECT id, status FROM product_accounts WHERE account_ref = ?',
  ).bind(accountRef).first<Row>();
  const t = now();
  if (clash) {
    if (String(clash.status) !== 'pooled') {
      throw new ApiError(409, 'ACCOUNT_REF_IN_USE', 'This Claude account is already registered');
    }
    await e.DB.prepare(
      `UPDATE product_accounts
       SET user_id = ?, status = 'assigned', opened_at = COALESCE(opened_at, ?), notes = COALESCE(?, notes), updated_at = ?
       WHERE id = ? AND status = 'pooled'`,
    ).bind(userId, openedAt, notes, t, clash.id).run();
    await recordProductEvent(e, String(clash.id), userId, 'assigned', null);
    await markFirstEntitled(e, userId, openedAt);
    await writeOpsAudit(e, actorEmail, 'product.assign', 'product_account', String(clash.id), `assigned ${accountRef}`);
    const row = await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(clash.id).first<Row>();
    return row!;
  }
  const accountId = id();
  try {
    await e.DB.prepare(
      `INSERT INTO product_accounts(
         id, user_id, product, account_ref, status, opened_at, closed_at, close_reason, notes, created_at, updated_at
       ) VALUES(?, ?, ?, ?, 'assigned', ?, NULL, NULL, ?, ?, ?)`,
    ).bind(accountId, userId, PRODUCT_CLAUDE, accountRef, openedAt, notes, t, t).run();
  } catch {
    throw new ApiError(409, 'ACCOUNT_REF_IN_USE', 'This Claude account is already registered');
  }
  await recordProductEvent(e, accountId, userId, 'opened', null);
  await recordProductEvent(e, accountId, userId, 'assigned', null);
  await markFirstEntitled(e, userId, openedAt);
  await writeOpsAudit(e, actorEmail, 'product.open', 'product_account', accountId, `opened ${accountRef}`);
  const row = await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>();
  return row!;
}

async function banProductAccount(e: Env, accountId: string, detail: string | null, actorEmail: string | undefined) {
  const row = await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Product account not found');
  if (String(row.status) !== 'assigned' && String(row.status) !== 'pooled') {
    throw new ApiError(409, 'ACCOUNT_NOT_ACTIVE', 'Only assigned or pooled accounts can be banned');
  }
  const t = now();
  await e.DB.prepare(
    `UPDATE product_accounts
     SET status = 'banned', closed_at = ?, close_reason = 'banned', updated_at = ?
     WHERE id = ?`,
  ).bind(t, t, accountId).run();
  await recordProductEvent(e, accountId, row.user_id == null ? null : String(row.user_id), 'banned', detail);
  await writeOpsAudit(
    e, actorEmail, 'product.ban', 'product_account', accountId,
    `banned ${row.account_ref}`,
  );
  return (await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>())!;
}

async function replaceProductAccount(
  e: Env,
  accountId: string,
  nextRef: string,
  notes: string | null,
  actorEmail: string | undefined,
) {
  const current = await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>();
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Product account not found');
  if (String(current.status) !== 'assigned' || current.user_id == null) {
    throw new ApiError(409, 'ACCOUNT_NOT_ASSIGNED', 'Only an assigned account can be replaced');
  }
  const userId = String(current.user_id);
  const t = now();
  await e.DB.prepare(
    `UPDATE product_accounts
     SET status = 'retired', closed_at = ?, close_reason = 'rotated', updated_at = ?
     WHERE id = ?`,
  ).bind(t, t, accountId).run();
  const next = await createAssignedProductAccount(e, userId, nextRef, t, notes, actorEmail);
  await recordProductEvent(e, accountId, userId, 'replaced', null, String(next.id));
  await writeOpsAudit(
    e, actorEmail, 'product.replace', 'product_account', String(next.id),
    `replaced ${current.account_ref}`,
  );
  return { previous: (await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>())!, current: next };
}

const CLIENT_UUID_PLACEHOLDER = '{{TONO_CLIENT_UUID}}';

/// The identity this account presents at the exit, minted on first need.
///
/// Stable across fetches on purpose: the client persists the catalog digest and
/// compares it, so an identity that changed per request would look like a
/// tampered catalog every time.
async function exitClientUUID(e: Env, userId: string): Promise<string> {
  const existing = await e.DB.prepare(
    'SELECT client_uuid FROM exit_credentials WHERE user_id = ?',
  ).bind(userId).first<Row>();
  if (existing) return String(existing.client_uuid);
  const minted = crypto.randomUUID();
  // A racing request may have inserted first; that row is as good as this one,
  // so adopt it rather than failing a catalog fetch over it.
  await e.DB.prepare(
    'INSERT OR IGNORE INTO exit_credentials(user_id, client_uuid, created_at) VALUES(?,?,?)',
  ).bind(userId, minted, now()).run();
  const row = await e.DB.prepare(
    'SELECT client_uuid FROM exit_credentials WHERE user_id = ?',
  ).bind(userId).first<Row>();
  if (!row) throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Could not issue an exit identity');
  return String(row.client_uuid);
}

type CatalogRouting = {
  homeProxy?: string;
  defaultProxy?: string;
  // Full upstream credentials appear only here — inside the bound user's
  // own catalog. The ops/admin plaintext catalogs never carry them.
  homeSocks5?: { host: string; port: number; username: string; password: string };
};

async function homeRoutingForUser(e: Env, userId: string) {
  const homes = await e.DB.prepare(
    "SELECT proxy_name FROM home_exits WHERE status = 'active' AND kind = 'catalog'",
  ).all<Row>();
  const restricted = new Set(homes.results.map((item) => String(item.proxy_name)));
  const binding = await e.DB.prepare(
    `SELECT home_exits.proxy_name, home_exits.kind,
            home_exits.socks5_host, home_exits.socks5_port,
            home_exits.socks5_username, home_exits.socks5_password,
            user_home_bindings.default_proxy_name
     FROM user_home_bindings
     JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
     WHERE user_home_bindings.user_id = ?
       AND home_exits.status = 'active'`,
  ).bind(userId).first<Row>();
  const allowed = new Set<string>();
  let routing: CatalogRouting | undefined;
  if (binding) {
    allowed.add(String(binding.proxy_name));
    const directives: CatalogRouting = {};
    if (String(binding.kind ?? 'catalog') === 'socks5') {
      directives.homeSocks5 = {
        host: String(binding.socks5_host),
        port: Number(binding.socks5_port),
        username: String(binding.socks5_username),
        password: String(binding.socks5_password),
      };
    } else {
      directives.homeProxy = String(binding.proxy_name);
    }
    if (binding.default_proxy_name != null && binding.default_proxy_name !== '') {
      directives.defaultProxy = String(binding.default_proxy_name);
    }
    routing = directives;
  }
  return { routing, restricted, allowed };
}

async function publicManagedCatalog(
  e: Env,
  options?: { userId?: string; filterHomeExits?: boolean },
) {
  const row = await e.DB.prepare(
    'SELECT revision, ciphertext, nonce, content_sha256, updated_at FROM managed_exit_catalog WHERE singleton_id = 1',
  ).first<Row>();
  let yaml = 'proxies: []\n';
  let digest = await sha256(yaml);
  let updatedAt: number | undefined;
  let revision = 0;
  if (row) {
    try {
      yaml = await decryptCatalog(
        String(row.ciphertext),
        String(row.nonce),
        requiredCatalogKey(e),
      );
    } catch {
      throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog is unavailable');
    }
    digest = await sha256(yaml);
    if (digest !== row.content_sha256) {
      throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog failed integrity validation');
    }
    revision = Number(row.revision);
    updatedAt = Number(row.updated_at);
  }
  let served = yaml;
  // The stored digest authenticates the catalog template. Authenticated clients
  // receive a stable per-account identity, so recompute the digest after
  // substitution and any per-user home-exit filtering.
  if (options?.userId && served.includes(CLIENT_UUID_PLACEHOLDER)) {
    const issued = await exitClientUUID(e, options.userId);
    served = served.split(CLIENT_UUID_PLACEHOLDER).join(issued);
  }
  let routing: CatalogRouting | undefined;
  if (options?.filterHomeExits && options.userId) {
    const home = await homeRoutingForUser(e, options.userId);
    routing = home.routing;
    if (home.restricted.size > 0) {
      served = filterCatalogYamlForUser(served, home.restricted, home.allowed);
    }
  }
  return {
    revision,
    yaml: served,
    sha256: served === yaml ? digest : await sha256(served),
    updatedAt,
    ...(routing ? { routing } : {}),
  };
}

type TrafficPolicy = {
  version: 1 | 2 | 3 | 4;
  domains: Array<{ host: string; ports: number[] }>;
  mediaEndpoints: Array<{ address: string; ports: number[] }>;
  webDomains?: Array<{ host: string; ports: number[] }>;
  directSuffixes?: Array<{ host: string; ports: number[] }>;
  tcpEndpoints?: Array<{ address: string; ports: number[] }>;
};

const emptyTrafficPolicy = (): TrafficPolicy => ({ version: 1, domains: [], mediaEndpoints: [] });

function exactKeys(value: Row, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function canonicalPorts(value: unknown, allowed: number[], name: string) {
  if (!Array.isArray(value) || value.length === 0 || value.some((port) => !Number.isInteger(port) || !allowed.includes(port))) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  if (new Set(value).size !== value.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Duplicate ${name}`);
  }
  return [...value].sort((a, b) => a - b) as number[];
}

function isPublicIPv4(address: string) {
  if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(address)) return false;
  const octets = address.split('.').map(Number);
  if (octets.some((part) => part > 255)) return false;
  const [a, b, c] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) ||
    (a === 203 && b === 0 && c === 113));
}

// `trusted` is set only once an Ed25519 signature over the resulting canonical
// document has verified against the compiled-in public key. It relaxes exactly
// one thing: the lists of hostnames permitted to route direct. Every other check
// stays, because a signature says who wrote the document, not that the document
// is well formed — a signed policy with a malformed entry or one list too long
// would be faithfully delivered to every client and break all of them.
//
// `protectedSuffixes` is NOT relaxed, and must never be. Those are the hosts that
// must never leave the tunnel, including this control plane itself. Folding them
// into what a signature can override would make a leaked private key sufficient
// to expose the traffic the product exists to protect, which is a strictly worse
// position than the allowlist this mechanism replaces.
function canonicalTrafficPolicy(value: unknown, trusted = false): TrafficPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid policy');
  }
  const policy = value as Row;
  const isVersion1 = policy.version === 1 &&
    exactKeys(policy, ['version', 'domains', 'mediaEndpoints']);
  const isVersion2 = policy.version === 2 &&
    exactKeys(policy, ['version', 'domains', 'mediaEndpoints', 'webDomains']);
  const isVersion3 = policy.version === 3 &&
    exactKeys(policy, ['version', 'domains', 'mediaEndpoints', 'webDomains', 'directSuffixes']);
  const isVersion4 = policy.version === 4 &&
    exactKeys(policy, ['version', 'domains', 'mediaEndpoints', 'webDomains', 'directSuffixes', 'tcpEndpoints']);
  if ((!isVersion1 && !isVersion2 && !isVersion3 && !isVersion4) ||
      !Array.isArray(policy.domains) || policy.domains.length > 32 ||
      !Array.isArray(policy.mediaEndpoints) || policy.mediaEndpoints.length > 64 ||
      ((isVersion2 || isVersion3 || isVersion4) &&
        (!Array.isArray(policy.webDomains) || policy.webDomains.length > 32)) ||
      ((isVersion3 || isVersion4) &&
        (!Array.isArray(policy.directSuffixes) || policy.directSuffixes.length > 64)) ||
      (isVersion4 &&
        (!Array.isArray(policy.tcpEndpoints) || policy.tcpEndpoints.length > 64))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid traffic policy version or shape');
  }
  const allowedWeChatSuffixes = ['qq.com', 'qq.com.cn', 'qpic.cn', 'qlogo.cn', 'gtimg.cn', 'gtimg.com', 'wechat.com', 'weixin.com', 'weixinbridge.com', 'wxs.qq.com'];
  // `domains` is the application-direct set. The field predates the office
  // clients and keeps its wire name for compatibility, but its admission is
  // now shared by WeChat, DingTalk and Feishu/Lark. The client still requires
  // a reviewed process identity before a raw-IP socket can use this surface.
  const allowedNativeDirectSuffixes = [
    ...allowedWeChatSuffixes,
    'feishu.cn', 'feishucdn.com', 'larksuite.com', 'larkoffice.com',
    'feishu.net', 'feishuapp.cn', 'feishuapp.com', 'feishudoc.cn',
    'feishudoc.com', 'feishumeetings.cn', 'feishumeetings.com',
    'feishuimg.com', 'feishukacdn.com', 'larkofficecdn.com',
    'larkofficeimg.com', 'larkcloud.com', 'larkcloud.net',
    'getfeishu.cn', 'getfeishu.com', 'feishupkg.com', 'feishuvc.cn',
    'feishuvc.com', 'securityfeishu.cn', 'securityfs.cn', 'statusfeishu.cn',
    // Feishu's official client firewall list includes these shared service
    // namespaces. Keep them native-app-only; browser suffix routing stays
    // narrower so a signed-client policy cannot widen ordinary web traffic.
    'zjurl.cn', 'snssdk.com', 'pstatp.com', 'byteimg.com',
    'bytedance.net', 'bytedance.com', 'byted-static.com', 'bytegoofy.com',
    'feishu-3rd-party-services.com', 'bytehwm.com', 'ttwebview.com',
    'bytegecko.com', 'bytescm.com', 'kundou.cn', 'bytetos.com',
    'zijieapi.com', 'byteeffecttos.com', 'bytednsdoc.com', 'bytedanceapi.com',
    'volcvideo.com', 'feelgood.cn', 'baseopendev.com', 'bytedapm.com',
    'ibytedapm.com', 'larkenterprise.com', 'aiforce.cloud', 'aiforce.run',
    'dingtalk.cn', 'dingtalk.com', 'dingtalk.net', 'dingtalkapps.com',
    'dingtalkcloud.com', 'dingding.xin', 'ztna-dingtalk.com', 'ddurl.to',
  ];
  const allowedWebSuffixes = [
    'bilibili.com', 'biliapi.net', 'bilivideo.com', 'hdslb.com', 'qq.com',
    'gtimg.cn', 'gtimg.com', 'iqiyi.com', 'qiyi.com', 'qiyipic.com',
    'iqiyipic.com', 'youku.com', 'ykimg.com', 'xiaohongshu.com',
    'xhslink.com', 'xhscdn.com', 'feishu.cn', 'feishucdn.com',
    'larksuite.com', 'larkoffice.com', 'feishu.net', 'feishuapp.cn',
    'feishuapp.com', 'feishudoc.cn', 'feishudoc.com', 'feishumeetings.cn',
    'feishumeetings.com', 'feishuimg.com', 'feishukacdn.com',
    'larkofficecdn.com', 'larkofficeimg.com', 'larkcloud.com',
    'larkcloud.net', 'getfeishu.cn', 'getfeishu.com', 'feishupkg.com',
    'feishuvc.cn', 'feishuvc.com', 'securityfeishu.cn', 'securityfs.cn',
    'statusfeishu.cn', 'dingtalk.cn', 'dingtalk.com', 'dingtalk.net',
    'dingtalkapps.com', 'dingtalkcloud.com', 'dingding.xin',
    'ztna-dingtalk.com', 'ddurl.to', 'baidu.com', 'baidupcs.com',
    'bcebos.com', 'baidubcs.com', 'bdstatic.com', 'bdimg.com',
    'aliyuncs.com', '10jqka.com.cn', 'iwencai.com', 'eastmoney.com',
    'dfcfw.com', 'sina.com.cn', 'sinajs.cn', 'legulegu.com', 'optbbs.com',
    '100ppi.com', 'awtmt.com', 'cls.cn', 'cninfo.com.cn', 'ccxe.com.cn',
    'pushplus.plus', 'baostock.com', 'sse.com.cn', 'szse.cn', 'zoom.us',
    'zoom.com',
    'zoomgov.com', 'oray.com', 'sunlogin.com', 'edu.cn',
  ];
  const allowedWebExactHosts = ['ykimg.alicdn.com'];
  // NARROWING THESE LISTS IS A BREAKING OPERATION. `publicTrafficPolicy` runs the
  // stored policy back through this function on every read, so removing an entry
  // that the live policy still uses turns every policy fetch into a 503 and
  // disables managed direct routing fleet-wide. Republish the policy without the
  // entry first, then narrow. Widening is safe; the client re-validates against
  // its own allowlist and rejects anything it does not recognise.
  //
  // Several entries here are namespaces where a third party chooses the hostname
  // — `aliyuncs.com` and `bcebos.com`/`baidubcs.com` are tenant object storage,
  // `edu.cn` spans thousands of independent institutions, `oray.com`/
  // `sunlogin.com` relay arbitrary remote-access sessions. They remain in the
  // signed policy contract for compatibility, but the Windows client deliberately
  // emits only the reviewed Bilibili family as address-free suffix routes; other
  // suffixes stay tunnelled there. Platform clients must keep their own runtime
  // suffix allowlist narrower than this control-plane acceptance list.
  const allowedDirectSuffixes = [
    'bilibili.com', 'biliapi.net', 'bilivideo.com', 'hdslb.com',
    'qq.com', 'gtimg.cn', 'gtimg.com', 'iqiyi.com', 'qiyi.com',
    'qiyipic.com', 'iqiyipic.com', 'youku.com', 'ykimg.com',
    'xiaohongshu.com', 'xhslink.com', 'xhscdn.com', 'feishu.cn',
    'feishucdn.com', 'larksuite.com', 'larkoffice.com', 'feishu.net',
    'feishuapp.cn', 'feishuapp.com', 'feishudoc.cn', 'feishudoc.com',
    'feishumeetings.cn', 'feishumeetings.com', 'feishuimg.com',
    'feishukacdn.com', 'larkofficecdn.com', 'larkofficeimg.com',
    'larkcloud.com', 'larkcloud.net', 'getfeishu.cn', 'getfeishu.com',
    'feishupkg.com', 'feishuvc.cn', 'feishuvc.com', 'securityfeishu.cn',
    'securityfs.cn', 'statusfeishu.cn', 'dingtalk.cn', 'dingtalk.com',
    'dingtalk.net', 'dingtalkapps.com', 'dingtalkcloud.com', 'dingding.xin',
    'ztna-dingtalk.com', 'ddurl.to', 'baidu.com',
    'baidupcs.com', 'bcebos.com', 'baidubcs.com', 'bdstatic.com',
    'bdimg.com', 'aliyuncs.com', '10jqka.com.cn', 'iwencai.com',
    'eastmoney.com', 'dfcfw.com', 'sina.com.cn', 'sinajs.cn',
    'legulegu.com', 'optbbs.com', '100ppi.com', 'awtmt.com', 'cls.cn',
    'cninfo.com.cn', 'ccxe.com.cn', 'pushplus.plus', 'baostock.com',
    'sse.com.cn', 'szse.cn', 'zoom.us', 'zoom.com', 'zoomgov.com', 'oray.com',
    'sunlogin.com', 'edu.cn', '163.com', 'netease.com', '126.net',
  ];
  const protectedSuffixes = ['anthropic.com', 'claude.ai', 'tono.app', 'tono.com'];
  const seenHosts = new Set<string>();
  const canonicalDomains = (
    values: unknown[],
    allowedSuffixes: string[],
    allowedExactHosts: string[],
    web: boolean,
  ) => values.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !exactKeys(entry as Row, ['host', 'ports'])) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid domain entry');
    }
    const { host, ports } = entry as Row;
    if (typeof host !== 'string' || host.length > 253 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host) ||
        protectedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)) ||
        seenHosts.has(host)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate domain host');
    }
    // Reviewed by list, or vouched for by a signature. Evaluated after the type
    // and syntax checks above so a non-string host is a 400 rather than a
    // TypeError from `endsWith` surfacing as a 500.
    if (!trusted && !allowedExactHosts.includes(host) &&
        !allowedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate domain host');
    }
    seenHosts.add(host);
    const canonical = canonicalPorts(ports, web ? [443] : [80, 443], 'domain ports');
    if (web && (canonical.length !== 1 || canonical[0] !== 443)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Web direct domains require TCP port 443');
    }
    return { host, ports: canonical };
  }).sort((a, b) => a.host < b.host ? -1 : a.host > b.host ? 1 : 0);
  const domains = canonicalDomains(
    policy.domains,
    allowedNativeDirectSuffixes,
    [],
    false,
  );
  const seenAddresses = new Set<string>();
  const mediaEndpoints = policy.mediaEndpoints.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !exactKeys(entry as Row, ['address', 'ports'])) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid media endpoint');
    }
    const { address, ports } = entry as Row;
    if (typeof address !== 'string' || !isPublicIPv4(address) || seenAddresses.has(address)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate media address');
    }
    seenAddresses.add(address);
    return { address, ports: canonicalPorts(ports, [443, 8000], 'media ports') };
  }).sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
  if (isVersion1) return { version: 1, domains, mediaEndpoints };
  const webDomains = canonicalDomains(
    policy.webDomains as unknown[],
    allowedWebSuffixes,
    allowedWebExactHosts,
    true,
  );
  if (isVersion2) return { version: 2, domains, mediaEndpoints, webDomains };
  // Duplicates must be rejected here, not just deduplicated: the client treats a
  // repeated suffix as a malformed policy and discards the whole revision, so a
  // duplicate accepted at this boundary silently disables managed direct routing
  // on every device until someone republishes.
  const seenSuffixes = new Set<string>();
  const directSuffixes = (policy.directSuffixes as unknown[]).map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !exactKeys(entry as Row, ['host', 'ports'])) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid direct suffix');
    }
    const { host, ports } = entry as Row;
    // The syntax check is explicit rather than implied by list membership. While
    // every accepted suffix had to appear in `allowedDirectSuffixes`, that list
    // *was* the syntax guarantee; a signature relaxing membership would otherwise
    // leave this field with no validation at all and hand clients a suffix they
    // have to parse.
    //
    // A signature vouches for authorship, not for judgement. A wildcard suffix
    // over a namespace where a third party picks the hostname still lets anyone
    // who can host there obtain a real IP outside the tunnel — see the note above
    // `allowedDirectSuffixes`. Signing moves that review from this code to
    // whoever holds the key; it does not remove it.
    if (typeof host !== 'string' || host.length > 253 ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host) ||
        protectedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)) ||
        seenSuffixes.has(host)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate direct suffix host');
    }
    if (!trusted && !allowedDirectSuffixes.includes(host)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate direct suffix host');
    }
    seenSuffixes.add(host);
    return { host, ports: canonicalPorts(ports, [80, 443], 'direct suffix ports') };
  }).sort((a, b) => a.host < b.host ? -1 : a.host > b.host ? 1 : 0);
  if (isVersion3) return { version: 3, domains, mediaEndpoints, webDomains, directSuffixes };

  const seenTCPAddresses = new Set<string>();
  const tcpEndpoints = (policy.tcpEndpoints as unknown[]).map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !exactKeys(entry as Row, ['address', 'ports'])) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid TCP endpoint');
    }
    const { address, ports } = entry as Row;
    if (typeof address !== 'string' || !isPublicIPv4(address) ||
        seenTCPAddresses.has(address)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate TCP address');
    }
    seenTCPAddresses.add(address);
    return { address, ports: canonicalPorts(ports, [80, 443], 'TCP endpoint ports') };
  }).sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
  return {
    version: 4,
    domains,
    mediaEndpoints,
    webDomains,
    directSuffixes,
    tcpEndpoints,
  };
}

async function publicTrafficPolicy(e: Env) {
  const row = await e.DB.prepare(
    'SELECT revision, ciphertext, nonce, content_sha256, updated_at, signature FROM managed_traffic_policy WHERE singleton_id = 1',
  ).first<Row>();
  if (!row) {
    const json = JSON.stringify(emptyTrafficPolicy());
    return { revision: 0, json, sha256: await sha256(json), updatedAt: undefined };
  }
  try {
    const json = await decryptTrafficPolicy(String(row.ciphertext), String(row.nonce), requiredCatalogKey(e));
    const digest = await sha256(json);
    if (digest !== row.content_sha256) throw new Error('digest mismatch');
    const signature = typeof row.signature === 'string' && row.signature.length
      ? row.signature
      : undefined;
    // A stored signature is what permits trusted canonicalisation here. That
    // sounds circular and is not: the client verifies the signature itself
    // against a compiled-in key and is the only party whose trust decision
    // matters, because it is the only one that routes traffic. This function
    // re-validates to catch a malformed or drifted document, and structural
    // validation is all that requires.
    //
    // So verification on this path is defence in depth, and runs only when the
    // public key is configured. Making it mandatory would mean an unset or
    // mistyped var turns every policy fetch into a 503 for the whole fleet, and
    // trades a real outage for a check the client already performs. When the key
    // *is* present a bad signature means the stored row was altered underneath
    // us, which is worth refusing to serve.
    const publicKey = e.TRAFFIC_POLICY_PUBLIC_KEY;
    if (signature && publicKey) {
      if (!await verifyTrafficPolicySignature(json, signature, publicKey)) {
        throw new Error('policy signature does not verify');
      }
    }
    // Re-validating on read catches tampering and digest drift, but for an
    // unsigned policy it also couples every fetch to the current allowlists: an
    // allowlist entry removed while the stored policy still uses it makes this
    // throw for every device. See the note on `allowedDirectSuffixes` before
    // narrowing anything.
    canonicalTrafficPolicy(JSON.parse(json), Boolean(signature));
    return {
      revision: Number(row.revision),
      json,
      sha256: digest,
      updatedAt: Number(row.updated_at),
      ...(signature ? { signature } : {}),
    };
  } catch {
    throw new ApiError(503, 'TRAFFIC_POLICY_UNAVAILABLE', 'Managed traffic policy is unavailable');
  }
}

async function auth(req: Request, e: Env) {
  const p = await jwtVerify(bearer(req), requiredSecret(e.JWT_SECRET));
  if (
    typeof p?.sub !== 'string' ||
    p.sub.length === 0 ||
    typeof p.sid !== 'string' ||
    p.sid.length === 0
  ) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired access token');
  }
  const t = now();
  const s = await e.DB.prepare(
    `SELECT sessions.*, users.status user_status, users.quota_bytes, users.usage_bytes, users.expires_at user_expires_at,
            devices.status device_status, devices.pending_expires_at, devices.installation_id
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     JOIN devices ON devices.id = sessions.device_id
     WHERE sessions.id = ? AND sessions.user_id = ? AND sessions.revoked_at IS NULL AND sessions.expires_at > ?`,
  ).bind(p.sid, p.sub, t).first<Row>();
  if (
    !s ||
    s.user_status !== 'active' ||
    !['active', 'pending'].includes(s.device_status) ||
    (s.device_status === 'pending' && s.pending_expires_at <= t) ||
    (s.user_expires_at !== null && s.user_expires_at <= t) ||
    (s.quota_bytes !== null && s.usage_bytes >= s.quota_bytes)
  ) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Session is no longer active');
  }
  return {
    userId: String(s.user_id),
    sessionId: String(s.id),
    deviceId: String(s.device_id),
    installationId: String(s.installation_id),
  };
}

async function userId(req: Request, e: Env) {
  return (await auth(req, e)).userId;
}

async function privileged(req: Request, expected: string) {
  const actualHash = await sha256(bearer(req));
  const expectedHash = await sha256(requiredSecret(expected));
  let difference = actualHash.length ^ expectedHash.length;
  for (let index = 0; index < Math.max(actualHash.length, expectedHash.length); index++) {
    difference |= (actualHash.charCodeAt(index) || 0) ^ (expectedHash.charCodeAt(index) || 0);
  }
  if (difference !== 0) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid token');
  }
}

/**
 * Resources served identically to both administrative front doors.
 *
 * The operations console authenticates with Cloudflare Access and the scripted
 * surface with a bearer token, but home exits, their bindings and the signup
 * allowlist are the same resource either way — and each was implemented twice,
 * byte for byte, about 260 lines of it. That is not a tidiness problem: a fix to
 * one copy leaves the other wrong. The two had already begun to diverge — the
 * allowlist listing coerced `email` on one path and not the other, harmless in
 * itself because D1 returns a string for a TEXT column either way, but it is
 * divergence appearing in code nobody had touched deliberately.
 * `directSuffixes` shipping with no syntax validation at all came from this
 * same shape, and that one was not harmless.
 *
 * Returns null when the resource is not one of the shared ones, so each caller
 * still reaches the handlers that genuinely are its own — `/ops/dashboard`,
 * `/admin/traffic-policy`, and the two `users` listings, which return
 * deliberately different shapes and are not merged.
 *
 * Authentication is the caller's responsibility and must already have happened:
 * this performs no authorization of its own.
 */
async function sharedAdministrativeResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail?: string,
): Promise<Response | null> {
  let mt: RegExpMatchArray | null;
  if (resource === 'home-exits' && m === 'GET') {
    const q = await e.DB.prepare(
      `SELECT home_exits.*,
              (SELECT COUNT(*) FROM user_home_bindings WHERE home_exit_id = home_exits.id) AS bind_count
       FROM home_exits
       ORDER BY status ASC, display_name ASC, created_at ASC`,
    ).all<Row>();
    const exits = q.results.map(publicHomeExit);
    try {
      // The lifetime ratio hides a line that died last week behind months of
      // green history, so a seven-day window travels alongside it — counted in
      // the same pass rather than a second scan.
      const weekAgo = now() - 7 * 86_400;
      const stats = await e.DB.prepare(
        `SELECT home_exit_id,
                SUM(CASE WHEN status = 'alive' THEN 1 ELSE 0 END) AS alive,
                COUNT(*) AS total,
                SUM(CASE WHEN probed_at >= ? AND status = 'alive' THEN 1 ELSE 0 END) AS alive_7d,
                SUM(CASE WHEN probed_at >= ? THEN 1 ELSE 0 END) AS total_7d
         FROM operations_home_probe_samples
         GROUP BY home_exit_id`,
      ).bind(weekAgo, weekAgo).all<Row>();
      const byId = new Map(stats.results.map((row) => [String(row.home_exit_id), row]));
      return Response.json({
        homeExits: exits.map((exit) => {
          const row = byId.get(exit.id);
          if (!row) return exit;
          const alive = Number(row.alive);
          const total = Number(row.total);
          const alive7d = Number(row.alive_7d);
          const total7d = Number(row.total_7d);
          return {
            ...exit,
            probeAlive: alive,
            probeTotal: total,
            probeUptimeRatio: total > 0 ? alive / total : undefined,
            probeAlive7d: alive7d,
            probeTotal7d: total7d,
            probeUptimeRatio7d: total7d > 0 ? alive7d / total7d : undefined,
          };
        }),
      });
    } catch (error) {
      if (!String(error).includes('no such table')) throw error;
      return Response.json({ homeExits: exits });
    }
  }
  if (resource === 'home-exits' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    const proxyName = proxyNameField(b.proxyName);
    const displayName = str(b.displayName, 'displayName', 1, 200).trim();
    const egressIpv4 = optionalIpv4(b.egressIpv4, 'egressIpv4');
    const kind = b.kind === undefined ? 'catalog' : str(b.kind, 'kind', 1, 20);
    if (!['catalog', 'socks5'].includes(kind)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid kind');
    }
    const socks5Host = b.socks5Host === undefined || b.socks5Host === null || b.socks5Host === ''
      ? null
      : socks5HostField(b.socks5Host);
    const socks5Port = b.socks5Port === undefined || b.socks5Port === null
      ? null
      : socks5PortField(b.socks5Port);
    const socks5Username = b.socks5Username === undefined || b.socks5Username === null || b.socks5Username === ''
      ? null
      : str(b.socks5Username, 'socks5Username', 1, 255);
    const socks5Password = b.socks5Password === undefined || b.socks5Password === null || b.socks5Password === ''
      ? null
      : str(b.socks5Password, 'socks5Password', 1, 255);
    validateHomeSocks5(kind, socks5Host, socks5Port, socks5Username, socks5Password);
    const notes = b.notes === undefined || b.notes === null || b.notes === ''
      ? null
      : str(b.notes, 'notes', 1, 1000);
    const status = b.status === undefined ? 'active' : str(b.status, 'status', 1, 20);
    if (!['active', 'disabled', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    const homeId = id();
    const t = now();
    try {
      await e.DB.prepare(
        `INSERT INTO home_exits(
           id, proxy_name, display_name, egress_ipv4, kind,
           socks5_host, socks5_port, socks5_username, socks5_password,
           status, notes, created_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        homeId, proxyName, displayName, egressIpv4, kind,
        socks5Host, socks5Port, socks5Username, socks5Password,
        status, notes, t, t,
      ).run();
    } catch {
      throw new ApiError(409, 'HOME_EXIT_CONFLICT', 'A home exit with this proxyName already exists');
    }
    const row = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(homeId).first<Row>();
    await bumpCatalogRevision(e);
    await writeOpsAudit(e, actorEmail, 'home.create', 'home_exit', homeId, displayName);
    return Response.json({ homeExit: publicHomeExit(row!) }, { status: 201 });
  }
  if (resource === 'home-exits/assign' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['userId', 'line', 'displayName', 'defaultProxyName', 'replace']);
    const userId = str(b.userId, 'userId', 1, 100);
    const parsed = parseHomeLine(b.line);
    if (b.replace !== undefined && typeof b.replace !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid replace');
    }
    const replace = b.replace === true;
    const user = await e.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(userId).first<Row>();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    const current = await loadHomeBinding(e, userId);
    if (current && !replace) {
      throw new ApiError(409, 'HOME_ALREADY_BOUND', 'User already has a home exit; pass replace=true to swap it');
    }
    const defaultProxyName = b.defaultProxyName === undefined && current
      ? (current.default_proxy_name == null || current.default_proxy_name === ''
        ? null
        : String(current.default_proxy_name))
      : await defaultProxyNameField(e, b.defaultProxyName);
    const emailLocal = String(user.email).split('@')[0] || 'user';
    const displayName = b.displayName === undefined || b.displayName === null || b.displayName === ''
      ? `家宽 · ${emailLocal}`
      : str(b.displayName, 'displayName', 1, 200).trim();

    let home = await findSocks5Home(e, parsed.host, parsed.port, parsed.username);
    let createdHome = false;
    if (home) {
      const owner = await e.DB.prepare(
        'SELECT user_id FROM user_home_bindings WHERE home_exit_id = ?',
      ).bind(home.id).first<Row>();
      if (owner && String(owner.user_id) !== userId) {
        throw new ApiError(409, 'HOME_EXIT_IN_USE', 'This home line is already assigned to another user');
      }
      if (String(home.status) !== 'active') {
        await e.DB.prepare(
          'UPDATE home_exits SET status = ?, display_name = ?, notes = ?, updated_at = ? WHERE id = ?',
        ).bind('active', displayName, parsed.notes ?? home.notes, now(), home.id).run();
        home = (await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(home.id).first<Row>())!;
      }
    } else {
      home = await insertSocks5HomeExit(e, parsed, displayName);
      createdHome = true;
    }

    const previousHomeId = current ? String(current.home_exit_id) : null;
    const bound = await upsertHomeBinding(e, userId, String(home.id), defaultProxyName);
    let retiredHomeExitId: string | undefined;
    if (previousHomeId && previousHomeId !== String(home.id)) {
      const stillUsed = await e.DB.prepare(
        'SELECT 1 FROM user_home_bindings WHERE home_exit_id = ? LIMIT 1',
      ).bind(previousHomeId).first<Row>();
      if (!stillUsed) {
        await e.DB.prepare(
          "UPDATE home_exits SET status = 'retired', updated_at = ? WHERE id = ?",
        ).bind(now(), previousHomeId).run();
        retiredHomeExitId = previousHomeId;
      }
    }
    await bumpCatalogRevision(e);
    const binding = await loadHomeBinding(e, userId);
    const refreshQueued = await enqueueRefreshCatalogForUser(e, userId);
    const swapped = Boolean(previousHomeId && previousHomeId !== String(home.id));
    await writeOpsAudit(
      e, actorEmail, swapped ? 'home.replace' : 'home.assign', 'user', userId,
      swapped ? `replaced home for ${user.email}` : `assigned home for ${user.email}`,
    );
    return Response.json({
      homeExit: publicHomeExit(home),
      binding: publicHomeBinding(binding!),
      created: createdHome,
      replaced: swapped,
      retiredHomeExitId,
      refreshQueued,
    }, { status: createdHome || bound.created ? 201 : 200 });
  }
  if (resource === 'home-exits/import' && m === 'POST') {
    const b = await body(req, 32 * 1024);
    rejectUnexpectedKeys(b, ['lines']);
    if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 50) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'lines must be an array of 1–50 strings');
    }
    const created: ReturnType<typeof publicHomeExit>[] = [];
    const skipped: Array<{ host?: string; port?: number; username?: string; message: string }> = [];
    const failed: Array<{ message: string }> = [];
    for (const raw of b.lines) {
      try {
        const parsed = parseHomeLine(raw);
        const existing = await findSocks5Home(e, parsed.host, parsed.port, parsed.username);
        if (existing) {
          skipped.push({
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
            message: 'already exists',
          });
          continue;
        }
        const displayName = parsed.notes && parsed.notes.length <= 200
          ? parsed.notes
          : `家宽 · ${parsed.host}`;
        const row = await insertSocks5HomeExit(e, parsed, displayName);
        created.push(publicHomeExit(row));
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'Invalid home line';
        failed.push({ message });
      }
    }
    if (created.length > 0) {
      await bumpCatalogRevision(e);
      await writeOpsAudit(
        e, actorEmail, 'home.import', 'home_exit', null,
        `imported ${created.length} (skipped ${skipped.length}, failed ${failed.length})`,
      );
    }
    return Response.json({ created, skipped, failed }, { status: created.length > 0 ? 201 : 200 });
  }
  mt = resource.match(/^home-exits\/([^/]+)\/probes$/);
  if (mt && m === 'GET') {
    const existing = await e.DB.prepare('SELECT id FROM home_exits WHERE id = ?').bind(mt[1]).first<Row>();
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    const range = new URL(req.url).searchParams.get('range');
    if (range !== null && !['24h', '7d', '90d'].includes(range)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported probes range');
    }
    return Response.json({ probes: await queryHomeProbeHistory(e.DB, mt[1], now(), range) });
  }
  mt = resource.match(/^home-exits\/([^/]+)$/);
  if (mt && m === 'PATCH') {
    const b = await body(req, 8 * 1024);
    const existing = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(mt[1]).first<Row>();
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    const proxyName = b.proxyName === undefined ? String(existing.proxy_name) : proxyNameField(b.proxyName);
    const displayName = b.displayName === undefined
      ? String(existing.display_name)
      : str(b.displayName, 'displayName', 1, 200).trim();
    const egressIpv4 = b.egressIpv4 === undefined
      ? (existing.egress_ipv4 == null ? null : String(existing.egress_ipv4))
      : optionalIpv4(b.egressIpv4, 'egressIpv4');
    const notes = b.notes === undefined
      ? (existing.notes == null ? null : String(existing.notes))
      : (b.notes === null || b.notes === '' ? null : str(b.notes, 'notes', 1, 1000));
    const status = b.status === undefined ? String(existing.status) : str(b.status, 'status', 1, 20);
    if (!['active', 'disabled', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    const kind = b.kind === undefined ? String(existing.kind ?? 'catalog') : str(b.kind, 'kind', 1, 20);
    if (!['catalog', 'socks5'].includes(kind)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid kind');
    }
    // Omitted socks5 fields keep their stored values; switching back to
    // catalog wipes them.
    const keep = kind === 'socks5';
    const socks5Host = b.socks5Host === undefined
      ? (keep && existing.socks5_host != null ? String(existing.socks5_host) : null)
      : (b.socks5Host === null || b.socks5Host === '' ? null : socks5HostField(b.socks5Host));
    const socks5Port = b.socks5Port === undefined
      ? (keep && existing.socks5_port != null ? Number(existing.socks5_port) : null)
      : (b.socks5Port === null ? null : socks5PortField(b.socks5Port));
    const socks5Username = b.socks5Username === undefined
      ? (keep && existing.socks5_username != null ? String(existing.socks5_username) : null)
      : (b.socks5Username === null || b.socks5Username === '' ? null : str(b.socks5Username, 'socks5Username', 1, 255));
    const socks5Password = b.socks5Password === undefined
      ? (keep && existing.socks5_password != null ? String(existing.socks5_password) : null)
      : (b.socks5Password === null || b.socks5Password === '' ? null : str(b.socks5Password, 'socks5Password', 1, 255));
    validateHomeSocks5(kind, socks5Host, socks5Port, socks5Username, socks5Password);
    const t = now();
    try {
      const updated = await e.DB.prepare(
        `UPDATE home_exits
         SET proxy_name = ?, display_name = ?, egress_ipv4 = ?, kind = ?,
             socks5_host = ?, socks5_port = ?, socks5_username = ?, socks5_password = ?,
             status = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(
        proxyName, displayName, egressIpv4, kind,
        socks5Host, socks5Port, socks5Username, socks5Password,
        status, notes, t, mt[1],
      ).run();
      if (!updated.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(409, 'HOME_EXIT_CONFLICT', 'A home exit with this proxyName already exists');
    }
    const row = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(mt[1]).first<Row>();
    await bumpCatalogRevision(e);
    return Response.json({ homeExit: publicHomeExit(row!) });
  }
  if (mt && m === 'DELETE') {
    const bound = await e.DB.prepare(
      'SELECT 1 FROM user_home_bindings WHERE home_exit_id = ? LIMIT 1',
    ).bind(mt[1]).first<Row>();
    if (bound) {
      throw new ApiError(409, 'HOME_EXIT_IN_USE', 'Unbind all users before deleting this home exit');
    }
    const deleted = await e.DB.prepare('DELETE FROM home_exits WHERE id = ?').bind(mt[1]).run();
    if (!deleted.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    await bumpCatalogRevision(e);
    return new Response(null, { status: 204 });
  }
  if (resource === 'home-bindings' && m === 'GET') {
    const q = await e.DB.prepare(
      `SELECT
         user_home_bindings.user_id,
         users.email,
         user_home_bindings.home_exit_id,
         user_home_bindings.default_proxy_name,
         home_exits.proxy_name,
         home_exits.display_name,
         home_exits.kind,
         home_exits.socks5_host,
         home_exits.socks5_port,
         home_exits.egress_ipv4,
         home_exits.status AS home_status,
         user_home_bindings.created_at,
         user_home_bindings.updated_at
       FROM user_home_bindings
       JOIN users ON users.id = user_home_bindings.user_id
       JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
       ORDER BY users.email ASC`,
    ).all<Row>();
    return Response.json({ bindings: q.results.map(publicHomeBinding) });
  }
  mt = resource.match(/^users\/([^/]+)\/home-binding$/);
  if (mt && m === 'GET') {
    const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(mt[1]).first<Row>();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    const row = await e.DB.prepare(
      `SELECT
         user_home_bindings.user_id,
         users.email,
         user_home_bindings.home_exit_id,
         user_home_bindings.default_proxy_name,
         home_exits.proxy_name,
         home_exits.display_name,
         home_exits.kind,
         home_exits.socks5_host,
         home_exits.socks5_port,
         home_exits.egress_ipv4,
         home_exits.status AS home_status,
         user_home_bindings.created_at,
         user_home_bindings.updated_at
       FROM user_home_bindings
       JOIN users ON users.id = user_home_bindings.user_id
       JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
       WHERE user_home_bindings.user_id = ?`,
    ).bind(mt[1]).first<Row>();
    return Response.json({ binding: row ? publicHomeBinding(row) : null });
  }
  if (mt && m === 'PUT') {
    const b = await body(req, 8 * 1024);
    const user = await e.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(mt[1]).first<Row>();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    let homeExitId: string | undefined;
    if (b.homeExitId !== undefined) {
      homeExitId = str(b.homeExitId, 'homeExitId', 1, 100);
    } else if (b.proxyName !== undefined) {
      const byName = await e.DB.prepare(
        'SELECT id FROM home_exits WHERE proxy_name = ?',
      ).bind(proxyNameField(b.proxyName)).first<Row>();
      if (!byName) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
      homeExitId = String(byName.id);
    } else {
      throw new ApiError(400, 'VALIDATION_ERROR', 'homeExitId or proxyName is required');
    }
    const home = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(homeExitId).first<Row>();
    if (!home) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    if (String(home.status) !== 'active') {
      throw new ApiError(409, 'HOME_EXIT_INACTIVE', 'Home exit must be active before binding');
    }
    const defaultProxyName = await defaultProxyNameField(e, b.defaultProxyName);
    const t = now();
    const existing = await e.DB.prepare(
      'SELECT created_at FROM user_home_bindings WHERE user_id = ?',
    ).bind(mt[1]).first<Row>();
    if (existing) {
      await e.DB.prepare(
        `UPDATE user_home_bindings
         SET home_exit_id = ?, default_proxy_name = ?, updated_at = ?
         WHERE user_id = ?`,
      ).bind(homeExitId, defaultProxyName, t, mt[1]).run();
    } else {
      await e.DB.prepare(
        `INSERT INTO user_home_bindings(user_id, home_exit_id, default_proxy_name, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?)`,
      ).bind(mt[1], homeExitId, defaultProxyName, t, t).run();
    }
    const row = await e.DB.prepare(
      `SELECT
         user_home_bindings.user_id,
         users.email,
         user_home_bindings.home_exit_id,
         user_home_bindings.default_proxy_name,
         home_exits.proxy_name,
         home_exits.display_name,
         home_exits.kind,
         home_exits.socks5_host,
         home_exits.socks5_port,
         home_exits.egress_ipv4,
         home_exits.status AS home_status,
         user_home_bindings.created_at,
         user_home_bindings.updated_at
       FROM user_home_bindings
       JOIN users ON users.id = user_home_bindings.user_id
       JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
       WHERE user_home_bindings.user_id = ?`,
    ).bind(mt[1]).first<Row>();
    await bumpCatalogRevision(e);
    await writeOpsAudit(
      e, actorEmail, existing ? 'home.replace' : 'home.assign', 'user', mt[1],
      existing ? `replaced home for ${user.email}` : `assigned home for ${user.email}`,
    );
    return Response.json({ binding: publicHomeBinding(row!) }, { status: existing ? 200 : 201 });
  }
  if (mt && m === 'DELETE') {
    const deleted = await e.DB.prepare(
      'DELETE FROM user_home_bindings WHERE user_id = ?',
    ).bind(mt[1]).run();
    if (!deleted.meta.changes) {
      const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(mt[1]).first<Row>();
      if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    } else {
      await bumpCatalogRevision(e);
      await writeOpsAudit(e, actorEmail, 'home.unbind', 'user', mt[1], 'removed home binding');
    }
    return new Response(null, { status: 204 });
  }
  mt = resource.match(/^users\/([^/]+)\/close$/);
  if (mt && m === 'POST') {
    if (req.headers.get('content-length') && Number(req.headers.get('content-length')) > 0) {
      const b = await body(req, 4 * 1024);
      rejectUnexpectedKeys(b, ['reason']);
    }
    const user = await e.DB.prepare('SELECT * FROM users WHERE id = ?').bind(mt[1]).first<Row>();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    const t = now();
    const unbound = await e.DB.prepare(
      'DELETE FROM user_home_bindings WHERE user_id = ?',
    ).bind(mt[1]).run();
    if (unbound.meta.changes) await bumpCatalogRevision(e);
    const assigned = await assignedProductForUser(e, mt[1]);
    if (assigned) {
      await e.DB.prepare(
        `UPDATE product_accounts
         SET status = 'retired', closed_at = ?, close_reason = 'other', updated_at = ?
         WHERE id = ? AND status = 'assigned'`,
      ).bind(t, t, assigned.id).run();
      await recordProductEvent(e, String(assigned.id), mt[1], 'note', 'refund close');
    }
    await e.DB.prepare('DELETE FROM signup_allowlist WHERE email = ?').bind(user.email).run();
    await e.DB.prepare(
      `UPDATE users
       SET status = 'disabled',
           notes = CASE WHEN notes IS NULL OR notes = '' THEN '退款销户' ELSE notes END,
           updated_at = ?
       WHERE id = ?`,
    ).bind(t, mt[1]).run();
    await enforceUser(e, mt[1]);
    await writeOpsAudit(e, actorEmail, 'user.close', 'user', mt[1], `closed ${user.email}`);
    return Response.json({ ok: true, email: String(user.email), status: 'disabled' });
  }
  if (resource === 'signup-allowlist' && m === 'POST') {
    const b = await body(req, 4 * 1024);
    const address = email(b.email);
    const createdAt = now();
    const inserted = await e.DB.prepare(
      'INSERT OR IGNORE INTO signup_allowlist(email, created_at) VALUES(?, ?)',
    ).bind(address, createdAt).run();
    const entry = await e.DB.prepare(
      'SELECT created_at FROM signup_allowlist WHERE email = ?',
    ).bind(address).first<Row>();
    if (inserted.meta.changes === 1) {
      await writeOpsAudit(e, actorEmail, 'allowlist.add', 'signup_allowlist', address, address);
    }
    return Response.json(
      {
        email: address,
        createdAt: Number(entry?.created_at ?? createdAt),
        created: inserted.meta.changes === 1,
      },
      { status: inserted.meta.changes === 1 ? 201 : 200 },
    );
  }
  if (resource === 'exit-catalog' && m === 'GET') {
    return Response.json(await publicManagedCatalog(e));
  }
  if (resource === 'exit-catalog' && m === 'PUT') {
    const b = await body(req, 2 * 1024 * 1024);
    rejectUnexpectedKeys(b, ['yaml', 'expectedRevision']);
    const yaml = managedCatalogYAML(b.yaml);
    const expectedRevision = b.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'expectedRevision is required and must be a non-negative integer');
    }
    const current = await e.DB.prepare(
      'SELECT revision FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<Row>();
    const currentRevision = Number(current?.revision ?? 0);
    if (expectedRevision !== currentRevision) {
      throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; reload before replacing it');
    }
    const revision = currentRevision + 1;
    const encrypted = await encryptCatalog(yaml, requiredCatalogKey(e));
    const digest = await sha256(yaml);
    const t = now();
    const changed = current
      ? await e.DB.prepare(
        `UPDATE managed_exit_catalog
         SET revision = ?, ciphertext = ?, nonce = ?, content_sha256 = ?, updated_at = ?
         WHERE singleton_id = 1 AND revision = ?`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t, currentRevision).run()
      : await e.DB.prepare(
        `INSERT OR IGNORE INTO managed_exit_catalog(
           singleton_id, revision, ciphertext, nonce, content_sha256, updated_at
         ) VALUES(1, ?, ?, ?, ?, ?)`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t).run();
    if (!changed.meta.changes) {
      throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; reload before replacing it');
    }
    await writeOpsAudit(
      e,
      actorEmail,
      'catalog.publish',
      'managed_exit_catalog',
      String(revision),
      `published r${currentRevision} → r${revision} (${digest.slice(0, 16)})`,
    );
    return Response.json({ revision, sha256: digest, updatedAt: t });
  }
  if (resource === 'traffic-policy' && m === 'GET') {
    return Response.json(await publicTrafficPolicy(e));
  }
  if (resource === 'traffic-policy' && m === 'PUT') {
    const b = await body(req, 64 * 1024);
    rejectUnexpectedKeys(b, ['policy', 'expectedRevision', 'signature', 'dryRun']);
    if (b.signature !== undefined && (typeof b.signature !== 'string' || !b.signature.length || b.signature.length > 128)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid signature');
    }
    if (b.dryRun !== undefined && typeof b.dryRun !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid dryRun');
    }
    const signature = b.signature as string | undefined;
    const dryRun = b.dryRun === true;
    const policy = canonicalTrafficPolicy(b.policy, dryRun || Boolean(signature));
    const json = JSON.stringify(policy);
    if (signature) {
      const publicKey = e.TRAFFIC_POLICY_PUBLIC_KEY;
      if (!publicKey) {
        throw new ApiError(409, 'TRAFFIC_POLICY_KEY_UNCONFIGURED', 'This deployment has no policy signing public key, so a signed policy cannot be accepted');
      }
      if (!await verifyTrafficPolicySignature(json, signature, publicKey)) {
        throw new ApiError(400, 'TRAFFIC_POLICY_SIGNATURE_INVALID', 'The signature does not cover the canonical policy this would serve');
      }
    }
    if (dryRun) {
      let signatureRequired = false;
      try {
        canonicalTrafficPolicy(b.policy, false);
      } catch {
        signatureRequired = true;
      }
      return Response.json({
        dryRun: true,
        json,
        sha256: await sha256(json),
        signatureRequired,
        signatureContext: TRAFFIC_POLICY_SIGNATURE_CONTEXT,
      });
    }
    const expectedRevision = b.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'expectedRevision is required and must be a non-negative integer');
    }
    const current = await e.DB.prepare(
      'SELECT revision FROM managed_traffic_policy WHERE singleton_id = 1',
    ).first<Row>();
    const currentRevision = Number(current?.revision ?? 0);
    if (expectedRevision !== currentRevision) {
      throw new ApiError(409, 'TRAFFIC_POLICY_CONFLICT', 'Managed traffic policy changed; reload before replacing it');
    }
    const revision = currentRevision + 1;
    const encrypted = await encryptTrafficPolicy(json, requiredCatalogKey(e));
    const digest = await sha256(json);
    const t = now();
    const storedSignature = signature ?? null;
    const changed = current
      ? await e.DB.prepare(
        `UPDATE managed_traffic_policy
         SET revision = ?, ciphertext = ?, nonce = ?, content_sha256 = ?, updated_at = ?, signature = ?
         WHERE singleton_id = 1 AND revision = ?`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t, storedSignature, currentRevision).run()
      : await e.DB.prepare(
        `INSERT OR IGNORE INTO managed_traffic_policy(
           singleton_id, revision, ciphertext, nonce, content_sha256, updated_at, signature
         ) VALUES(1, ?, ?, ?, ?, ?, ?)`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t, storedSignature).run();
    if (!changed.meta.changes) {
      throw new ApiError(409, 'TRAFFIC_POLICY_CONFLICT', 'Managed traffic policy changed; reload before replacing it');
    }
    await writeOpsAudit(
      e,
      actorEmail,
      'traffic-policy.publish',
      'managed_traffic_policy',
      String(revision),
      `published r${currentRevision} → r${revision} (${digest.slice(0, 16)})`,
    );
    return Response.json({
      revision, json, sha256: digest, updatedAt: t,
      ...(signature ? { signature } : {}),
    });
  }
  if (resource === 'device-actions' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['deviceId', 'action', 'ttlSeconds']);
    const deviceId = str(b.deviceId, 'deviceId', 1, 200);
    const action = fixedAction(b.action);
    const ttl = b.ttlSeconds ?? 300;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 3600) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid ttlSeconds');
    const device = await e.DB.prepare("SELECT * FROM devices WHERE id = ? AND status != 'revoked'").bind(deviceId).first<Row>();
    if (!device) throw new ApiError(404, 'NOT_FOUND', 'Active device not found');
    const t = now();
    const commandId = id();
    await e.DB.prepare(
      'INSERT INTO device_actions(id,user_id,device_id,action,status,created_at,expires_at) VALUES(?,?,?,?,\'pending\',?,?)',
    ).bind(commandId, device.user_id, device.id, action, t, t + ttl).run();
    const row = await e.DB.prepare('SELECT * FROM device_actions WHERE id = ?').bind(commandId).first<Row>();
    await writeOpsAudit(e, actorEmail, 'device.action', 'device', deviceId, `queued ${action}`);
    return Response.json({ action: publicAction(row!) }, { status: 201 });
  }
  if (resource === 'device-actions' && m === 'GET') {
    const t = now();
    await e.DB.prepare("UPDATE device_actions SET status = 'expired' WHERE status IN ('pending','delivered') AND expires_at <= ?").bind(t).run();
    const deviceId = new URL(req.url).searchParams.get('deviceId');
    if (deviceId !== null && (deviceId.length < 1 || deviceId.length > 200)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid deviceId');
    const q = deviceId
      ? await e.DB.prepare('SELECT * FROM device_actions WHERE device_id = ? ORDER BY created_at DESC LIMIT 100').bind(deviceId).all<Row>()
      : await e.DB.prepare('SELECT * FROM device_actions ORDER BY created_at DESC LIMIT 100').all<Row>();
    return Response.json({ actions: q.results.map(publicAction) });
  }
  if (resource === 'devices' && m === 'GET') {
    const q = await e.DB.prepare(
      'SELECT devices.*, users.email FROM devices JOIN users ON users.id = devices.user_id ORDER BY devices.created_at DESC',
    ).all<Row>();
    return Response.json({
      devices: q.results.map((x) => ({ ...publicDevice(x), userId: x.user_id, email: x.email })),
    });
  }
  mt = resource.match(/^devices\/([^/]+)$/);
  if (mt && m === 'DELETE') {
    const d = await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(mt[1]).first<Row>();
    if (!d) throw new ApiError(404, 'NOT_FOUND', 'Device not found');
    await revokeDevice(e, d);
    await processRevocations(e);
    await writeOpsAudit(e, actorEmail, 'device.revoke', 'device', mt[1], `revoked device of user ${String(d.user_id)}`);
    return new Response(null, { status: 204 });
  }

  if (resource === 'product-accounts' && m === 'GET') {
    const status = new URL(req.url).searchParams.get('status');
    if (status !== null && !['pooled', 'assigned', 'banned', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    const q = status
      ? await e.DB.prepare(
        `SELECT product_accounts.*, users.email
         FROM product_accounts
         LEFT JOIN users ON users.id = product_accounts.user_id
         WHERE product_accounts.status = ?
         ORDER BY product_accounts.updated_at DESC`,
      ).bind(status).all<Row>()
      : await e.DB.prepare(
        `SELECT product_accounts.*, users.email
         FROM product_accounts
         LEFT JOIN users ON users.id = product_accounts.user_id
         ORDER BY product_accounts.updated_at DESC
         LIMIT 500`,
      ).all<Row>();
    return Response.json({ accounts: q.results.map(publicProductAccount) });
  }
  if (resource === 'product-accounts' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['accountRef', 'userId', 'openedAt', 'notes']);
    const accountRef = accountRefField(b.accountRef);
    const notes = optionalNotes(b.notes);
    const openedAt = optionalUnix(b.openedAt, 'openedAt') ?? now();
    if (b.userId !== undefined && b.userId !== null && b.userId !== '') {
      const userId = str(b.userId, 'userId', 1, 100);
      const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first<Row>();
      if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
      const row = await createAssignedProductAccount(e, userId, accountRef, openedAt, notes, actorEmail);
      return Response.json({ account: publicProductAccount(row) }, { status: 201 });
    }
    const existing = await e.DB.prepare(
      'SELECT id FROM product_accounts WHERE account_ref = ?',
    ).bind(accountRef).first<Row>();
    if (existing) throw new ApiError(409, 'ACCOUNT_REF_IN_USE', 'This Claude account is already registered');
    const accountId = id();
    const t = now();
    await e.DB.prepare(
      `INSERT INTO product_accounts(
         id, user_id, product, account_ref, status, opened_at, closed_at, close_reason, notes, created_at, updated_at
       ) VALUES(?, NULL, ?, ?, 'pooled', NULL, NULL, NULL, ?, ?, ?)`,
    ).bind(accountId, PRODUCT_CLAUDE, accountRef, notes, t, t).run();
    await recordProductEvent(e, accountId, null, 'opened', 'pooled');
    await writeOpsAudit(e, actorEmail, 'product.pool', 'product_account', accountId, `pooled ${accountRef}`);
    const row = await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>();
    return Response.json({ account: publicProductAccount(row!) }, { status: 201 });
  }
  mt = resource.match(/^product-accounts\/([^/]+)\/ban$/);
  if (mt && m === 'POST') {
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['detail']);
    const row = await banProductAccount(e, mt[1], optionalNotes(b.detail, 'detail', 1000), actorEmail);
    return Response.json({ account: publicProductAccount(row) });
  }
  mt = resource.match(/^product-accounts\/([^/]+)\/replace$/);
  if (mt && m === 'POST') {
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['accountRef', 'notes']);
    const result = await replaceProductAccount(
      e, mt[1], accountRefField(b.accountRef), optionalNotes(b.notes), actorEmail,
    );
    return Response.json({
      previous: publicProductAccount(result.previous),
      account: publicProductAccount(result.current),
    });
  }
  mt = resource.match(/^product-accounts\/([^/]+)$/);
  if (mt && m === 'GET') {
    const row = await e.DB.prepare(
      `SELECT product_accounts.*, users.email
       FROM product_accounts
       LEFT JOIN users ON users.id = product_accounts.user_id
       WHERE product_accounts.id = ?`,
    ).bind(mt[1]).first<Row>();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Product account not found');
    const events = await e.DB.prepare(
      'SELECT * FROM product_account_events WHERE account_id = ? ORDER BY at DESC LIMIT 50',
    ).bind(mt[1]).all<Row>();
    return Response.json({ account: publicProductAccount(row), events: events.results.map(publicProductEvent) });
  }

  if (resource === 'node-profiles' && m === 'GET') {
    const q = await e.DB.prepare(
      'SELECT * FROM ops_node_profiles ORDER BY status ASC, catalog_name ASC',
    ).all<Row>();
    return Response.json({ profiles: q.results.map(publicNodeProfile) });
  }
  if (resource === 'node-profiles' && m === 'POST') {
    const b = await body(req, 16 * 1024);
    rejectUnexpectedKeys(b, [
      'catalogName', 'publicIp', 'provider', 'billingUrl',
      'price', 'currency', 'billingCycle',
      'trafficQuotaBytes', 'trafficUsedBytes', 'trafficCycleStart', 'trafficCycleEnd',
      'cycleNetIn', 'cycleNetOut', 'renewsAt', 'notes', 'status',
    ]);
    const catalogName = str(b.catalogName, 'catalogName', 1, 200).trim();
    const publicIp = b.publicIp === undefined || b.publicIp === null || b.publicIp === ''
      ? null
      : optionalIpv4(b.publicIp, 'publicIp');
    const provider = optionalNotes(b.provider, 'provider', 80);
    const billingUrl = httpsUrlField(b.billingUrl, 'billingUrl');
    const profileId = id();
    const t = now();
    const status = b.status === undefined ? 'active' : str(b.status, 'status', 1, 20);
    if (!['active', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    try {
      await e.DB.prepare(
        `INSERT INTO ops_node_profiles(
           id, catalog_name, public_ip, provider, billing_url,
           price, currency, billing_cycle,
           traffic_quota_bytes, traffic_used_bytes, traffic_cycle_start, traffic_cycle_end,
           cycle_net_in, cycle_net_out, renews_at, notes, status, created_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        profileId, catalogName, publicIp, provider, billingUrl,
        optionalMoney(b.price, 'price'), optionalCurrency(b.currency), optionalBillingCycle(b.billingCycle),
        optionalByteCount(b.trafficQuotaBytes, 'trafficQuotaBytes'),
        optionalByteCount(b.trafficUsedBytes, 'trafficUsedBytes'),
        optionalUnix(b.trafficCycleStart, 'trafficCycleStart'),
        optionalUnix(b.trafficCycleEnd, 'trafficCycleEnd'),
        optionalByteCount(b.cycleNetIn, 'cycleNetIn'),
        optionalByteCount(b.cycleNetOut, 'cycleNetOut'),
        optionalUnix(b.renewsAt, 'renewsAt'),
        optionalNotes(b.notes),
        status, t, t,
      ).run();
    } catch {
      throw new ApiError(409, 'NODE_PROFILE_EXISTS', 'A profile with this catalog name already exists');
    }
    await writeOpsAudit(e, actorEmail, 'node.create', 'node_profile', profileId, catalogName);
    const row = await e.DB.prepare('SELECT * FROM ops_node_profiles WHERE id = ?').bind(profileId).first<Row>();
    return Response.json({ profile: publicNodeProfile(row!) }, { status: 201 });
  }
  mt = resource.match(/^node-profiles\/([^/]+)$/);
  if (mt && m === 'PUT') {
    const b = await body(req, 16 * 1024);
    rejectUnexpectedKeys(b, [
      'catalogName', 'publicIp', 'provider', 'billingUrl',
      'price', 'currency', 'billingCycle',
      'trafficQuotaBytes', 'trafficUsedBytes', 'trafficCycleStart', 'trafficCycleEnd',
      'cycleNetIn', 'cycleNetOut', 'renewsAt', 'notes', 'status',
    ]);
    const existing = await e.DB.prepare('SELECT * FROM ops_node_profiles WHERE id = ?').bind(mt[1]).first<Row>();
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Node profile not found');
    const catalogName = b.catalogName === undefined
      ? String(existing.catalog_name)
      : str(b.catalogName, 'catalogName', 1, 200).trim();
    const status = b.status === undefined ? String(existing.status) : str(b.status, 'status', 1, 20);
    if (!['active', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    try {
      await e.DB.prepare(
        `UPDATE ops_node_profiles SET
           catalog_name = ?, public_ip = ?, provider = ?, billing_url = ?,
           price = ?, currency = ?, billing_cycle = ?,
           traffic_quota_bytes = ?, traffic_used_bytes = ?,
           traffic_cycle_start = ?, traffic_cycle_end = ?,
           cycle_net_in = ?, cycle_net_out = ?, renews_at = ?,
           notes = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(
        catalogName,
        b.publicIp === undefined
          ? (existing.public_ip == null ? null : String(existing.public_ip))
          : (b.publicIp === null || b.publicIp === '' ? null : optionalIpv4(b.publicIp, 'publicIp')),
        b.provider === undefined
          ? (existing.provider == null ? null : String(existing.provider))
          : optionalNotes(b.provider, 'provider', 80),
        b.billingUrl === undefined
          ? (existing.billing_url == null ? null : String(existing.billing_url))
          : httpsUrlField(b.billingUrl, 'billingUrl'),
        b.price === undefined
          ? (existing.price == null ? null : Number(existing.price))
          : optionalMoney(b.price, 'price'),
        b.currency === undefined
          ? (existing.currency == null ? null : String(existing.currency))
          : optionalCurrency(b.currency),
        b.billingCycle === undefined
          ? (existing.billing_cycle == null ? null : Number(existing.billing_cycle))
          : optionalBillingCycle(b.billingCycle),
        b.trafficQuotaBytes === undefined
          ? (existing.traffic_quota_bytes == null ? null : Number(existing.traffic_quota_bytes))
          : optionalByteCount(b.trafficQuotaBytes, 'trafficQuotaBytes'),
        b.trafficUsedBytes === undefined
          ? (existing.traffic_used_bytes == null ? null : Number(existing.traffic_used_bytes))
          : optionalByteCount(b.trafficUsedBytes, 'trafficUsedBytes'),
        b.trafficCycleStart === undefined
          ? (existing.traffic_cycle_start == null ? null : Number(existing.traffic_cycle_start))
          : optionalUnix(b.trafficCycleStart, 'trafficCycleStart'),
        b.trafficCycleEnd === undefined
          ? (existing.traffic_cycle_end == null ? null : Number(existing.traffic_cycle_end))
          : optionalUnix(b.trafficCycleEnd, 'trafficCycleEnd'),
        b.cycleNetIn === undefined
          ? (existing.cycle_net_in == null ? null : Number(existing.cycle_net_in))
          : optionalByteCount(b.cycleNetIn, 'cycleNetIn'),
        b.cycleNetOut === undefined
          ? (existing.cycle_net_out == null ? null : Number(existing.cycle_net_out))
          : optionalByteCount(b.cycleNetOut, 'cycleNetOut'),
        b.renewsAt === undefined
          ? (existing.renews_at == null ? null : Number(existing.renews_at))
          : optionalUnix(b.renewsAt, 'renewsAt'),
        b.notes === undefined
          ? (existing.notes == null ? null : String(existing.notes))
          : optionalNotes(b.notes),
        status,
        now(),
        mt[1],
      ).run();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(409, 'NODE_PROFILE_EXISTS', 'A profile with this catalog name already exists');
    }
    await writeOpsAudit(e, actorEmail, 'node.update', 'node_profile', mt[1], catalogName);
    const row = await e.DB.prepare('SELECT * FROM ops_node_profiles WHERE id = ?').bind(mt[1]).first<Row>();
    return Response.json({ profile: publicNodeProfile(row!) });
  }

  if (resource === 'audit' && m === 'GET') {
    // Plain newest-100 without params, exactly as before; the filters exist so
    // an operator can follow one target or actor back past the first page
    // instead of the log stopping at whatever happened most recently.
    const params = new URL(req.url).searchParams;
    const rawLimit = params.get('limit');
    let limit = 100;
    if (rawLimit !== null) {
      limit = Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid limit');
      }
    }
    const rawBefore = params.get('before');
    let before: number | null = null;
    if (rawBefore !== null) {
      before = Number(rawBefore);
      if (!Number.isSafeInteger(before) || before <= 0) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid before');
      }
    }
    const targetId = params.get('targetId');
    const actorEmail = params.get('actorEmail');
    const q = await e.DB.prepare(
      `SELECT * FROM ops_audit
       WHERE (? = 0 OR at < ?)
         AND (? = 0 OR target_id = ?)
         AND (? = 0 OR actor_email = ?)
       ORDER BY at DESC LIMIT ?`,
    ).bind(
      before === null ? 0 : 1, before ?? 0,
      targetId === null ? 0 : 1, targetId ?? '',
      actorEmail === null ? 0 : 1, actorEmail ?? '',
      limit + 1,
    ).all<Row>();
    const hasMore = q.results.length > limit;
    const rows = hasMore ? q.results.slice(0, limit) : q.results;
    return Response.json({
      entries: rows.map((row) => ({
        id: String(row.id),
        at: Number(row.at),
        actorEmail: String(row.actor_email),
        action: String(row.action),
        targetType: String(row.target_type),
        targetId: row.target_id == null ? null : String(row.target_id),
        summary: String(row.summary),
      })),
      hasMore,
      nextBefore: hasMore && rows.length ? Number(rows[rows.length - 1].at) : null,
    });
  }

  return null;
}

async function operationsAdmin(req: Request, e: Env) {
  try {
    return await verifyAccessRequest(req, {
      teamDomain: e.ACCESS_TEAM_DOMAIN,
      audience: e.ACCESS_AUD,
      adminEmails: e.ACCESS_ADMIN_EMAILS,
    });
  } catch (verificationError) {
    if (verificationError instanceof AccessVerificationError) {
      if (verificationError.failure === 'misconfigured') {
        throw new ApiError(503, 'ACCESS_MISCONFIGURED', 'Operations access is not configured');
      }
      if (verificationError.failure === 'unavailable') {
        throw new ApiError(503, 'ACCESS_UNAVAILABLE', 'Operations access verification is unavailable');
      }
      if (verificationError.failure === 'forbidden') {
        throw new ApiError(403, 'ACCESS_FORBIDDEN', 'Administrator access is required');
      }
    }
    throw new ApiError(401, 'ACCESS_UNAUTHORIZED', 'Cloudflare Access authentication is required');
  }
}

function buildSha(e: Env): string {
  const value = e.BUILD_SHA?.trim() ?? '';
  return /^[0-9a-f]{40}$/.test(value) ? value : 'development';
}

const optionalText = (value: unknown) => value === null || value === undefined ? null : String(value);
const optionalNumber = (value: unknown) => value === null || value === undefined ? null : Number(value);

async function managedCatalogTemplate(e: Env) {
  const row = await e.DB.prepare(
    'SELECT revision, ciphertext, nonce, content_sha256, updated_at FROM managed_exit_catalog WHERE singleton_id = 1',
  ).first<Row>();
  if (!row) {
    const yaml = 'proxies: []\n';
    return { revision: 0, yaml, sha256: await sha256(yaml), updatedAt: null };
  }
  let yaml: string;
  try {
    yaml = await decryptCatalog(String(row.ciphertext), String(row.nonce), requiredCatalogKey(e));
  } catch {
    throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog is unavailable');
  }
  const digest = await sha256(yaml);
  if (digest !== String(row.content_sha256)) {
    throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Managed server catalog failed integrity validation');
  }
  return {
    revision: Number(row.revision),
    yaml,
    sha256: digest,
    updatedAt: Number(row.updated_at),
  };
}

function fleetQualityStatus(node: Row | undefined): { status: string; label: string } {
  if (!node) return { status: 'UNKNOWN', label: '未测' };
  const block = node.block && typeof node.block === 'object' && !Array.isArray(node.block)
    ? node.block as Row
    : null;
  const reported = typeof block?.status === 'string' ? block.status : null;
  if (reported === 'LIKELY_BLOCKED') return { status: reported, label: '疑似被墙' };
  if (node.ok !== true) return { status: 'DOWN', label: '整机失联' };
  if (reported) return { status: reported, label: optionalText(block?.label) ?? reported };
  return { status: 'OK', label: '大陆正常' };
}

async function operationsFleetNodes(e: Env, cache?: OpsRequestCache) {
  const [catalogResult, live, activity, profilesResult] = await Promise.all([
    managedCatalogTemplate(e).then(
      (catalog) => ({ state: 'ready' as const, catalog }),
      (error) => ({
        state: 'error' as const,
        message: error instanceof Error ? error.message : 'Managed catalog is unavailable',
      }),
    ),
    operationsLive(e, cache),
    operationsActivity(e, cache),
    e.DB.prepare('SELECT * FROM ops_node_profiles ORDER BY catalog_name').all<Row>(),
  ]);
  let catalogNames: Set<string> | null = null;
  let catalogRevision: number | null = null;
  let catalogSource: Row;
  if (catalogResult.state === 'ready') {
    try {
      catalogNames = new Set(splitManagedCatalogProxies(catalogResult.catalog.yaml).items.map((item) => item.name));
      catalogRevision = catalogResult.catalog.revision;
      catalogSource = { state: 'ready', revision: catalogRevision };
    } catch (error) {
      catalogSource = {
        state: 'error',
        message: error instanceof Error ? error.message : 'Managed catalog is unavailable',
      };
    }
  } else {
    catalogSource = { state: 'error', message: catalogResult.message };
  }
  const profiles = new Map(profilesResult.results.map((row) => [String(row.catalog_name), row]));
  const agents = new Map((live.agents ?? []).map((row) => [String(row.name), row]));
  const quality = new Map((live.quality?.nodes ?? []).map((row) => [String(row.name), row]));
  const names = new Set<string>([
    ...(catalogNames ?? []),
    ...profiles.keys(),
    ...agents.keys(),
    ...quality.keys(),
  ]);
  const nowSec = now();
  const nodes = [...names].sort((a, b) => a.localeCompare(b, 'zh')).map((name) => {
    const profileRow = profiles.get(name);
    const agent = agents.get(name) ?? null;
    const qualityNode = quality.get(name) ?? null;
    const observedAt = agent && typeof agent.observedAt === 'number' ? agent.observedAt : null;
    const agentStatus = observedAt === null ? 'missing' : nowSec - observedAt > 15 * 60 ? 'stale' : 'online';
    const q = fleetQualityStatus(qualityNode ?? undefined);
    const affectedRows = activity.users.filter((user) => user.selectedServer === name);
    const affectedByUser = new Map<string, Row>();
    for (const user of affectedRows) {
      const current = affectedByUser.get(String(user.userId));
      if (!current || Number(user.lastSeenAt) > Number(current.lastSeenAt)) {
        affectedByUser.set(String(user.userId), user);
      }
    }
    const affectedUsers = [...affectedByUser.values()];
    const reasons: string[] = [];
    const listed = catalogNames?.has(name) ?? null;
    if (listed === true && q.status === 'DOWN') reasons.push('catalog_health_down');
    if (listed === true && q.status === 'LIKELY_BLOCKED') reasons.push('catalog_likely_blocked');
    if (listed === true && agentStatus === 'missing') reasons.push('agent_missing');
    if (listed === true && agentStatus === 'stale') reasons.push('agent_stale');
    if (listed === true && profileRow?.status === 'retired') reasons.push('profile_retired_but_listed');
    if (catalogNames === null) reasons.push('catalog_unavailable');
    return {
      name,
      catalogListed: listed,
      qualityStatus: q.status,
      qualityLabel: q.label,
      agentStatus,
      agentObservedAt: observedAt,
      profile: profileRow ? publicNodeProfile(profileRow) : null,
      agent,
      quality: qualityNode,
      occupancy: new Set(affectedRows.filter((user) => user.online).map((user) => String(user.userId))).size,
      affectedUsers,
      needsAttention: reasons.length > 0,
      reasons,
    };
  });
  return {
    nodes,
    catalogRevision,
    sources: {
      catalog: catalogSource,
      quality: { state: live.quality ? 'ready' : 'error', message: live.qualityError },
      agents: { state: live.agents ? 'ready' : 'error', message: live.agentsError },
      profiles: { state: 'ready' },
    },
  };
}

type RetireChanges = {
  catalogEntryRemoved: boolean;
  proxyGroupReferencesRemoved: string[];
  profileMarkedRetired: boolean;
};

function placeholderCount(yaml: string): number {
  return yaml.split(CLIENT_UUID_PLACEHOLDER).length - 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function catalogGroupName(line: string): string | null {
  const match = line.match(
    /^\s*(?:-\s+)?name:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s#"'][^#]*?))\s*(?:#.*)?$/,
  );
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3] ?? '').trim() || null;
}

function emptyProxyGroupNames(yaml: string): string[] {
  const empty: string[] = [];
  let inGroups = false;
  let group: string | null = null;
  let awaitingMembers = false;
  let members = 0;
  const finish = () => {
    if (awaitingMembers && members === 0 && group) empty.push(group);
    awaitingMembers = false;
    members = 0;
  };
  for (const line of yaml.split('\n')) {
    if (/^proxy-groups\s*:/.test(line)) {
      finish();
      inGroups = true;
      continue;
    }
    if (inGroups && line.trim() && !/^\s/.test(line) && !line.trimStart().startsWith('#')) {
      finish();
      inGroups = false;
    }
    if (!inGroups) continue;
    const named = catalogGroupName(line);
    if (named && /^\s*-\s+/.test(line)) {
      finish();
      group = named;
      continue;
    }
    if (/^\s+proxies\s*:/.test(line)) {
      awaitingMembers = true;
      members = 0;
      continue;
    }
    if (awaitingMembers) {
      if (line.trim() === '' || /^\s*#/.test(line)) continue;
      if (/^\s+-\s+/.test(line)) {
        members += 1;
        continue;
      }
      finish();
    }
  }
  finish();
  return empty;
}

/**
 * Remove one catalog proxy by rewriting text, never by YAML parse/dump.
 * `{{TONO_CLIENT_UUID}}` is legal YAML flow-mapping syntax; round-tripping
 * would rewrite every remaining identity into a nested map and brick the fleet.
 */
export function retirementCatalogPlan(yaml: string, name: string): {
  yaml: string;
  changes: RetireChanges;
  warnings: string[];
  safe: boolean;
} {
  const warnings: string[] = [];
  const placeholdersBefore = placeholderCount(yaml);
  let prefix = '';
  let items: Array<{ name: string; block: string }> = [];
  let suffix = '';
  try {
    ({ prefix, items, suffix } = splitManagedCatalogProxies(yaml));
  } catch {
    return {
      yaml,
      changes: { catalogEntryRemoved: false, proxyGroupReferencesRemoved: [], profileMarkedRetired: false },
      warnings: ['目录没有可安全编辑的 proxies 列表。'],
      safe: false,
    };
  }
  const matches = items.filter((item) => item.name === name);
  if (matches.length > 1) {
    return {
      yaml,
      changes: { catalogEntryRemoved: false, proxyGroupReferencesRemoved: [], profileMarkedRetired: false },
      warnings: ['目录中存在多个同名节点，拒绝自动退役。'],
      safe: false,
    };
  }
  if (matches.length === 1 && items.length <= 1) {
    return {
      yaml,
      changes: { catalogEntryRemoved: true, proxyGroupReferencesRemoved: [], profileMarkedRetired: false },
      warnings: ['不能退役目录中的最后一个节点。'],
      safe: false,
    };
  }

  const placeholdersRemoved = matches.length === 1 ? placeholderCount(matches[0].block) : 0;
  let next = yaml;
  if (matches.length === 1) {
    const kept = items.filter((item) => item.name !== name);
    const body = kept.map((item) => item.block.replace(/\s+$/, '')).join('\n') + '\n';
    next = `${prefix}${body}${suffix}`;
    if (!next.endsWith('\n')) next += '\n';
  }

  const memberLine = new RegExp(`^([ \\t]+)-[ \\t]+${escapeRegExp(name)}[ \\t]*(?:#.*)?$`);
  const groupsChanged: string[] = [];
  let inGroups = false;
  let currentGroup: string | null = null;
  const keptLines: string[] = [];
  for (const line of next.split('\n')) {
    if (/^proxy-groups\s*:/.test(line)) {
      inGroups = true;
      keptLines.push(line);
      continue;
    }
    if (inGroups && line.trim() && !/^\s/.test(line) && !line.trimStart().startsWith('#')) {
      inGroups = false;
    }
    if (inGroups) {
      const named = catalogGroupName(line);
      if (named && /^\s*-\s+/.test(line)) currentGroup = named;
      if (memberLine.test(line)) {
        const groupName = currentGroup ?? '未命名';
        if (!groupsChanged.includes(groupName)) groupsChanged.push(groupName);
        continue;
      }
    }
    keptLines.push(line);
  }
  next = keptLines.join('\n');
  if (yaml.endsWith('\n') && !next.endsWith('\n')) next += '\n';

  const ruleTarget = new RegExp(`,\\s*${escapeRegExp(name)}\\s*(?:,\\s*no-resolve)?\\s*$`, 'i');
  let inRules = false;
  for (const line of next.split('\n')) {
    if (/^rules\s*:/.test(line)) {
      inRules = true;
      continue;
    }
    if (inRules && line.trim() && !/^\s/.test(line) && !line.trimStart().startsWith('#')) break;
    if (!inRules) continue;
    const value = line.trim().replace(/^-\s+/, '');
    if (ruleTarget.test(value)) {
      warnings.push('规则列表直接引用了该节点，需先改为代理组。');
      break;
    }
  }

  for (const groupName of emptyProxyGroupNames(next)) {
    warnings.push(`退役会清空代理组 ${groupName}。`);
  }

  const placeholdersAfter = placeholderCount(next);
  if (placeholdersAfter !== placeholdersBefore - placeholdersRemoved) {
    warnings.push('退役后目录占位符数量与预期不符，拒绝自动改写。');
  }
  if (next.includes('TONO_CLIENT_UUID') && !next.includes(CLIENT_UUID_PLACEHOLDER)) {
    warnings.push('退役改写破坏了客户端占位符。');
  }

  const blocked = warnings.some((warning) => (
    warning.startsWith('规则列表')
    || warning.includes('占位符')
    || warning.startsWith('退役会清空')
  ));
  const safe = matches.length === 1 && !blocked;
  if (safe) {
    try {
      next = managedCatalogYAML(next);
    } catch {
      warnings.push('改写后的目录未通过发布校验。');
      return {
        yaml,
        changes: { catalogEntryRemoved: true, proxyGroupReferencesRemoved: groupsChanged, profileMarkedRetired: false },
        warnings,
        safe: false,
      };
    }
  }

  return {
    yaml: safe ? next : yaml,
    changes: {
      catalogEntryRemoved: matches.length === 1,
      proxyGroupReferencesRemoved: groupsChanged,
      profileMarkedRetired: false,
    },
    warnings,
    safe,
  };
}

async function operationsRetirePreview(e: Env, name: string, cache?: OpsRequestCache) {
  const [fleet, catalog] = await Promise.all([operationsFleetNodes(e, cache), managedCatalogTemplate(e)]);
  const node = fleet.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new ApiError(404, 'NOT_FOUND', 'Fleet node not found');
  const catalogPlan = retirementCatalogPlan(catalog.yaml, name);
  const listedCount = splitManagedCatalogProxies(catalog.yaml).items.length;
  if (catalogPlan.changes.catalogEntryRemoved && listedCount <= 1) {
    catalogPlan.warnings.push('不能退役目录中的最后一个节点。');
    catalogPlan.safe = false;
  }
  const profileMarkedRetired = node.profile === null || node.profile.status !== 'retired';
  const changes = { ...catalogPlan.changes, profileMarkedRetired };
  return {
    node,
    expectedRevision: catalog.revision,
    currentRevision: catalog.revision,
    affectedUsers: node.affectedUsers,
    changes,
    warnings: catalogPlan.warnings,
    canRetire: catalogPlan.safe && changes.catalogEntryRemoved,
    nextYaml: catalogPlan.yaml,
  };
}

function fleetNodeName(raw: string): string {
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid node name');
  }
  if (!name || name.length > 200 || /[\r\n\0]/.test(name)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid node name');
  }
  return name;
}

async function retireFleetNode(e: Env, actorEmail: string, name: string, requestBody: Row, cache?: OpsRequestCache) {
  rejectUnexpectedKeys(requestBody, ['expectedRevision', 'confirmation', 'reason']);
  if (!Number.isSafeInteger(requestBody.expectedRevision) || requestBody.expectedRevision < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid expectedRevision');
  }
  if (requestBody.confirmation !== name) {
    throw new ApiError(400, 'RETIRE_CONFIRMATION_REQUIRED', 'Type the exact node name to confirm retirement');
  }
  const reason = str(requestBody.reason, 'reason', 1, 500).trim();
  if (!reason) throw new ApiError(400, 'VALIDATION_ERROR', 'Retirement reason is required');
  const preview = await operationsRetirePreview(e, name, cache);
  if (preview.currentRevision !== requestBody.expectedRevision) {
    throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; preview retirement again');
  }
  if (!preview.canRetire) {
    throw new ApiError(422, 'RETIRE_UNSAFE', preview.warnings[0] ?? 'Node cannot be retired safely');
  }
  const revision = preview.currentRevision + 1;
  const encrypted = await encryptCatalog(preview.nextYaml, requiredCatalogKey(e));
  const digest = await sha256(preview.nextYaml);
  const changedAt = now();
  const auditId = id();
  const profileId = id();
  const results = await e.DB.batch([
    e.DB.prepare(
      `UPDATE managed_exit_catalog
       SET revision = ?, ciphertext = ?, nonce = ?, content_sha256 = ?, updated_at = ?
       WHERE singleton_id = 1 AND revision = ?`,
    ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, changedAt, preview.currentRevision),
    e.DB.prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, status, created_at, updated_at)
       SELECT ?, ?, 'retired', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM managed_exit_catalog
         WHERE singleton_id = 1 AND revision = ? AND content_sha256 = ?
       )
       ON CONFLICT(catalog_name) DO UPDATE SET status = 'retired', updated_at = excluded.updated_at`,
    ).bind(profileId, name, changedAt, changedAt, revision, digest),
    e.DB.prepare(
      `INSERT INTO ops_audit(id, at, actor_email, action, target_type, target_id, summary)
       SELECT ?, ?, ?, 'node.retire', 'fleet_node', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM managed_exit_catalog
         WHERE singleton_id = 1 AND revision = ? AND content_sha256 = ?
       )`,
    ).bind(
      auditId,
      changedAt,
      actorEmail.slice(0, 254),
      name,
      `retired ${name}: ${reason}`.slice(0, 500),
      revision,
      digest,
    ),
  ]);
  if (!results[0].meta.changes) {
    throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; preview retirement again');
  }
  const refreshed = await operationsFleetNodes(e, cache);
  return {
    node: refreshed.nodes.find((candidate) => candidate.name === name) ?? { ...preview.node, catalogListed: false },
    previousRevision: preview.currentRevision,
    revision,
    sha256: digest,
    affectedUsers: preview.affectedUsers,
    changes: preview.changes,
    warnings: preview.warnings,
  };
}

async function operationsDashboard(e: Env, cache?: OpsRequestCache) {
  const week = now() + 7 * 86_400;
  const [users, devices, fleet, catalog, unusedHomes, unusedAccounts, bannedOpen, incomplete, renewing, usersWithoutHome] = await Promise.all([
    e.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) active FROM users").first<Row>(),
    e.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) active FROM devices").first<Row>(),
    operationsFleetNodes(e, cache),
    e.DB.prepare('SELECT revision, updated_at FROM managed_exit_catalog WHERE singleton_id = 1').first<Row>(),
    e.DB.prepare(
      `SELECT COUNT(*) total FROM home_exits
       WHERE status = 'active' AND kind = 'socks5'
         AND id NOT IN (SELECT home_exit_id FROM user_home_bindings)`,
    ).first<Row>(),
    e.DB.prepare("SELECT COUNT(*) total FROM product_accounts WHERE status = 'pooled'").first<Row>(),
    e.DB.prepare(
      `SELECT COUNT(DISTINCT product_accounts.user_id) total
       FROM product_accounts
       WHERE product_accounts.status = 'banned' AND product_accounts.user_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM product_accounts live
           WHERE live.user_id = product_accounts.user_id AND live.status = 'assigned'
         )`,
    ).first<Row>(),
    e.DB.prepare(
      `SELECT COUNT(*) total FROM users
       WHERE status = 'active'
         AND NOT EXISTS (SELECT 1 FROM product_accounts WHERE user_id = users.id AND status = 'assigned')`,
    ).first<Row>(),
    e.DB.prepare(
      `SELECT COUNT(*) total FROM ops_node_profiles
       WHERE status = 'active' AND renews_at IS NOT NULL AND renews_at <= ?`,
    ).bind(week).first<Row>(),
    e.DB.prepare(
      `SELECT COUNT(*) total FROM users
       WHERE status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM user_home_bindings
           JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
           WHERE user_home_bindings.user_id = users.id
             AND home_exits.status = 'active'
         )`,
    ).first<Row>(),
  ]);
  const counts = (row: Row | null) => ({ total: Number(row?.total ?? 0), active: Number(row?.active ?? 0) });
  const fleetCounts = {
    total: fleet.nodes.length,
    active: fleet.nodes.filter((node) => node.catalogListed === true).length,
  };
  return {
    users: counts(users),
    devices: counts(devices),
    // Compatibility keys now describe the authoritative fleet aggregate. The
    // phase-1 operations_* tables keep their rows but no longer have readers.
    servers: fleetCounts,
    logicalNodes: fleetCounts,
    deployments: { total: 0, active: 0 },
    catalog: catalog
      ? { revision: Number(catalog.revision), updatedAt: Number(catalog.updated_at) }
      : { revision: 0, updatedAt: null },
    inventory: {
      unusedHomes: Number(unusedHomes?.total ?? 0),
      unusedAccounts: Number(unusedAccounts?.total ?? 0),
      bannedUnreplaced: Number(bannedOpen?.total ?? 0),
      incompleteUsers: Number(incomplete?.total ?? 0),
      renewingSoon: Number(renewing?.total ?? 0),
      usersWithoutHome: Number(usersWithoutHome?.total ?? 0),
    },
  };
}

// Live node telemetry for the admin monitor. The collector on the ops VPS
// pushes a sanitized snapshot (`PUT /api/v1/ops-ingest/snapshot`); the stored
// row is the only source.
//
// It used to fall back to fetching ops.afk.ccwu.cc and quality.afk.ccwu.cc
// when no row existed. Those hostnames are now absorbed by `admin-worker.ts`,
// which answers them with a 302 to the admin console — so the fallback fetched
// this deployment's own SPA HTML, failed to parse it as JSON, and reported the
// parse error as `qualityError` after two 8s timeouts. A stale snapshot beats
// a request that cannot succeed; without one, /ops/live says so.
const OPS_LIVE_MAX_NODES = 64;
const OPS_LIVE_TEXT_LIMIT = 12_000;

function liveKeywordList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .slice(0, limit)
    .map((entry) => entry.slice(0, 40));
}

function liveProbeSummary(value: unknown): Row | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Row;
  const summary: Row = {};
  if (typeof raw.ok === 'boolean') summary.ok = raw.ok;
  for (const key of ['success', 'fail', 'total'] as const) {
    if (Number.isSafeInteger(raw[key]) && raw[key] >= 0) summary[key] = raw[key];
  }
  if (typeof raw.rate === 'number' && Number.isFinite(raw.rate)) summary.rate = raw.rate;
  if (typeof raw.status === 'string' && raw.status) summary.status = raw.status.slice(0, 40);
  if (typeof raw.source === 'string' && raw.source) summary.source = raw.source.slice(0, 80);
  if (typeof raw.note === 'string' && raw.note) summary.note = raw.note.slice(0, 240);
  if (raw.authoritative === true) summary.authoritative = true;
  return Object.keys(summary).length ? summary : null;
}

function liveBoundedText(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.length > OPS_LIVE_TEXT_LIMIT ? value.slice(0, OPS_LIVE_TEXT_LIMIT) : value;
}

// `includeText` keeps the multi-kilobyte securityCheck/backtrace bodies. The
// stored snapshot keeps them (they are the drawer's source of truth), but the
// list responses the console polls every fifteen seconds do not: at 64 nodes
// that is megabytes per minute for text only ever read one node at a time,
// through the fleet-nodes quality-text endpoint.
function liveQualityNode(raw: unknown, includeText = true): Row | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const node = raw as Row;
  const name = optionalText(node.name);
  if (!name) return null;
  const blockRaw = node.block && typeof node.block === 'object' && !Array.isArray(node.block)
    ? node.block as Row
    : null;
  return {
    name,
    host: optionalText(node.host),
    publicIp: optionalText(node.publicIp ?? node.public_ip),
    ok: node.ok === true,
    quality: optionalText(node.quality),
    riskKeywords: liveKeywordList(node.riskKeywords ?? node.risk_keywords),
    routeKeywords: liveKeywordList(node.routeKeywords ?? node.route_keywords),
    block: blockRaw
      ? {
          status: optionalText(blockRaw.status),
          label: optionalText(blockRaw.label),
          rule: liveBoundedText(blockRaw.rule),
          mainland: liveProbeSummary(blockRaw.mainland),
          asiaEdge: liveProbeSummary(blockRaw.asiaEdge ?? blockRaw.asia_edge),
          overseas: liveProbeSummary(blockRaw.overseas),
        }
      : null,
    riskSignals: liveRiskSignals(node.riskSignals ?? node.risk_signals),
    exposure: liveExposure(node.exposure),
    ...(includeText
      ? {
          securityCheck: liveBoundedText(node.securityCheck ?? node.security_check),
          backtrace: liveBoundedText(node.backtrace),
        }
      : {}),
  };
}

// How many of securityCheck's seventeen databases took each side.
//
// The collector used to report a tag whenever any single database said yes,
// which put the word "attacker" beside a node that two of three databases
// called clean. The tally is carried so the console can show what was actually
// found rather than a verdict nothing supports.
function liveRiskSignals(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  const signals: Row[] = [];
  for (const raw of value.slice(0, 12)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const signal = raw as Row;
    const tag = optionalText(signal.tag);
    if (!tag) continue;
    const yes = optionalNumber(signal.yes);
    const no = optionalNumber(signal.no);
    if (yes === null || yes < 0) continue;
    signals.push({ tag: tag.slice(0, 24), yes, no: no === null || no < 0 ? 0 : no });
  }
  return signals;
}

// What the node offers the internet. `null` when the collector predates this,
// which the console must show as unknown rather than as clean: a node nobody
// has looked at is exactly the state the leak lived in.
function liveExposure(value: unknown): Row | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Row;
  const listeners = (input: unknown, withReason: boolean): Row[] => {
    if (!Array.isArray(input)) return [];
    const rows: Row[] = [];
    for (const entry of input.slice(0, 32)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const listener = entry as Row;
      const port = optionalNumber(listener.port);
      if (port === null || port < 0 || port > 65535) continue;
      const row: Row = {
        port,
        address: optionalText(listener.address),
        process: optionalText(listener.process),
      };
      if (withReason) row.reason = liveBoundedText(listener.reason);
      rows.push(row);
    }
    return rows;
  };
  const sshPorts = Array.isArray(raw.sshPorts)
    ? raw.sshPorts
        .map((port) => optionalNumber(port))
        .filter((port): port is number => port !== null && port > 0 && port <= 65535)
        .slice(0, 8)
    : [];
  return {
    clean: raw.clean === true,
    sshPorts,
    unexpected: listeners(raw.unexpected, false),
    acknowledged: listeners(raw.acknowledged, true),
    expected: listeners(raw.expected, false),
  };
}

function liveObservedAt(value: unknown, receivedAt?: number): number | null {
  const observedAt = optionalNumber(value);
  if (observedAt === null || !Number.isFinite(observedAt)) return null;
  if (observedAt <= 0) return receivedAt ?? null;
  if (receivedAt !== undefined && observedAt > receivedAt + 5 * 60) {
    return receivedAt;
  }
  return observedAt;
}

function liveQualityReport(
  value: unknown,
  receivedAt?: number,
  includeText = true,
): { updatedAt: number | null; updatedAtIso: string | null; cnAgentsConfigured: number | null; nodes: Row[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Row;
  const sourceNodes = Array.isArray(raw.nodes) ? raw.nodes : null;
  if (!sourceNodes) return null;
  const nodes = sourceNodes.slice(0, OPS_LIVE_MAX_NODES)
    .map((node) => liveQualityNode(node, includeText))
    .filter((node): node is Row => node !== null);
  const updatedAt = liveObservedAt(raw.updatedAt ?? raw.updated_at, receivedAt);
  return {
    updatedAt,
    // Keep the two representations consistent when a broken collector clock is
    // pinned to receipt time. The console uses the integer for incident age, but
    // a contradictory ISO string is still misleading to API consumers.
    updatedAtIso: updatedAt === null
      ? optionalText(raw.updatedAtIso ?? raw.updated_at_iso)
      : new Date(updatedAt * 1_000).toISOString(),
    cnAgentsConfigured: optionalNumber(raw.cnAgentsConfigured ?? raw.cn_agents_configured),
    nodes,
  };
}

const CARRIER_KEYS = ['unicom', 'telecom', 'mobile'] as const;
const CARRIER_HISTORY_MAX = 48;

/**
 * Per-carrier mainland latency and loss for one node, as measured *from* it.
 *
 * A carrier that was never measured is absent from this object — never present
 * with zeros. Komari reports an unrun ping task as `avg: 0, loss: 0`, which is
 * field-for-field identical to a flawless result, so the collector drops those
 * before sending and anything that arrives here claiming a carrier is claiming
 * it was actually probed. The console renders a missing carrier as unknown.
 *
 * This is not the block verdict and cannot stand in for it. These probes leave
 * the node heading for China; whether China can open a connection back to the
 * node is the other direction, measured by the mainland agents. A node can be
 * perfect here and still be unreachable from inside the country.
 */
function liveCarriers(value: unknown): Row | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Row;
  const out: Row = {};
  for (const key of CARRIER_KEYS) {
    const raw = source[key];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const carrier = raw as Row;
    const samples = optionalNumber(carrier.samples);
    // No samples, no carrier. Anything else would put a number on screen for a
    // path nothing has travelled.
    if (samples === null || samples <= 0) continue;
    const history = Array.isArray(carrier.history)
      ? carrier.history.slice(0, CARRIER_HISTORY_MAX).map((point: unknown) => {
        if (!point || typeof point !== 'object' || Array.isArray(point)) {
          return { latencyMs: null, lossPct: null };
        }
        const entry = point as Row;
        return {
          latencyMs: optionalNumber(entry.latencyMs),
          lossPct: optionalNumber(entry.lossPct),
        };
      })
      : [];
    out[key] = {
      latencyMs: optionalNumber(carrier.latencyMs),
      lossPct: optionalNumber(carrier.lossPct),
      samples,
      targets: Array.isArray(carrier.targets)
        ? carrier.targets.slice(0, 12).map((name: unknown) => optionalText(name)).filter(Boolean)
        : [],
      history,
    };
  }
  return Object.keys(out).length ? out : null;
}

function liveAgents(value: unknown, receivedAt?: number): Row[] | null {
  if (value === null || value === undefined) return null;
  const rows = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && Array.isArray((value as Row).data) ? (value as Row).data : null);
  if (!rows) return null;
  return rows.slice(0, OPS_LIVE_MAX_NODES).map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const node = raw as Row;
    const name = optionalText(node.name);
    if (!name) return null;
    return {
      name,
      os: optionalText(node.os),
      arch: optionalText(node.arch),
      cpuName: optionalText(node.cpuName ?? node.cpu_name),
      cpu: optionalNumber(node.cpu ?? node.cpu_used ?? node.cpuUsed),
      memTotal: optionalNumber(node.memTotal ?? node.mem_total),
      memUsed: optionalNumber(node.memUsed ?? node.mem_used),
      diskTotal: optionalNumber(node.diskTotal ?? node.disk_total),
      diskUsed: optionalNumber(node.diskUsed ?? node.disk_used),
      netIn: optionalNumber(node.netIn ?? node.net_in ?? node.net_in_transfer),
      netOut: optionalNumber(node.netOut ?? node.net_out ?? node.net_out_transfer),
      uptime: optionalNumber(node.uptime),
      // The fields that answer "which box is in trouble" rather than "what is
      // this box". Load against core count is the one number that separates a
      // node that is busy from a node that is failing to keep up; swap in use
      // on a 1 GB VPS means it is already thrashing; and a stalled agent is
      // indistinguishable from a healthy idle one without `observedAt`, which
      // is how a dead collector reads as a quiet fleet.
      cpuCores: optionalNumber(node.cpuCores ?? node.cpu_cores),
      load1: optionalNumber(node.load1 ?? node.load_1),
      load5: optionalNumber(node.load5 ?? node.load_5),
      load15: optionalNumber(node.load15 ?? node.load_15),
      swapTotal: optionalNumber(node.swapTotal ?? node.swap_total),
      swapUsed: optionalNumber(node.swapUsed ?? node.swap_used),
      tcpConnections: optionalNumber(node.tcpConnections ?? node.tcp_connections),
      processes: optionalNumber(node.processes ?? node.process),
      observedAt: liveObservedAt(node.observedAt ?? node.observed_at, receivedAt),
      // Komari /api/nodes inventory. Manual nodeProfiles still win when filled;
      // these fill the holes so "which box renews / is about to blow quota"
      // is not a second spreadsheet.
      price: optionalNumber(node.price),
      currency: optionalText(node.currency)?.slice(0, 8) ?? null,
      billingCycle: optionalNumber(node.billingCycle ?? node.billing_cycle),
      expiredAt: optionalNumber(node.expiredAt ?? node.expired_at),
      trafficLimit: optionalNumber(node.trafficLimit ?? node.traffic_limit),
      trafficLimitType: optionalText(node.trafficLimitType ?? node.traffic_limit_type)?.slice(0, 16) ?? null,
      // How this node reaches 联通 / 电信 / 移动 — the half of "is this exit any
      // good" that reachability alone never answered.
      carriers: liveCarriers(node.carriers),
    };
  }).filter((node: Row | null): node is Row => node !== null);
}

async function storedLiveSnapshot(e: Env) {
  try {
    return await e.DB.prepare(
      'SELECT quality_json, agents_json, quality_updated_at, agents_updated_at FROM operations_live_snapshot WHERE singleton_id = 1',
    ).first<Row>();
  } catch (error) {
    // Migration 0022 may not have been applied yet; keep the legacy origin fetch.
    if (String(error).includes('no such table')) return null;
    throw error;
  }
}

async function storeLiveSnapshot(e: Env, input: { quality?: ReturnType<typeof liveQualityReport>; agents?: Row[] }) {
  const t = now();
  const current = await storedLiveSnapshot(e);
  const quality = input.quality === undefined
    ? (current?.quality_json ? JSON.parse(String(current.quality_json)) : null)
    : input.quality;
  const agents = input.agents === undefined
    ? (current?.agents_json ? JSON.parse(String(current.agents_json)) : null)
    : input.agents;
  const qualityUpdatedAt = input.quality === undefined
    ? optionalNumber(current?.quality_updated_at)
    : t;
  const agentsUpdatedAt = input.agents === undefined
    ? optionalNumber(current?.agents_updated_at)
    : t;
  await e.DB.prepare(
    `INSERT INTO operations_live_snapshot(
       singleton_id, quality_json, agents_json, quality_updated_at, agents_updated_at, updated_at
     ) VALUES(1, ?, ?, ?, ?, ?)
     ON CONFLICT(singleton_id) DO UPDATE SET
       quality_json = excluded.quality_json,
       agents_json = excluded.agents_json,
       quality_updated_at = excluded.quality_updated_at,
       agents_updated_at = excluded.agents_updated_at,
       updated_at = excluded.updated_at`,
  ).bind(
    quality ? JSON.stringify(quality) : null,
    agents ? JSON.stringify(agents) : null,
    qualityUpdatedAt,
    agentsUpdatedAt,
    t,
  ).run();
  return { qualityUpdatedAt, agentsUpdatedAt, updatedAt: t };
}

async function loadOperationsLive(e: Env) {
  const stored = await storedLiveSnapshot(e);
  const rawQualityReceivedAt = optionalNumber(stored?.quality_updated_at);
  const rawAgentsReceivedAt = optionalNumber(stored?.agents_updated_at);
  const qualityReceivedAt = rawQualityReceivedAt !== null &&
    Number.isFinite(rawQualityReceivedAt) && rawQualityReceivedAt > 0
    ? Math.floor(rawQualityReceivedAt)
    : null;
  const agentsReceivedAt = rawAgentsReceivedAt !== null &&
    Number.isFinite(rawAgentsReceivedAt) && rawAgentsReceivedAt > 0
    ? Math.floor(rawAgentsReceivedAt)
    : null;
  const quality = stored?.quality_json
    ? liveQualityReport(
      JSON.parse(String(stored.quality_json)),
      qualityReceivedAt ?? undefined,
      false,
    )
    : null;
  const agents = stored?.agents_json
    ? liveAgents(
      JSON.parse(String(stored.agents_json)),
      agentsReceivedAt ?? undefined,
    )
    : null;
  const qualityError = quality ? null : 'no quality snapshot';
  const agentsError = agents ? null : 'no agent snapshot';

  return {
    fetchedAt: now(),
    agents,
    agentsError,
    agentsReceivedAt,
    quality,
    qualityError,
    qualityReceivedAt,
  };
}

// One ops request often wants the same snapshot several times over — the
// dashboard builds the fleet, the fleet joins activity, activity joins the
// quality report — and each used to re-read and re-parse the stored JSON.
// A cache object created per request deduplicates the work; the promise is
// stored so concurrent callers share one read instead of racing.
type OpsRequestCache = {
  live?: ReturnType<typeof loadOperationsLive>;
  activity?: ReturnType<typeof loadOperationsActivity>;
};

function operationsLive(e: Env, cache?: OpsRequestCache) {
  if (!cache) return loadOperationsLive(e);
  return cache.live ??= loadOperationsLive(e);
}

/**
 * One node of the stored quality snapshot, without parsing the rest of it.
 *
 * `json_each` walks the snapshot inside SQLite and only the matching node's
 * JSON crosses into the Worker — this is how the per-user detail view and the
 * quality-text drawer avoid materializing a 64-node report to read one entry.
 */
async function liveQualityNodeNamed(e: Env, name: string | null): Promise<Row | null> {
  if (!name) return null;
  let row: Row | null;
  try {
    row = await e.DB.prepare(
      `SELECT entry.value AS node_json
       FROM operations_live_snapshot, json_each(operations_live_snapshot.quality_json, '$.nodes') AS entry
       WHERE singleton_id = 1 AND json_extract(entry.value, '$.name') = ?
       LIMIT 1`,
    ).bind(name).first<Row>();
  } catch (error) {
    if (String(error).includes('no such table')) return null;
    throw error;
  }
  if (!row?.node_json) return null;
  try {
    return liveQualityNode(JSON.parse(String(row.node_json)));
  } catch {
    return null;
  }
}

// Per-user liveness from periodic telemetry windows (≈20 min client cadence).
// A user is "online" when their latest window is fresher than two cadences.
const ACTIVITY_ONLINE_SECONDS = 40 * 60;
// How far back the activity ranking looks. This is a liveness view, not
// history: ranking all thirty retained days on every fifteen-second poll is
// what made the endpoint a full-table window scan. A day keeps "seen this
// morning" visible while letting the received_at index skip the rest.
const ACTIVITY_SCAN_SECONDS = 24 * 3600;

const NODE_HEALTH_LABELS: Record<string, string> = {
  ok: '大陆正常',
  blocked: '疑似被墙',
  down: '整机失联',
  unknown: '未测',
};

function optionalTelemetryInt(payload: Row, key: string, min: number, max: number): number | null {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
}

function telemetryPathFields(payload: Row, receivedAtSec: number) {
  const receivedAtMs = receivedAtSec * 1_000;
  // These timestamps come from the client clock. Keep the raw value in the
  // forensic payload, but never expose a measurement as happening after the
  // Worker received it: a laptop set to 2099 would otherwise keep one bad RTT
  // "fresh" for decades in the incident board.
  const sampleAt = (key: string) => {
    const value = optionalTelemetryInt(payload, key, 1, TELEMETRY_MAX_REPORTED_AT_MS);
    return value == null ? null : Math.min(value, receivedAtMs);
  };
  return {
    exitDelayMs: optionalTelemetryInt(payload, 'exitDelayMs', 1, 120_000),
    tcpDelayMs: optionalTelemetryInt(payload, 'tcpDelayMs', 1, 120_000),
    exitDelayAtMs: sampleAt('exitDelayAtMs'),
    tcpDelayAtMs: sampleAt('tcpDelayAtMs'),
  };
}

/**
 * Join a catalog name against the collector quality snapshot.
 *
 * `ok: false` is the machine, not GFW: overseas probes failing with the
 * mainland is how a dead VPS was labelled 疑似被墙. Blocked is only when the
 * box still answers elsewhere.
 */
function nodeHealthFromQuality(node: Row | null | undefined): { nodeHealth: string; nodeHealthLabel: string } {
  if (!node) {
    return { nodeHealth: 'unknown', nodeHealthLabel: NODE_HEALTH_LABELS.unknown };
  }
  const block = node.block && typeof node.block === 'object' && !Array.isArray(node.block)
    ? node.block as Row
    : null;
  const status = typeof block?.status === 'string' ? block.status : null;
  if (node.ok !== true) {
    return { nodeHealth: 'down', nodeHealthLabel: NODE_HEALTH_LABELS.down };
  }
  if (status === 'LIKELY_BLOCKED') {
    return { nodeHealth: 'blocked', nodeHealthLabel: NODE_HEALTH_LABELS.blocked };
  }
  if (status === 'OK' || node.ok === true) {
    return { nodeHealth: 'ok', nodeHealthLabel: NODE_HEALTH_LABELS.ok };
  }
  return { nodeHealth: 'unknown', nodeHealthLabel: NODE_HEALTH_LABELS.unknown };
}

function qualityNodeByName(quality: { nodes: Row[] } | null, name: string | null): Row | null {
  if (!quality || !name) return null;
  return quality.nodes.find((node) => node.name === name) ?? null;
}

async function loadOperationsActivity(e: Env, cache?: OpsRequestCache) {
  const live = await operationsLive(e, cache);
  const quality = live.quality;
  const nowSec = now();
  const rows = await e.DB.prepare(
    `WITH ranked AS (
       SELECT t.id, t.user_id, t.device_id, t.received_at, t.client_version, t.os_version,
              t.payload_json, u.email,
              ROW_NUMBER() OVER (
                PARTITION BY t.user_id, COALESCE(t.device_id, '')
                ORDER BY t.received_at DESC, t.id DESC
              ) AS rank
       FROM telemetry_windows t
       JOIN users u ON u.id = t.user_id
       WHERE t.received_at >= ?
     )
     SELECT id, user_id, device_id, received_at, client_version, os_version, payload_json, email
     FROM ranked
     WHERE rank = 1
     ORDER BY received_at DESC, id DESC`,
  ).bind(nowSec - ACTIVITY_SCAN_SECONDS).all<Row>();
  const users = rows.results.map((row) => {
    let payload: Row = {};
    try {
      payload = JSON.parse(String(row.payload_json));
    } catch {
      payload = {};
    }
    const lastSeenAt = Number(row.received_at);
    const selectedServer = typeof payload.selectedServer === 'string' ? payload.selectedServer : null;
    const health = nodeHealthFromQuality(qualityNodeByName(quality, selectedServer));
    return {
      userId: String(row.user_id),
      deviceId: row.device_id === null || row.device_id === undefined ? null : String(row.device_id),
      email: String(row.email),
      lastSeenAt,
      online: nowSec - lastSeenAt <= ACTIVITY_ONLINE_SECONDS,
      clientVersion: String(row.client_version),
      osVersion: String(row.os_version),
      selectedServer,
      uiState: typeof payload.uiState === 'string' ? payload.uiState : null,
      catalogRevision: typeof payload.catalogRevision === 'number' ? payload.catalogRevision : null,
      ...telemetryPathFields(payload, lastSeenAt),
      ...health,
    };
  });
  const onlineRows = users.filter((user) => user.online);
  // Pre-0019 windows carry no device id; fall back to per-user counting there.
  const onlineDevices = new Set(onlineRows.map(
    (user) => `${user.userId}:${user.deviceId ?? 'legacy'}`,
  )).size;
  return {
    onlineWindowSeconds: ACTIVITY_ONLINE_SECONDS,
    onlineUsers: new Set(onlineRows.map((user) => user.userId)).size,
    onlineDevices,
    users,
  };
}

function operationsActivity(e: Env, cache?: OpsRequestCache) {
  if (!cache) return loadOperationsActivity(e);
  return cache.activity ??= loadOperationsActivity(e, cache);
}

const OPS_USERS_PAGE_LIMIT = 2000;

/**
 * The console's customer roster, one page per query.
 *
 * This used to fetch up to 2000 users and then expand three `IN (?,?,…)`
 * lists with one placeholder per user; the joins now ride along in the same
 * statement. `total`/`hasMore`/`nextCursor` exist because the old LIMIT 2000
 * truncated silently — the 2001st customer simply did not appear anywhere.
 */
async function operationsUsers(
  e: Env,
  page?: { cursor?: { createdAt: number; id: string } | null; limit?: number | null },
) {
  const limit = Math.min(Math.max(page?.limit ?? OPS_USERS_PAGE_LIMIT, 1), OPS_USERS_PAGE_LIMIT);
  const cursor = page?.cursor ?? null;
  const [rows, totals] = await Promise.all([
    e.DB.prepare(
      `WITH page AS (
         SELECT * FROM users
         WHERE ? = 0 OR created_at < ? OR (created_at = ? AND id < ?)
         ORDER BY created_at DESC, id DESC
         LIMIT ?
       )
       SELECT
         page.*,
         home_exits.id AS home_exit_id,
         home_exits.proxy_name AS home_proxy_name,
         home_exits.display_name AS home_display_name,
         home_exits.egress_ipv4 AS home_egress_ipv4,
         home_exits.kind AS home_kind,
         home_exits.socks5_host AS home_socks5_host,
         home_exits.socks5_port AS home_socks5_port,
         home_exits.status AS home_status,
         user_home_bindings.default_proxy_name AS home_default_proxy_name,
         assigned.account_ref AS product_account_ref,
         assigned.status AS product_status,
         assigned.opened_at AS product_opened_at,
         (SELECT COUNT(*) FROM product_account_events
          WHERE type = 'replaced' AND user_id = page.id) AS replace_count,
         EXISTS(SELECT 1 FROM exit_credentials WHERE user_id = page.id) AS has_exit_identity
       FROM page
       LEFT JOIN user_home_bindings ON user_home_bindings.user_id = page.id
       LEFT JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
       LEFT JOIN product_accounts assigned
         ON assigned.user_id = page.id AND assigned.status = 'assigned'
       ORDER BY page.created_at DESC, page.id DESC`,
    ).bind(
      cursor ? 1 : 0,
      cursor?.createdAt ?? 0,
      cursor?.createdAt ?? 0,
      cursor?.id ?? '',
      limit + 1,
    ).all<Row>(),
    e.DB.prepare('SELECT COUNT(*) AS total FROM users').first<Row>(),
  ]);
  const hasMore = rows.results.length > limit;
  const pageRows = hasMore ? rows.results.slice(0, limit) : rows.results;
  const last = pageRows[pageRows.length - 1];
  const users = pageRows.map((row) => ({
    ...publicUser(row),
    hasExitIdentity: Number(row.has_exit_identity) === 1,
    homeBinding: row.home_exit_id
      ? {
        homeExitId: String(row.home_exit_id),
        proxyName: String(row.home_proxy_name),
        displayName: String(row.home_display_name),
        egressIpv4: row.home_egress_ipv4 == null ? undefined : String(row.home_egress_ipv4),
        kind: row.home_kind == null ? undefined : String(row.home_kind),
        socks5Host: row.home_socks5_host == null ? undefined : String(row.home_socks5_host),
        socks5Port: row.home_socks5_port == null ? undefined : Number(row.home_socks5_port),
        defaultProxyName: row.home_default_proxy_name == null || row.home_default_proxy_name === ''
          ? undefined
          : String(row.home_default_proxy_name),
        status: String(row.home_status),
      }
      : null,
    product: {
      accountRef: row.product_account_ref == null ? null : String(row.product_account_ref),
      status: row.product_status == null ? null : String(row.product_status),
      openedAt: row.product_opened_at == null ? null : Number(row.product_opened_at),
      replaceCount: Number(row.replace_count ?? 0),
      incomplete: row.product_account_ref == null,
    },
  }));
  return {
    users,
    total: Number(totals?.total ?? 0),
    hasMore,
    nextCursor: hasMore && last ? `${Number(last.created_at)}:${String(last.id)}` : null,
  };
}

async function operationsCatalogRevisions(e: Env) {
  const [metadata, current] = await Promise.all([
    e.DB.prepare(
      `SELECT revision, content_sha256, published_at, server_count, logical_node_count, deployment_count
       FROM operations_catalog_revision_metadata ORDER BY revision DESC LIMIT 250`,
    ).all<Row>(),
    e.DB.prepare(
      'SELECT revision, content_sha256, updated_at FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<Row>(),
  ]);
  const revisions = metadata.results.map((row) => ({
    revision: Number(row.revision),
    sha256: Number(row.revision) === Number(current?.revision ?? 0)
      ? String(current!.content_sha256)
      : String(row.content_sha256),
    publishedAt: Number(row.revision) === Number(current?.revision ?? 0)
      ? Number(current!.updated_at)
      : Number(row.published_at),
    serverCount: Number(row.server_count),
    logicalNodeCount: Number(row.logical_node_count),
    deploymentCount: Number(row.deployment_count),
    current: Number(row.revision) === Number(current?.revision ?? 0),
  }));
  if (current && !revisions.some((row) => row.revision === Number(current.revision))) {
    revisions.unshift({
      revision: Number(current.revision),
      sha256: String(current.content_sha256),
      publishedAt: Number(current.updated_at),
      serverCount: 0,
      logicalNodeCount: 0,
      deploymentCount: 0,
      current: true,
    });
  }
  return revisions;
}

const publicUser = (u: Row) => ({
  id: u.id,
  email: u.email,
  name: u.name ?? undefined,
  plan: u.plan ?? undefined,
  notes: u.notes == null || u.notes === '' ? undefined : String(u.notes),
  contact: u.contact == null || u.contact === '' ? undefined : String(u.contact),
  firstEntitledAt: u.first_entitled_at == null ? undefined : Number(u.first_entitled_at),
  deviceLimit: Number(u.device_limit ?? 2),
  quotaBytes: u.quota_bytes,
  usageBytes: Number(u.usage_bytes ?? 0),
  expiresAt: u.expires_at ?? undefined,
  suspended: u.status !== 'active',
  status: u.status,
  createdAt: u.created_at,
});

const publicDevice = (d: Row, currentId?: string) => ({
  id: d.id,
  name: d.name,
  installationId: d.installation_id,
  current: d.id === currentId,
  status: d.status,
  pendingExpiresAt: d.pending_expires_at,
  tailscaleNodeId: d.tailscale_node_id,
  stableNodeId: d.tailscale_stable_id ?? undefined,
  tailscaleApiNodeId: d.tailscale_api_node_id ?? undefined,
  tailscaleIPs: d.tailscale_ips ? JSON.parse(d.tailscale_ips) : [],
  lastSeenAt: d.last_seen_at ?? undefined,
  confirmedAt: d.confirmed_at ?? undefined,
  createdAt: d.created_at,
});

/** Multiset equality for Tailscale addresses (order-independent). */
function sameAddressSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map(String).sort();
  const sb = [...b].map(String).sort();
  return sa.every((x, i) => x === sb[i]);
}

// --- Rate limiting (D1) -------------------------------------------------------

async function consumeRateLimit(e: Env, key: string, limit: number, windowSeconds: number) {
  const t = now();
  const cutoff = t - windowSeconds;
  const row = await e.DB.prepare(
    `INSERT INTO rate_limits(key, count, window_start)
     VALUES(?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END
     RETURNING count`,
  ).bind(key, t, cutoff, cutoff).first<Row>();
  if (!row || Number(row.count) > limit) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts; try again later');
  }
}

async function rateLimitEmailStart(e: Env, req: Request, emailAddr: string) {
  const windowSeconds = envInt(e, 'RATE_LIMIT_WINDOW_SECONDS', 900);
  const ipLimit = envInt(e, 'RATE_LIMIT_EMAIL_START_IP', 20);
  const emailLimit = envInt(e, 'RATE_LIMIT_EMAIL_START_EMAIL', 5);
  const ip = clientIp(req);
  await consumeRateLimit(e, `rl:${await sha256(`email-start:ip:${ip}`)}`, ipLimit, windowSeconds);
  await consumeRateLimit(e, `rl:${await sha256(`email-start:email:${emailAddr}`)}`, emailLimit, windowSeconds);
}

async function rateLimitChallenge(
  e: Env,
  req: Request,
  kind: 'email-verify' | 'oidc-verify',
  challengeId: string,
) {
  const windowSeconds = envInt(e, 'RATE_LIMIT_WINDOW_SECONDS', 900);
  const ipLimit = envInt(
    e,
    kind === 'email-verify' ? 'RATE_LIMIT_EMAIL_VERIFY_IP' : 'RATE_LIMIT_OIDC_VERIFY_IP',
    30,
  );
  const challengeLimit = envInt(
    e,
    kind === 'email-verify'
      ? 'RATE_LIMIT_EMAIL_VERIFY_CHALLENGE'
      : 'RATE_LIMIT_OIDC_VERIFY_CHALLENGE',
    5,
  );
  await consumeRateLimit(
    e,
    `rl:${await sha256(`${kind}:ip:${clientIp(req)}`)}`,
    ipLimit,
    windowSeconds,
  );
  await consumeRateLimit(
    e,
    `rl:${await sha256(`${kind}:challenge:${challengeId}`)}`,
    challengeLimit,
    windowSeconds,
  );
}

async function rateLimitOidcStart(e: Env, req: Request, installationId: string) {
  const windowSeconds = envInt(e, 'RATE_LIMIT_WINDOW_SECONDS', 900);
  await consumeRateLimit(
    e,
    `rl:${await sha256(`oidc-start:ip:${clientIp(req)}`)}`,
    envInt(e, 'RATE_LIMIT_OIDC_START_IP', 20),
    windowSeconds,
  );
  await consumeRateLimit(
    e,
    `rl:${await sha256(`oidc-start:installation:${installationId}`)}`,
    envInt(e, 'RATE_LIMIT_OIDC_START_INSTALLATION', 10),
    windowSeconds,
  );
}

// --- Diagnostics reports ------------------------------------------------------

// A degraded client on the kill-switch recovery channel gets one bounded
// upload, never a log firehose. Anything larger is rejected, not truncated:
// a silently trimmed report is worse than none for support.
const DIAGNOSTICS_BODY_MAX_BYTES = 32 * 1024;
// Backstop matching the column CHECK. The per-field bounds below already keep a
// fully-populated report under 8 KiB, so this only catches a schema change that
// forgets to re-check the total.
const DIAGNOSTICS_REPORT_MAX_BYTES = 16 * 1024;
const DIAGNOSTICS_HOUR_SECONDS = 3_600;
const DIAGNOSTICS_DAY_SECONDS = 86_400;
const DIAGNOSTICS_RETENTION_DEFAULT_SECONDS = 30 * DIAGNOSTICS_DAY_SECONDS;
// Gzip, not text. Matches the column CHECK; a client that wants to send more
// splits into more segments rather than having one truncated.
const DIAGNOSTICS_LOG_MAX_BYTES = 2 * 1024 * 1024;
const DIAGNOSTICS_LOG_RETENTION_DEFAULT_SECONDS = 14 * DIAGNOSTICS_DAY_SECONDS;
// Every component of an R2 key is either a fixed string or matched against
// this, so a session identifier can never introduce a path segment.
const DIAGNOSTICS_LOG_SESSION_PATTERN = /^[0-9A-Za-z-]{1,64}$/;
/** Crockford-style: no 0/O/1/I, so a code survives being read over the phone. */
const referenceAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const referencePattern = /^[2-9A-HJ-NP-Z]{8}$/;

function referenceCode() {
  // The alphabet is exactly 32 symbols, so masking the low five bits of each
  // random byte is uniform without rejection sampling. 32^8 ≈ 1.1e12 codes.
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = '';
  for (const byte of bytes) code += referenceAlphabet[byte & 31];
  return code;
}

/** Accept what a support agent actually types: lowercase, spaced, hyphenated. */
function normalizedReferenceCode(value: unknown) {
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
/** 2100-01-01 in epoch ms. `reportedAtMs` is the *client* clock, and a skewed
 *  clock is itself a failure this report exists to capture, so it is bounded
 *  for storage sanity rather than checked against the server's clock. */
const DIAGNOSTICS_MAX_REPORTED_AT_MS = 4_102_444_800_000;
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

function diagnosticsInt(source: Row, key: string, min: number, max: number, nullable: boolean) {
  const raw = source[key];
  if (nullable && (raw === undefined || raw === null)) return undefined;
  if (!Number.isSafeInteger(raw) || (raw as number) < min || (raw as number) > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
  }
  return raw as number;
}

/**
 * Whitelist the structured report. Nothing outside the schema is stored, the
 * bounds refuse rather than truncate, and the payload is never echoed back to
 * the uploader. `appVersion`/`osVersion` are also lifted into their own
 * columns by the caller, so their bounds match the column CHECKs exactly.
 */
function canonicalDiagnosticsReport(value: unknown) {
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

async function rateLimitDiagnosticsLog(e: Env, uid: string) {
  // Deliberately keyed on the account only. The IP bucket that guards reports
  // would collapse a household or an office behind one NAT into a single
  // budget, and unlike a report this upload is a background timer the user is
  // not waiting on — the account caps are what bound the cost.
  await consumeRateLimit(
    e,
    `rl:${await sha256(`diagnostics-log:user-hour:${uid}`)}`,
    envInt(e, 'RATE_LIMIT_DIAGNOSTICS_LOG_USER_HOUR', 80),
    DIAGNOSTICS_HOUR_SECONDS,
  );
  await consumeRateLimit(
    e,
    `rl:${await sha256(`diagnostics-log:user-day:${uid}`)}`,
    envInt(e, 'RATE_LIMIT_DIAGNOSTICS_LOG_USER_DAY', 800),
    DIAGNOSTICS_DAY_SECONDS,
  );
}

/** Header-carried metadata for a log segment, validated as strictly as a body. */
function diagnosticsLogMetadata(req: Request) {
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

async function storeDiagnosticsLogSegment(
  e: Env,
  uid: string,
  deviceId: string | null,
  meta: ReturnType<typeof diagnosticsLogMetadata>,
  payload: Uint8Array,
) {
  // A client that loses its upload cursor replays from the last segment it is
  // sure about. Answering the replay from the index — rather than writing the
  // object again — is what keeps that cheap and keeps `sequence` meaningful.
  const existing = await e.DB.prepare(
    'SELECT id, received_at FROM diagnostics_log_objects WHERE user_id = ? AND session_id = ? AND sequence = ?',
  ).bind(uid, meta.sessionId, meta.sequence).first<Row>();
  if (existing) {
    return {
      id: String(existing.id),
      receivedAt: Number(existing.received_at),
      duplicate: true,
    };
  }
  const t = now();
  const id = crypto.randomUUID();
  // Every component is server-derived. The date prefix is what makes a
  // retention sweep able to list a day without walking the whole bucket.
  const day = new Date(t * 1000).toISOString().slice(0, 10);
  const key = `logs/${uid}/${day}/${meta.sessionId}-${String(meta.sequence).padStart(7, '0')}.jsonl.gz`;
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
    // that did nothing wrong.
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

async function rateLimitDiagnostics(e: Env, req: Request, uid: string) {
  await consumeRateLimit(
    e,
    `rl:${await sha256(`diagnostics:ip:${clientIp(req)}`)}`,
    envInt(e, 'RATE_LIMIT_DIAGNOSTICS_IP_HOUR', 30),
    DIAGNOSTICS_HOUR_SECONDS,
  );
  await consumeRateLimit(
    e,
    `rl:${await sha256(`diagnostics:user-hour:${uid}`)}`,
    envInt(e, 'RATE_LIMIT_DIAGNOSTICS_USER_HOUR', 5),
    DIAGNOSTICS_HOUR_SECONDS,
  );
  await consumeRateLimit(
    e,
    `rl:${await sha256(`diagnostics:user-day:${uid}`)}`,
    envInt(e, 'RATE_LIMIT_DIAGNOSTICS_USER_DAY', 20),
    DIAGNOSTICS_DAY_SECONDS,
  );
}

async function storeDiagnosticsReport(
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

const publicDiagnosticsReport = (r: Row) => ({
  id: r.id,
  referenceCode: r.reference_code,
  userId: r.user_id,
  receivedAt: Number(r.received_at),
  clientVersion: r.client_version,
  osVersion: r.os_version,
  report: JSON.parse(r.report_json),
});

// --- Periodic telemetry windows (testing default-on timeline) ----------------
//
// Separate from diagnostics_reports: no support reference code, higher cadence
// (≈ every 20 minutes), and a short event slice for ban/network forensics.
// Emails and secrets must never appear; the client already scrubs, and the
// Worker still rejects unknown keys and free-text email-like fields.

const TELEMETRY_BODY_MAX_BYTES = 72 * 1024;
const TELEMETRY_PAYLOAD_MAX_BYTES = 64 * 1024;
const TELEMETRY_MAX_EVENTS = 200;
const TELEMETRY_RETENTION_DEFAULT_SECONDS = 30 * DIAGNOSTICS_DAY_SECONDS;
const OPS_AUDIT_RETENTION_SECONDS = 180 * 86_400;
const TELEMETRY_MAX_REPORTED_AT_MS = DIAGNOSTICS_MAX_REPORTED_AT_MS;

const telemetryWindowKeys = [
  'schemaVersion', 'kind', 'windowStartMs', 'windowEndMs',
  'appVersion', 'osVersion', 'osArch',
  'uiState', 'accountState', 'selectedServer', 'catalogRevision',
  'killSwitchMode', 'killSwitchWanted', 'killSwitchLive',
  'dnsEnabled', 'exitDelayMs', 'tcpDelayMs', 'exitDelayAtMs', 'tcpDelayAtMs',
  'eventCount', 'eventsDropped', 'events',
];

const telemetryEventStringKeys = [
  'kind', 'stage', 'error', 'node', 'action', 'reason', 'probe',
  'from', 'to', 'mode', 'reference', 'outcome', 'code',
];
const telemetryEventNumberKeys = [
  'ts', 'elapsedMs', 'delayMs', 'counter', 'restartCount', 'oldPid', 'newPid',
  'revision', 'domains', 'media', 'webDomains', 'wechatTcp', 'webTcp', 'udp',
  'endpoints', 'eventCount', 'bytes', 'generation',
];
const telemetryEventBoolKeys = ['wanted', 'live', 'updateResume'];
const telemetryEventKeys = [
  ...telemetryEventStringKeys,
  ...telemetryEventNumberKeys,
  ...telemetryEventBoolKeys,
];

function canonicalTelemetryWindow(value: unknown) {
  rejectUnexpectedKeys(value, telemetryWindowKeys);
  const source = value as Row;
  const kind = str(source.kind, 'kind', 1, 40);
  if (kind !== 'periodic_window') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid telemetry kind');
  }
  const schemaVersion = diagnosticsInt(source, 'schemaVersion', 1, 1_000, false)!;
  const windowStartMs = diagnosticsInt(source, 'windowStartMs', 0, TELEMETRY_MAX_REPORTED_AT_MS, false)!;
  const windowEndMs = diagnosticsInt(source, 'windowEndMs', 0, TELEMETRY_MAX_REPORTED_AT_MS, false)!;
  if (windowEndMs < windowStartMs) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid telemetry window range');
  }
  if (windowEndMs - windowStartMs > 6 * 60 * 60 * 1000) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Telemetry window too wide');
  }
  const appVersion = str(source.appVersion, 'appVersion', 1, 40);
  const osVersion = str(source.osVersion, 'osVersion', 1, 80);
  const osArch = str(source.osArch ?? '', 'osArch', 0, 32);
  const uiState = str(source.uiState ?? '', 'uiState', 0, 40);
  const accountState = str(source.accountState ?? '', 'accountState', 0, 40);
  if (typeof source.eventCount !== 'number' || !Number.isSafeInteger(source.eventCount)
      || source.eventCount < 0 || source.eventCount > TELEMETRY_MAX_EVENTS) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid eventCount');
  }
  if (typeof source.eventsDropped !== 'number' || !Number.isSafeInteger(source.eventsDropped)
      || source.eventsDropped < 0 || source.eventsDropped > 1_000_000) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid eventsDropped');
  }
  if (!Array.isArray(source.events) || source.events.length > TELEMETRY_MAX_EVENTS) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid events');
  }
  if (source.events.length !== source.eventCount) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'eventCount mismatch');
  }

  const events = source.events.map((raw: unknown) => {
    rejectUnexpectedKeys(raw, telemetryEventKeys);
    const entry = raw as Row;
    if (typeof entry.ts !== 'number' || !Number.isSafeInteger(entry.ts)
        || entry.ts < 0 || entry.ts > TELEMETRY_MAX_REPORTED_AT_MS) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid event ts');
    }
    const eventKind = str(entry.kind, 'event kind', 1, 40);
    // Never accept account identity fields on the wire.
    if (eventKind === 'signInStart' || eventKind === 'signInOk' || 'email' in entry) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Telemetry must not include account identity events');
    }
    const event: Row = { ts: entry.ts, kind: eventKind };
    for (const key of telemetryEventStringKeys) {
      if (key === 'kind') continue;
      if (entry[key] === undefined || entry[key] === null) continue;
      event[key] = str(entry[key], key, 0, 500);
    }
    for (const key of telemetryEventNumberKeys) {
      if (key === 'ts') continue;
      if (entry[key] === undefined || entry[key] === null) continue;
      if (typeof entry[key] !== 'number' || !Number.isSafeInteger(entry[key])) {
        throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
      }
      event[key] = entry[key];
    }
    for (const key of telemetryEventBoolKeys) {
      if (entry[key] === undefined || entry[key] === null) continue;
      if (typeof entry[key] !== 'boolean') {
        throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
      }
      event[key] = entry[key];
    }
    return event;
  });

  const window: Row = {
    schemaVersion,
    kind,
    windowStartMs,
    windowEndMs,
    appVersion,
    osVersion,
    osArch,
    uiState,
    accountState,
    eventCount: source.eventCount,
    eventsDropped: source.eventsDropped,
    events,
  };
  if (source.selectedServer !== undefined && source.selectedServer !== null) {
    window.selectedServer = str(source.selectedServer, 'selectedServer', 0, 100);
  }
  const catalogRevision = diagnosticsInt(source, 'catalogRevision', 0, 1_000_000_000_000, true);
  if (catalogRevision !== undefined) window.catalogRevision = catalogRevision;
  if (source.killSwitchMode !== undefined && source.killSwitchMode !== null) {
    window.killSwitchMode = str(source.killSwitchMode, 'killSwitchMode', 0, 40);
  }
  for (const key of ['killSwitchWanted', 'killSwitchLive', 'dnsEnabled'] as const) {
    if (source[key] === undefined || source[key] === null) continue;
    if (typeof source[key] !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
    }
    window[key] = source[key];
  }
  const exitDelayMs = diagnosticsInt(source, 'exitDelayMs', 1, 120_000, true);
  if (exitDelayMs !== undefined) window.exitDelayMs = exitDelayMs;
  const tcpDelayMs = diagnosticsInt(source, 'tcpDelayMs', 1, 120_000, true);
  if (tcpDelayMs !== undefined) window.tcpDelayMs = tcpDelayMs;
  const exitDelayAtMs = diagnosticsInt(source, 'exitDelayAtMs', 1, TELEMETRY_MAX_REPORTED_AT_MS, true);
  if (exitDelayAtMs !== undefined) window.exitDelayAtMs = exitDelayAtMs;
  const tcpDelayAtMs = diagnosticsInt(source, 'tcpDelayAtMs', 1, TELEMETRY_MAX_REPORTED_AT_MS, true);
  if (tcpDelayAtMs !== undefined) window.tcpDelayAtMs = tcpDelayAtMs;

  const json = JSON.stringify(window);
  if (new TextEncoder().encode(json).byteLength > TELEMETRY_PAYLOAD_MAX_BYTES) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Telemetry window is too large');
  }
  return {
    json,
    appVersion,
    osVersion,
    windowStartMs,
    windowEndMs,
  };
}

async function rateLimitTelemetry(e: Env, req: Request, uid: string) {
  await consumeRateLimit(
    e,
    `rl:${await sha256(`telemetry:ip:${clientIp(req)}`)}`,
    envInt(e, 'RATE_LIMIT_TELEMETRY_IP_HOUR', 30),
    DIAGNOSTICS_HOUR_SECONDS,
  );
  await consumeRateLimit(
    e,
    `rl:${await sha256(`telemetry:user-hour:${uid}`)}`,
    envInt(e, 'RATE_LIMIT_TELEMETRY_USER_HOUR', 6),
    DIAGNOSTICS_HOUR_SECONDS,
  );
  await consumeRateLimit(
    e,
    `rl:${await sha256(`telemetry:user-day:${uid}`)}`,
    envInt(e, 'RATE_LIMIT_TELEMETRY_USER_DAY', 80),
    DIAGNOSTICS_DAY_SECONDS,
  );
}

async function storeTelemetryWindow(
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
  await e.DB.prepare(
    `INSERT INTO telemetry_windows(
       id, user_id, device_id, received_at, window_start_ms, window_end_ms, client_version, os_version, payload_json
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(rowId, uid, deviceId, receivedAt, windowStartMs, windowEndMs, clientVersion, osVersion, payloadJson).run();
  return { id: rowId, receivedAt };
}

const publicTelemetryWindow = (r: Row) => ({
  id: r.id,
  userId: r.user_id,
  receivedAt: Number(r.received_at),
  windowStartMs: Number(r.window_start_ms),
  windowEndMs: Number(r.window_end_ms),
  clientVersion: r.client_version,
  osVersion: r.os_version,
  window: JSON.parse(r.payload_json),
});

// --- Passwordless authentication ---------------------------------------------

function challengeID(value: unknown): string {
  const parsed = str(value, 'challengeId', 36, 36).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parsed)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid challengeId');
  }
  return parsed;
}

function oidcProvider(value: unknown): OidcProvider {
  if (value !== 'apple' && value !== 'google') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid provider');
  }
  return value;
}

function emailDeliveryConfigured(e: Env): boolean {
  return typeof e.RESEND_API_KEY === 'string' &&
    e.RESEND_API_KEY.length >= 20 &&
    typeof e.EMAIL_FROM === 'string' &&
    e.EMAIL_FROM.length >= 3 &&
    e.EMAIL_FROM.length <= 320 &&
    e.EMAIL_FROM.includes('@') &&
    !/[\r\n]/.test(e.EMAIL_FROM);
}

function providerAudience(e: Env, provider: OidcProvider): string | undefined {
  const value = provider === 'apple' ? e.APPLE_CLIENT_ID : e.GOOGLE_CLIENT_ID;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 512 ? trimmed : undefined;
}

async function directSignupAllowed(e: Env, emailAddr: string): Promise<boolean> {
  const managed = await e.DB.prepare(
    'SELECT 1 FROM signup_allowlist WHERE email = ?',
  ).bind(emailAddr).first<Row>();
  if (managed) return true;

  // Keep the configuration allowlist as a backwards-compatible bootstrap
  // path. New individual users should be managed through the authenticated
  // admin API so granting access does not require a Worker redeployment.
  const configured = e.DIRECT_SIGNUP_ALLOWLIST;
  if (typeof configured !== 'string' || configured.length > 4096) return false;
  const entries = configured
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0 || entries.length > 100) return false;
  return entries.some((entry) => (
    entry.startsWith('@')
      ? emailAddr.endsWith(entry) && emailAddr.length > entry.length
      : emailAddr === entry
  ));
}

function numericCode(): string {
  // Rejection sampling avoids modulo bias in the six-digit code.
  const range = 1_000_000;
  const maximum = 0x1_0000_0000 - (0x1_0000_0000 % range);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= maximum);
  return (value[0] % range).toString().padStart(6, '0');
}

async function challengeSecret(e: Env, challenge: string, secret: string) {
  return hmacSha256(
    `auth-challenge\u0000${challenge}\u0000${secret}`,
    requiredSecret(e.JWT_SECRET),
  );
}

async function deliverEmailCode(
  e: Env,
  recipient: string,
  code: string,
  challenge: string,
  ttlSeconds: number,
) {
  if (!emailDeliveryConfigured(e)) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        authorization: `Bearer ${e.RESEND_API_KEY}`,
        'content-type': 'application/json',
        'idempotency-key': challenge,
      },
      body: JSON.stringify({
        from: e.EMAIL_FROM,
        to: [recipient],
        subject: 'Your Tono sign-in code',
        text: `Your Tono sign-in code is ${code}. It expires in ${Math.ceil(ttlSeconds / 60)} minutes. If you did not request it, you can ignore this email.`,
      }),
    });
    await response.body?.cancel();
    return response.ok;
  } catch (deliveryError) {
    console.error(
      'email delivery failed',
      deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
    );
    return false;
  }
}

async function ensureEmailIdentity(e: Env, user: Row, emailAddr: string, t = now()) {
  await e.DB.prepare(
    `INSERT INTO auth_identities(
       provider, subject, user_id, email, email_verified_at, created_at, updated_at
     ) VALUES('email', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, subject) DO UPDATE SET
       email = excluded.email,
       email_verified_at = excluded.email_verified_at,
       updated_at = excluded.updated_at
     WHERE auth_identities.user_id = excluded.user_id`,
  ).bind(emailAddr, user.id, emailAddr, t, t, t).run();
  const identity = await e.DB.prepare(
    "SELECT user_id FROM auth_identities WHERE provider = 'email' AND subject = ?",
  ).bind(emailAddr).first<Row>();
  if (!identity || identity.user_id !== user.id) {
    throw new ApiError(409, 'IDENTITY_CONFLICT', 'This sign-in identity is already linked');
  }
}

async function accountForVerifiedEmail(
  e: Env,
  emailAddr: string,
): Promise<Row> {
  let user = await e.DB.prepare('SELECT * FROM users WHERE email = ?').bind(emailAddr).first<Row>();
  if (user) {
    if (ineligible(user)) throw new ApiError(403, 'USER_DISABLED', 'User is disabled');
    await ensureEmailIdentity(e, user, emailAddr);
    return user;
  }

  if (!(await directSignupAllowed(e, emailAddr))) {
    throw new ApiError(401, 'AUTHENTICATION_FAILED', 'Authentication could not be completed');
  }
  const t = now();
  const userId = id();
  let creationError: unknown;
  try {
    // The verified email or OIDC claim is the account-creation authority.
    // INSERT OR IGNORE makes concurrent first sign-ins converge on the same
    // unique email without requiring an invitation/redemption transaction.
    await e.DB.prepare(
      `INSERT OR IGNORE INTO users(
         id, email, password_hash, password_salt, created_at, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?)`,
    ).bind(
      userId,
      emailAddr,
      'PASSWORD_AUTH_DISABLED',
      'PASSWORD_AUTH_DISABLED',
      t,
      t,
    ).run();
  } catch (error) {
    // Resolve a concurrent first sign-in below. D1 uniqueness constraints
    // ensure that only the account for this verified email can be selected.
    creationError = error;
  }
  user = await e.DB.prepare('SELECT * FROM users WHERE email = ?').bind(emailAddr).first<Row>();
  if (!user) {
    if (creationError) {
      throw new ApiError(
        503,
        'ACCOUNT_CREATION_UNAVAILABLE',
        'Account activation is temporarily unavailable',
      );
    }
    throw new ApiError(401, 'AUTHENTICATION_FAILED', 'Authentication could not be completed');
  }
  if (ineligible(user)) throw new ApiError(403, 'USER_DISABLED', 'User is disabled');
  await ensureEmailIdentity(e, user, emailAddr, t);
  return user;
}

async function accountForOidcIdentity(
  e: Env,
  identity: Awaited<ReturnType<typeof verifyOidcIdToken>>,
): Promise<Row> {
  const linked = await e.DB.prepare(
    `SELECT users.*
     FROM auth_identities
     JOIN users ON users.id = auth_identities.user_id
     WHERE auth_identities.provider = ? AND auth_identities.subject = ?`,
  ).bind(identity.provider, identity.subject).first<Row>();
  if (linked) {
    if (ineligible(linked)) throw new ApiError(403, 'USER_DISABLED', 'User is disabled');
    return linked;
  }
  if (!identity.email || !identity.emailVerified) {
    throw new ApiError(
      401,
      'VERIFIED_EMAIL_REQUIRED',
      'The identity provider did not return a verified email address',
    );
  }

  const user = await accountForVerifiedEmail(e, identity.email);
  const t = now();
  try {
    await e.DB.prepare(
      `INSERT INTO auth_identities(
         provider, subject, user_id, email, email_verified_at, created_at, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      identity.provider,
      identity.subject,
      user.id,
      identity.email,
      t,
      t,
      t,
    ).run();
    return user;
  } catch {
    const raced = await e.DB.prepare(
      `SELECT users.*
       FROM auth_identities
       JOIN users ON users.id = auth_identities.user_id
       WHERE auth_identities.provider = ? AND auth_identities.subject = ?`,
    ).bind(identity.provider, identity.subject).first<Row>();
    if (!raced) {
      const existingProvider = await e.DB.prepare(
        `SELECT 1 FROM auth_identities
         WHERE provider = ? AND user_id = ?`,
      ).bind(identity.provider, user.id).first<Row>();
      if (existingProvider) {
        throw new ApiError(409, 'IDENTITY_CONFLICT', 'This sign-in identity is already linked');
      }
      throw new ApiError(
        503,
        'IDENTITY_LINK_UNAVAILABLE',
        'Identity linking is temporarily unavailable',
      );
    }
    if (ineligible(raced)) throw new ApiError(403, 'USER_DISABLED', 'User is disabled');
    return raced;
  }
}

async function completePasswordlessAuth(
  e: Env,
  user: Row,
  deviceName: string,
  installationId: string,
) {
  if (ineligible(user)) throw new ApiError(403, 'USER_DISABLED', 'User is disabled');
  return authResult(e, user, await ensureDevice(e, user.id, deviceName, installationId));
}

async function recordChallengeFailure(e: Env, challenge: string, kind: string) {
  await e.DB.prepare(
    `UPDATE auth_challenges
     SET attempts = attempts + 1
     WHERE id = ? AND kind = ? AND consumed_at IS NULL
       AND expires_at > ? AND attempts < max_attempts`,
  ).bind(challenge, kind, now()).run();
}

// --- Tokens / devices ---------------------------------------------------------

async function tokens(e: Env, user: string, device: string, installation: string) {
  const refresh = randomToken();
  const t = now();
  const sid = id();
  const accessTTL = envInt(e, 'ACCESS_TOKEN_TTL_SECONDS', 900);
  const refreshTTL = envInt(e, 'REFRESH_TOKEN_TTL_SECONDS', 2_592_000);
  await e.DB.prepare(
    'INSERT INTO sessions(id, user_id, refresh_hash, expires_at, created_at, device_id) VALUES(?, ?, ?, ?, ?, ?)',
  ).bind(sid, user, await sha256(refresh), t + refreshTTL, t, device).run();
  return {
    accessToken: await jwtSign(
      { sub: user, sid, did: device, iid: installation, iat: t, exp: t + accessTTL },
      requiredSecret(e.JWT_SECRET),
    ),
    refreshToken: refresh,
  };
}

async function authResult(e: Env, u: Row, d: Row) {
  const enrollment =
    tailscaleEnrollmentEnabled(e) && d.status === 'pending'
      ? await issueEnrollment(e, d)
      : undefined;
  return {
    ...await tokens(e, u.id, d.id, d.installation_id),
    user: publicUser(u),
    device: publicDevice(d, d.id),
    enrollment,
  };
}

async function enqueueRevocation(
  e: Env,
  deviceId: string,
  managementId: string,
  ownershipGeneration = -1,
  reason = 'orphan_cleanup',
  t = now(),
) {
  await e.DB.prepare(
    `INSERT INTO revocation_jobs(
       id, device_id, tailscale_node_id, created_at, ownership_generation, reason
     ) VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(tailscale_node_id) DO UPDATE SET
       completed_at = NULL,
       last_error = NULL,
       device_id = excluded.device_id,
       created_at = excluded.created_at,
       ownership_generation = excluded.ownership_generation,
       reason = excluded.reason`,
  ).bind(id(), deviceId, managementId, t, ownershipGeneration, reason).run();
}

/**
 * Expire pending devices for a user. When a management id is already stored
 * (e.g. mid-confirm claim), enqueue durable Tailscale deletion.
 */
async function expirePending(e: Env, user: string) {
  const t = now();
  const q = await e.DB.prepare(
    `SELECT id, tailscale_node_id, claim_generation
     FROM devices
     WHERE user_id = ? AND status = 'pending' AND pending_expires_at <= ?`,
  ).bind(user, t).all<Row>();
  for (const d of q.results) {
    const statements: D1PreparedStatement[] = [];
    if (d.tailscale_node_id) {
      statements.push(
        e.DB.prepare(
          `INSERT INTO revocation_jobs(
             id, device_id, tailscale_node_id, created_at, ownership_generation, reason
           )
           SELECT ?, id, tailscale_node_id, ?, claim_generation, 'pending_expired'
           FROM devices
           WHERE id = ? AND user_id = ? AND status = 'pending'
             AND pending_expires_at <= ? AND claim_generation = ?
             AND tailscale_node_id IS NOT NULL
           ON CONFLICT(tailscale_node_id) DO UPDATE SET
             completed_at = NULL,
             last_error = NULL,
             device_id = excluded.device_id,
             created_at = excluded.created_at,
             ownership_generation = excluded.ownership_generation,
             reason = excluded.reason`,
        ).bind(id(), t, d.id, user, t, d.claim_generation),
      );
    }
    statements.push(
      e.DB.prepare(
        `UPDATE devices SET
           status = 'revoked',
           claim_token = NULL,
           claim_expires_at = NULL,
           updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'pending'
           AND pending_expires_at <= ? AND claim_generation = ?`,
      ).bind(t, d.id, user, t, d.claim_generation),
      e.DB.prepare(
        `UPDATE sessions SET revoked_at = ?
         WHERE device_id = ? AND revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM devices
             WHERE id = ? AND status = 'revoked' AND claim_generation = ?
           )`,
      ).bind(t, d.id, d.id, d.claim_generation),
    );
    await e.DB.batch(statements);
  }
}

async function ensureDevice(e: Env, user: string, name: string, installation: string) {
  await expirePending(e, user);
  let d = await e.DB.prepare('SELECT * FROM devices WHERE user_id = ? AND installation_id = ?').bind(user, installation).first<Row>();
  const enrollmentEnabled = tailscaleEnrollmentEnabled(e);
  if (d && d.status === 'active') return d;
  const t = now();
  if (d && d.status === 'pending' && !enrollmentEnabled) {
    await e.DB.prepare(
      `UPDATE devices SET
         name = ?,
         status = 'active',
         pending_expires_at = NULL,
         claim_token = NULL,
         claim_expires_at = NULL,
         enrollment_issued_at = NULL,
         enrollment_hostname = NULL,
         confirmed_at = ?,
         last_seen_at = ?,
         updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    ).bind(name, t, t, t, d.id).run();
    return (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(d.id).first<Row>())!;
  }
  if (d && d.status === 'pending') return d;
  const pendingTTL = envInt(e, 'PENDING_DEVICE_TTL_SECONDS', 1_800);
  const did = d?.id || id();
  try {
    if (d) {
      if (enrollmentEnabled) {
        await e.DB.prepare(
          `UPDATE devices SET
             name = ?,
             status = 'pending',
             pending_expires_at = ?,
             updated_at = ?,
             tailscale_node_id = NULL,
             tailscale_stable_id = NULL,
             tailscale_api_node_id = NULL,
             tailscale_public_key = NULL,
             tailscale_ips = NULL,
             claim_token = NULL,
             claim_expires_at = NULL,
             claim_generation = claim_generation + 1,
             enrollment_issued_at = NULL,
             enrollment_hostname = NULL,
             confirmed_at = NULL
           WHERE id = ? AND status = 'revoked'`,
        ).bind(name, t + pendingTTL, t, did).run();
      } else {
        await e.DB.prepare(
          `UPDATE devices SET
             name = ?,
             status = 'active',
             pending_expires_at = NULL,
             updated_at = ?,
             tailscale_node_id = NULL,
             tailscale_stable_id = NULL,
             tailscale_api_node_id = NULL,
             tailscale_public_key = NULL,
             tailscale_ips = NULL,
             claim_token = NULL,
             claim_expires_at = NULL,
             claim_generation = claim_generation + 1,
             enrollment_issued_at = NULL,
             enrollment_hostname = NULL,
             confirmed_at = ?,
             last_seen_at = ?
           WHERE id = ? AND status = 'revoked'`,
        ).bind(name, t, t, t, did).run();
      }
    } else {
      if (enrollmentEnabled) {
        await e.DB.prepare(
          "INSERT INTO devices(id, user_id, installation_id, name, status, pending_expires_at, created_at, updated_at) VALUES(?, ?, ?, ?, 'pending', ?, ?, ?)",
        ).bind(did, user, installation, name, t + pendingTTL, t, t).run();
      } else {
        await e.DB.prepare(
          `INSERT INTO devices(
             id, user_id, installation_id, name, status,
             pending_expires_at, confirmed_at, last_seen_at, created_at, updated_at
           ) VALUES(?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?)`,
        ).bind(did, user, installation, name, t, t, t, t).run();
      }
    }
  } catch (x) {
    if (String(x).includes('DEVICE_LIMIT')) {
      throw new ApiError(409, 'DEVICE_LIMIT', 'This account has reached its device allowance');
    }
    throw x;
  }
  return (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(did).first<Row>())!;
}

// --- Tailscale ----------------------------------------------------------------

async function tailscaleToken(e: Env) {
  const r = await fetch('https://api.tailscale.com/api/v2/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: e.TAILSCALE_OAUTH_CLIENT_ID,
      client_secret: requiredSecret(e.TAILSCALE_OAUTH_CLIENT_SECRET),
      grant_type: 'client_credentials',
      // Explicitly downscope every generated access token. The credential is
      // configured with a grantless controller tag that owns only the pending
      // and active client tags in the repository policy artifact.
      scope: 'auth_keys devices:core',
      tags: 'tag:tono-controller',
    }).toString(),
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw new ApiError(502, 'TAILSCALE_ERROR', 'Tailscale authentication failed');
  }
  const accessToken = (await r.json() as Row).access_token;
  if (
    typeof accessToken !== 'string' ||
    accessToken.length < 8 ||
    accessToken.length > 4_096 ||
    /\s/.test(accessToken)
  ) {
    throw new ApiError(502, 'TAILSCALE_ERROR', 'Tailscale authentication failed');
  }
  return accessToken;
}

async function tailscale(
  e: Env,
  path: string,
  init: RequestInit = {},
  allowNotFound = false,
  accessToken?: string,
) {
  const r = await fetch(`https://api.tailscale.com/api/v2${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${accessToken ?? await tailscaleToken(e)}` },
  });
  if (!r.ok && !(allowNotFound && r.status === 404)) {
    await r.body?.cancel();
    throw new ApiError(502, 'TAILSCALE_ERROR', 'Tailscale API request failed');
  }
  return r;
}

interface ResolvedTailscaleDevice {
  managementId: string;
  apiNodeId?: string;
  publicKey?: string;
  addresses: string[];
}

function normalizedNodeKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('nodekey:') ? trimmed.slice('nodekey:'.length) : trimmed;
}

/**
 * Resolve a pending Tailscale node from tailnet inventory.
 * NEVER use client-submitted IDs as GET /device/{id} path segments.
 * Management API `id` is used only for /device/{id}/tags and DELETE.
 */
async function resolveFromInventory(
  e: Env,
  opts: {
    stableNodeId: string;
    nodeId?: string;
    publicKey?: string;
    ips: string[];
    enrollmentHostname: string;
  },
): Promise<ResolvedTailscaleDevice> {
  const r = await tailscale(e, `/tailnet/${encodeURIComponent(e.TAILSCALE_TAILNET)}/devices`);
  if (!r.ok) throw new ApiError(502, 'TAILSCALE_ERROR', 'Failed to list tailnet devices');
  const data = await r.json() as Row;
  const inventory: Row[] = Array.isArray(data.devices) ? data.devices : [];

  const candidates = inventory.filter((td) => {
    const tags: string[] = Array.isArray(td.tags) ? td.tags.map(String) : [];
    const addresses: string[] = Array.isArray(td.addresses) ? td.addresses.map(String) : [];
    const hostnameLabels = [td.name, td.hostname, td.hostName, td.dnsName, td.DNSName]
      .filter((value) => typeof value === 'string')
      .map((value) => String(value).trim().toLowerCase().replace(/\.$/, '').split('.')[0]);
    return tags.includes('tag:pending-tunnel-client') &&
      hostnameLabels.includes(opts.enrollmentHostname) &&
      sameAddressSet(addresses, opts.ips);
  });

  if (candidates.length === 0) {
    throw new ApiError(
      400,
      'INVALID_TAILSCALE_NODE',
      'No pending Tailscale node matches this enrollment and the submitted addresses',
    );
  }

  let narrowed = candidates;
  let hasServerVerifiedIdentity = false;

  if (opts.nodeId) {
    narrowed = narrowed.filter((td) => String(td.nodeId ?? '') === opts.nodeId);
    if (narrowed.length === 0) {
      throw new ApiError(400, 'INVALID_TAILSCALE_NODE', 'Submitted nodeId does not match pending inventory');
    }
    hasServerVerifiedIdentity = true;
  }
  if (opts.publicKey) {
    const submittedKey = normalizedNodeKey(opts.publicKey);
    narrowed = narrowed.filter((td) => {
      const fields = [td.publicKey, td.key, td.nodeKey]
        .map(normalizedNodeKey)
        .filter((x): x is string => x !== undefined);
      return submittedKey !== undefined && fields.includes(submittedKey);
    });
    if (narrowed.length === 0) {
      throw new ApiError(400, 'INVALID_TAILSCALE_NODE', 'Submitted publicKey does not match pending inventory');
    }
    hasServerVerifiedIdentity = true;
  }

  // Some Device API versions expose StableNodeID explicitly. If present, it must
  // agree exactly; hostnames and management ids are never substitutes.
  const stableFields = (td: Row) =>
    [td.stableNodeId, td.stableNodeID, td.stableId]
      .filter((x) => x != null)
      .map(String);
  const serverExposesStableId = narrowed.some((td) => stableFields(td).length > 0);
  const stableMatches = narrowed.filter((td) => stableFields(td).includes(opts.stableNodeId));
  if (serverExposesStableId) {
    if (stableMatches.length === 0) {
      throw new ApiError(400, 'INVALID_TAILSCALE_NODE', 'Submitted stableNodeId does not match pending inventory');
    }
    narrowed = stableMatches;
    hasServerVerifiedIdentity = true;
  }

  if (!hasServerVerifiedIdentity) {
    throw new ApiError(
      400,
      'UNVERIFIABLE_TAILSCALE_IDENTITY',
      'A server-verifiable nodeId or publicKey is required',
    );
  }
  if (narrowed.length !== 1) {
    throw new ApiError(400, 'INVALID_TAILSCALE_NODE', 'Ambiguous Tailscale node for submitted identity');
  }

  const matched = narrowed[0];
  const managementId = str(matched.id, 'tailscaleDeviceId', 1, 200);
  const apiNodeId = matched.nodeId != null ? String(matched.nodeId) : undefined;
  const publicKey = [matched.publicKey, matched.key, matched.nodeKey]
    .map(normalizedNodeKey)
    .find((x): x is string => x !== undefined);
  const addresses: string[] = Array.isArray(matched.addresses) ? matched.addresses.map(String) : [];
  return { managementId, apiNodeId, publicKey, addresses };
}

function ineligible(u: Row, t = now()) {
  return u.status !== 'active' ||
    (u.expires_at !== null && u.expires_at <= t) ||
    (u.quota_bytes !== null && u.usage_bytes >= u.quota_bytes);
}

async function revokeDevice(e: Env, d: Row, requireIneligibleUser = false) {
  const t = now();
  const requireFlag = requireIneligibleUser ? 1 : 0;
  await e.DB.batch([
    // Resolve claim_generation inside this transaction. Reading it before the
    // batch creates a race where a concurrent confirm can advance generation
    // and make a successful-looking revoke update zero rows.
    e.DB.prepare(
      `INSERT INTO revocation_jobs(
         id, device_id, tailscale_node_id, created_at, ownership_generation, reason
       )
       SELECT ?, id, tailscale_node_id, ?, claim_generation, 'device_revoked'
       FROM devices
       WHERE id = ? AND status IN ('active', 'pending')
         AND tailscale_node_id IS NOT NULL
         AND (
           ? = 0 OR EXISTS (
             SELECT 1 FROM users
             WHERE users.id = devices.user_id
               AND (
                 users.status != 'active'
                 OR (users.expires_at IS NOT NULL AND users.expires_at <= ?)
                 OR (users.quota_bytes IS NOT NULL AND users.usage_bytes >= users.quota_bytes)
               )
           )
         )
       ON CONFLICT(tailscale_node_id) DO UPDATE SET
         completed_at = NULL,
         last_error = NULL,
         device_id = excluded.device_id,
         created_at = excluded.created_at,
         ownership_generation = excluded.ownership_generation,
         reason = excluded.reason`,
    ).bind(id(), t, d.id, requireFlag, t),
    e.DB.prepare(
      `UPDATE devices SET
         status = 'revoked',
         claim_token = NULL,
         claim_expires_at = NULL,
         updated_at = ?
       WHERE id = ? AND status IN ('active', 'pending')
         AND (
           ? = 0 OR EXISTS (
             SELECT 1 FROM users
             WHERE users.id = devices.user_id
               AND (
                 users.status != 'active'
                 OR (users.expires_at IS NOT NULL AND users.expires_at <= ?)
                 OR (users.quota_bytes IS NOT NULL AND users.usage_bytes >= users.quota_bytes)
               )
             )
           )`,
    ).bind(t, d.id, requireFlag, t),
    e.DB.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE device_id = ? AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM devices
           WHERE devices.id = ? AND devices.status = 'revoked'
         )`,
    ).bind(t, d.id, d.id),
  ]);
}

/**
 * Clear only the exact failed claim generation. A durable guard job is written
 * before tag promotion, so this function never has to infer current ownership.
 */
async function compensateConfirmFailure(
  e: Env,
  deviceId: string,
  claimToken: string,
  claimGeneration: number,
) {
  const t = now();
  await e.DB.prepare(
    `UPDATE devices SET claim_token = NULL, claim_expires_at = NULL,
       tailscale_node_id = NULL, tailscale_stable_id = NULL,
       tailscale_api_node_id = NULL, tailscale_public_key = NULL,
       tailscale_ips = NULL, updated_at = ?
     WHERE id = ? AND status = 'pending' AND claim_token = ?
       AND claim_generation = ?`,
  ).bind(t, deviceId, claimToken, claimGeneration).run();
  try {
    await processRevocations(e);
  } catch (x) {
    console.error('compensation processRevocations failed', x instanceof Error ? x.message : String(x));
  }
}

async function clearClaim(e: Env, deviceId: string, claimToken: string, claimGeneration: number) {
  const t = now();
  await e.DB.prepare(
    `UPDATE devices SET claim_token = NULL, claim_expires_at = NULL, updated_at = ?
     WHERE id = ? AND claim_token = ? AND claim_generation = ?
       AND status = 'pending'`,
  ).bind(t, deviceId, claimToken, claimGeneration).run();
}

async function processRevocations(e: Env) {
  // Keep durable jobs queued while Home-US is paused, but do not contact
  // Tailscale from API requests or scheduled maintenance.
  if (!tailscaleEnrollmentEnabled(e)) return;
  const jobs = await e.DB.prepare(
    'SELECT * FROM revocation_jobs WHERE completed_at IS NULL ORDER BY created_at LIMIT 40',
  ).all<Row>();
  let oauthToken: string | undefined;
  for (const job of jobs.results) {
    try {
      const jobGeneration = Number(job.ownership_generation ?? -1);
      const t = now();

      // An active D1 owner is authoritative. This also retires a stale guard job
      // left behind after a successful activation acknowledgement failed.
      const owner = await e.DB.prepare(
        `SELECT id, status, claim_token, claim_expires_at, claim_generation
         FROM devices
         WHERE tailscale_node_id = ? AND status IN ('active', 'pending')
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END
         LIMIT 1`,
      ).bind(job.tailscale_node_id).first<Row>();
      if (owner?.status === 'active') {
        await e.DB.prepare(
          `UPDATE revocation_jobs SET completed_at = ?, last_error = ?
           WHERE id = ? AND device_id = ? AND ownership_generation = ?`,
        ).bind(t, 'skipped: node has a live active owner', job.id, job.device_id, jobGeneration).run();
        continue;
      }
      if (owner?.status === 'pending' && owner.claim_token && Number(owner.claim_expires_at ?? 0) > t) {
        await e.DB.prepare(
          `UPDATE revocation_jobs SET last_error = ?
           WHERE id = ? AND device_id = ? AND ownership_generation = ?`,
        ).bind('deferred: node has a live confirm claim', job.id, job.device_id, jobGeneration).run();
        continue;
      }

      // A newer claim for the same installation may not have stored its
      // management id yet. Defer until it either binds/activates or expires.
      const newerClaim = await e.DB.prepare(
        `SELECT id FROM devices
         WHERE id = ? AND status = 'pending' AND claim_generation > ?
           AND claim_token IS NOT NULL AND claim_expires_at > ?`,
      ).bind(job.device_id, jobGeneration, t).first<Row>();
      if (newerClaim) {
        await e.DB.prepare(
          `UPDATE revocation_jobs SET last_error = ?
           WHERE id = ? AND device_id = ? AND ownership_generation = ?`,
        ).bind('deferred: device has a newer confirm claim', job.id, job.device_id, jobGeneration).run();
        continue;
      }

      oauthToken ??= await tailscaleToken(e);
      const deletion = await tailscale(
        e,
        `/device/${encodeURIComponent(job.tailscale_node_id)}`,
        { method: 'DELETE' },
        true,
        oauthToken,
      );
      await deletion.body?.cancel();
      await e.DB.prepare(
        `UPDATE revocation_jobs SET completed_at = ?, last_error = NULL
         WHERE id = ? AND device_id = ? AND ownership_generation = ?`,
      ).bind(now(), job.id, job.device_id, jobGeneration).run();
    } catch (x) {
      await e.DB.prepare(
        `UPDATE revocation_jobs SET last_error = ?
         WHERE id = ? AND device_id = ? AND ownership_generation = ?`,
      ).bind(
        String(x instanceof Error ? x.message : x).slice(0, 500),
        job.id,
        job.device_id,
        Number(job.ownership_generation ?? -1),
      ).run();
    }
  }
}

/**
 * Pending nodes created with description `tono-device-{deviceId}` that no longer
 * have a live pending D1 row should be deleted via the durable outbox.
 */
async function cleanupOrphanPendingNodes(e: Env) {
  if (!tailscaleEnrollmentEnabled(e)) return;
  const r = await tailscale(e, `/tailnet/${encodeURIComponent(e.TAILSCALE_TAILNET)}/devices`);
  if (!r.ok) return;
  const data = await r.json() as Row;
  const inventory: Row[] = Array.isArray(data.devices) ? data.devices : [];
  const t = now();
  for (const td of inventory) {
    const tags: string[] = Array.isArray(td.tags) ? td.tags.map(String) : [];
    if (!tags.includes('tag:pending-tunnel-client')) continue;
    const desc = String(td.description ?? '');
    if (!desc.startsWith('tono-device-')) continue;
    const deviceId = desc.slice('tono-device-'.length);
    if (!deviceId || !td.id) continue;
    const d = await e.DB.prepare(
      'SELECT id, status, pending_expires_at, enrollment_hostname FROM devices WHERE id = ?',
    ).bind(deviceId).first<Row>();
    const inventoryLabels = [td.name, td.hostname, td.hostName, td.dnsName, td.DNSName]
      .filter((value) => typeof value === 'string')
      .map((value) => String(value).trim().toLowerCase().replace(/\.$/, '').split('.')[0]);
    const orphan =
      !d ||
      d.status === 'revoked' ||
      (d.status === 'pending' && (
        (d.pending_expires_at != null && d.pending_expires_at <= t) ||
        typeof d.enrollment_hostname !== 'string' ||
        !inventoryLabels.includes(d.enrollment_hostname)
      ));
    if (orphan) {
      await enqueueRevocation(e, deviceId, String(td.id), -1, 'orphan_pending_node', t);
    }
  }
}

async function enforceUser(e: Env, userId: string, processNow = true) {
  const u = await e.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<Row>();
  if (!u || !ineligible(u)) return;
  const ds = await e.DB.prepare("SELECT * FROM devices WHERE user_id = ? AND status IN ('active', 'pending')").bind(userId).all<Row>();
  for (const d of ds.results) await revokeDevice(e, d, true);
  const t = now();
  await e.DB.prepare(
    `UPDATE sessions SET revoked_at = ?
     WHERE user_id = ? AND revoked_at IS NULL
       AND EXISTS (
         SELECT 1 FROM users
         WHERE users.id = ?
           AND (
             users.status != 'active'
             OR (users.expires_at IS NOT NULL AND users.expires_at <= ?)
             OR (users.quota_bytes IS NOT NULL AND users.usage_bytes >= users.quota_bytes)
           )
       )`,
  ).bind(t, userId, userId, t).run();
  if (processNow && tailscaleEnrollmentEnabled(e)) await processRevocations(e);
}

async function enforceAll(e: Env) {
  const t = now();
  const q = await e.DB.prepare(
    "SELECT id FROM users WHERE status != 'active' OR (expires_at IS NOT NULL AND expires_at <= ?) OR (quota_bytes IS NOT NULL AND usage_bytes >= quota_bytes)",
  ).bind(t).all<Row>();
  for (const u of q.results) {
    try {
      await enforceUser(e, u.id, false);
    } catch (x) {
      console.error('user enforcement failed', u.id, x instanceof Error ? x.message : String(x));
    }
  }
  // Also expire any globally-stale pending devices (revocation outbox when management id present)
  const stale = await e.DB.prepare(
    "SELECT DISTINCT user_id FROM devices WHERE status = 'pending' AND pending_expires_at <= ?",
  ).bind(t).all<Row>();
  for (const row of stale.results) {
    try {
      await expirePending(e, row.user_id);
    } catch (x) {
      console.error('expirePending failed', row.user_id, x instanceof Error ? x.message : String(x));
    }
  }
  // Revocation is enforcement, not housekeeping. Run it before retention so a
  // transient failure deleting old diagnostics or telemetry cannot leave an
  // ineligible user's tailnet identity live until the next cron tick.
  if (tailscaleEnrollmentEnabled(e)) {
    try {
      await cleanupOrphanPendingNodes(e);
    } catch (x) {
      console.error('cleanupOrphanPendingNodes failed', x instanceof Error ? x.message : String(x));
    }
    try {
      await processRevocations(e);
    } catch (x) {
      // The durable outbox remains pending and the next scheduled run retries it.
      console.error('processRevocations failed', x instanceof Error ? x.message : String(x));
    }
  }
  const rateWindow = envInt(e, 'RATE_LIMIT_WINDOW_SECONDS', 900);
  // Diagnostics counters run on a day-long window, so pruning at twice the auth
  // window would silently reset the per-day cap every five minutes.
  const rateRetention = Math.max(rateWindow, DIAGNOSTICS_DAY_SECONDS) * 2;
  await e.DB.prepare('DELETE FROM rate_limits WHERE window_start <= ?').bind(t - rateRetention).run();
  await e.DB.prepare(
    `DELETE FROM auth_challenges
     WHERE expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at <= ?)`,
  ).bind(t - 86_400, t - 86_400).run();
  // Diagnostics uploads are troubleshooting artifacts, not account records.
  await e.DB.prepare('DELETE FROM diagnostics_reports WHERE received_at <= ?')
    .bind(t - envInt(e, 'DIAGNOSTICS_RETENTION_SECONDS', DIAGNOSTICS_RETENTION_DEFAULT_SECONDS))
    .run();
  // Raw log segments: delete the payload before the index row. Losing the row
  // first would orphan the object with nothing left pointing at it, and this
  // bucket is the one place in the system holding unredacted hostnames.
  const logRetention = envInt(
    e,
    'DIAGNOSTICS_LOG_RETENTION_SECONDS',
    DIAGNOSTICS_LOG_RETENTION_DEFAULT_SECONDS,
  );
  const expiredLogs = await e.DB.prepare(
    'SELECT id, r2_key FROM diagnostics_log_objects WHERE received_at <= ? LIMIT 500',
  ).bind(t - logRetention).all<Row>();
  for (const row of expiredLogs.results) {
    try {
      await e.DIAGNOSTICS_LOGS.delete(String(row.r2_key));
      await e.DB.prepare('DELETE FROM diagnostics_log_objects WHERE id = ?')
        .bind(String(row.id)).run();
    } catch (x) {
      // Keep the row so the next sweep retries this object rather than leaving
      // it in the bucket with no index entry to find it by.
      console.error('log retention failed', row.id, x instanceof Error ? x.message : String(x));
    }
  }
  await e.DB.prepare('DELETE FROM telemetry_windows WHERE received_at <= ?')
    .bind(t - envInt(e, 'TELEMETRY_RETENTION_SECONDS', TELEMETRY_RETENTION_DEFAULT_SECONDS))
    .run();
  // The audit log had no retention at all — every operator action since
  // migration 0023, forever. Half a year is the whole useful life of "who
  // retired that node"; the LIMIT keeps the first sweep over an old backlog
  // from being one giant delete.
  await e.DB.prepare(
    `DELETE FROM ops_audit WHERE id IN (
       SELECT id FROM ops_audit WHERE at <= ? LIMIT 500
     )`,
  ).bind(t - OPS_AUDIT_RETENTION_SECONDS).run();
  try {
    await retainOperationsTimeseries(e.DB, t);
  } catch (x) {
    console.error('ops timeseries retention failed', x instanceof Error ? x.message : String(x));
  }
  try {
    await snapshotUserUsageHours(e.DB, t);
  } catch (x) {
    console.error('user usage hour snapshot failed', x instanceof Error ? x.message : String(x));
  }
  const routingResearchRetention = Math.min(
    envInt(
      e,
      'ROUTING_RESEARCH_RETENTION_SECONDS',
      ROUTING_RESEARCH_RETENTION_MAX_SECONDS,
    ),
    ROUTING_RESEARCH_RETENTION_MAX_SECONDS,
  );
  await e.DB.prepare('DELETE FROM routing_research_snapshots WHERE received_at <= ?')
    .bind(t - routingResearchRetention).run();
}

async function issueEnrollment(e: Env, d: Row) {
  if (!tailscaleEnrollmentEnabled(e)) {
    throw new ApiError(410, 'TAILSCALE_DISABLED', 'Tailscale enrollment is temporarily disabled');
  }
  const t = now();
  if (d.claim_token && Number(d.claim_expires_at ?? 0) > t) {
    throw new ApiError(429, 'ENROLLMENT_COOLDOWN', 'Wait before requesting another enrollment key');
  }
  const unfinishedRevocation = await e.DB.prepare(
    `SELECT 1
     FROM revocation_jobs
     WHERE device_id = ? AND completed_at IS NULL
     LIMIT 1`,
  ).bind(d.id).first<Row>();
  if (unfinishedRevocation) {
    throw new ApiError(
      409,
      'REVOCATION_PENDING',
      'Wait for the prior tailnet identity to be revoked before enrolling again',
    );
  }
  if (d.enrollment_issued_at && t - d.enrollment_issued_at < 60) {
    throw new ApiError(429, 'ENROLLMENT_COOLDOWN', 'Wait before requesting another enrollment key');
  }
  const enrollmentHostname = `tono-${id().replaceAll('-', '')}`;
  const claim = await e.DB.prepare(
    `UPDATE devices SET enrollment_issued_at = ?, enrollment_hostname = ?, updated_at = ?
     WHERE id = ? AND status = 'pending' AND pending_expires_at > ?
       AND (claim_token IS NULL OR claim_expires_at <= ?)
       AND (enrollment_issued_at IS NULL OR enrollment_issued_at <= ?)
       AND NOT EXISTS (
         SELECT 1
         FROM revocation_jobs
         WHERE device_id = devices.id AND completed_at IS NULL
       )`,
  ).bind(t, enrollmentHostname, t, d.id, t, t, t - 60).run();
  if (!claim.meta.changes) {
    const racedRevocation = await e.DB.prepare(
      `SELECT 1
       FROM revocation_jobs
       WHERE device_id = ? AND completed_at IS NULL
       LIMIT 1`,
    ).bind(d.id).first<Row>();
    if (racedRevocation) {
      throw new ApiError(
        409,
        'REVOCATION_PENDING',
        'Wait for the prior tailnet identity to be revoked before enrolling again',
      );
    }
    throw new ApiError(429, 'ENROLLMENT_COOLDOWN', 'Wait before requesting another enrollment key');
  }
  try {
    const r = await tailscale(e, `/tailnet/${encodeURIComponent(e.TAILSCALE_TAILNET)}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          devices: {
            create: {
              reusable: false,
              ephemeral: true,
              preauthorized: true,
              tags: ['tag:pending-tunnel-client'],
            },
          },
        },
        expirySeconds: 600,
        description: `tono-device-${d.id}`,
      }),
    });
    const x = await r.json() as Row;
    const authKey = str(x.key, 'tailscaleAuthKey', 1, 1000);
    const expiresAt = str(x.expires, 'tailscaleKeyExpiry', 1, 100);
    return { id: d.id, authKey, hostname: enrollmentHostname, expiresAt, state: 'pending' };
  } catch (x) {
    // Release only this issuance lease. A transient Tailscale failure must not
    // make every subsequent authentication attempt fail with the local
    // 60-second cooldown.
    await e.DB.prepare(
      `UPDATE devices SET enrollment_issued_at = NULL, enrollment_hostname = NULL, updated_at = ?
       WHERE id = ? AND status = 'pending' AND enrollment_issued_at = ?
         AND enrollment_hostname = ?`,
    ).bind(now(), d.id, t, enrollmentHostname).run();
    throw x;
  }
}

// --- Confirm state machine ----------------------------------------------------

async function confirmDevice(
  e: Env,
  a: { userId: string; deviceId?: string; installationId?: string },
  deviceRowId: string,
  b: Row,
) {
  if (!tailscaleEnrollmentEnabled(e)) {
    throw new ApiError(410, 'TAILSCALE_DISABLED', 'Tailscale enrollment is temporarily disabled');
  }
  const stableNodeId = str(b.stableNodeId, 'stableNodeId', 1, 200);
  const nodeId = b.nodeId !== undefined && b.nodeId !== null ? str(b.nodeId, 'nodeId', 1, 200) : undefined;
  const publicKey = str(b.publicKey, 'publicKey', 1, 500);
  const ips = b.tailscaleIPs;
  if (!Array.isArray(ips) || ips.length < 1 || ips.length > 10 || ips.some((x) => typeof x !== 'string' || x.length > 64)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid tailscaleIPs');
  }
  const ipsList = ips as string[];

  // 1) Atomic claim. Each successful claim advances a durable ownership
  // generation so stale requests and stale deletion jobs can be fenced.
  const claimToken = randomToken(16);
  const t = now();
  const claimTTL = envInt(e, 'CONFIRM_CLAIM_TTL_SECONDS', 300);
  const claim = await e.DB.prepare(
    `UPDATE devices SET
       claim_token = ?,
       claim_expires_at = ?,
       claim_generation = claim_generation + 1,
       tailscale_node_id = NULL,
       tailscale_stable_id = NULL,
       tailscale_api_node_id = NULL,
       tailscale_public_key = NULL,
       tailscale_ips = NULL,
       updated_at = ?
     WHERE id = ? AND user_id = ? AND installation_id = ?
       AND status = 'pending' AND pending_expires_at > ?
       AND (claim_token IS NULL OR claim_expires_at <= ?)`,
  ).bind(
    claimToken,
    t + claimTTL,
    t,
    deviceRowId,
    a.userId,
    a.installationId,
    t,
    t,
  ).run();
  if (!claim.meta.changes) {
    throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device is already being confirmed or is not pending');
  }
  const claimed = await e.DB.prepare(
    `SELECT claim_generation, enrollment_hostname FROM devices
     WHERE id = ? AND claim_token = ? AND status = 'pending'`,
  ).bind(deviceRowId, claimToken).first<Row>();
  if (
    !claimed ||
    typeof claimed.enrollment_hostname !== 'string' ||
    !/^tono-[a-f0-9]{32}$/.test(claimed.enrollment_hostname)
  ) {
    await clearClaim(e, deviceRowId, claimToken, Number(claimed?.claim_generation ?? -1));
    throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device claim was lost');
  }
  const claimGeneration = Number(claimed.claim_generation);

  // 2) Resolve management id from inventory (list, never GET by client id)
  let resolved: ResolvedTailscaleDevice;
  try {
    resolved = await resolveFromInventory(e, {
      stableNodeId,
      nodeId,
      publicKey,
      ips: ipsList,
      enrollmentHostname: claimed.enrollment_hostname,
    });
  } catch (err) {
    await clearClaim(e, deviceRowId, claimToken, claimGeneration);
    throw err;
  }

  // 3) Store identity columns under the claim (management id in tailscale_node_id)
  try {
    const storeAt = now();
    const store = await e.DB.prepare(
      `UPDATE devices SET
         tailscale_node_id = ?,
         tailscale_stable_id = ?,
         tailscale_api_node_id = ?,
         tailscale_public_key = ?,
         tailscale_ips = ?,
         updated_at = ?
       WHERE id = ? AND claim_token = ? AND claim_generation = ?
         AND status = 'pending' AND pending_expires_at > ?
         AND claim_expires_at > ?
         AND NOT EXISTS (
           SELECT 1 FROM revocation_jobs
           WHERE tailscale_node_id = ? AND completed_at IS NULL
         )`,
    ).bind(
      resolved.managementId,
      stableNodeId,
      resolved.apiNodeId ?? nodeId ?? null,
      resolved.publicKey ?? normalizedNodeKey(publicKey) ?? null,
      JSON.stringify(ipsList),
      storeAt,
      deviceRowId,
      claimToken,
      claimGeneration,
      storeAt,
      storeAt,
      resolved.managementId,
    ).run();
    if (!store.meta.changes) {
      await clearClaim(e, deviceRowId, claimToken, claimGeneration);
      throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device state changed during confirm');
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Unique constraint: another device already owns this management or stable id
    await clearClaim(e, deviceRowId, claimToken, claimGeneration);
    throw new ApiError(409, 'NODE_ALREADY_CLAIMED', 'Tailscale node is already bound to another device');
  }

  // 4) Persist a deletion guard BEFORE the irreversible external promotion.
  // The guard is completed atomically with D1 activation. If activation throws,
  // cron still owns a durable cleanup record.
  const guardAt = now();
  const [renewed, guard] = await e.DB.batch([
    e.DB.prepare(
      `UPDATE devices SET claim_expires_at = ?, updated_at = ?
       WHERE id = ? AND claim_token = ? AND claim_generation = ?
         AND status = 'pending' AND pending_expires_at > ?
         AND claim_expires_at > ? AND tailscale_node_id = ?`,
    ).bind(
      guardAt + claimTTL,
      guardAt,
      deviceRowId,
      claimToken,
      claimGeneration,
      guardAt,
      guardAt,
      resolved.managementId,
    ),
    e.DB.prepare(
      `INSERT INTO revocation_jobs(
         id, device_id, tailscale_node_id, created_at, ownership_generation, reason
       )
       SELECT ?, id, tailscale_node_id, ?, claim_generation, 'confirm_guard'
       FROM devices
       WHERE id = ? AND claim_token = ? AND claim_generation = ?
         AND status = 'pending' AND pending_expires_at > ?
         AND claim_expires_at > ? AND tailscale_node_id = ?
       ON CONFLICT(tailscale_node_id) DO UPDATE SET
         completed_at = NULL,
         last_error = NULL,
         device_id = excluded.device_id,
         created_at = excluded.created_at,
         ownership_generation = excluded.ownership_generation,
         reason = excluded.reason`,
    ).bind(
      id(),
      guardAt,
      deviceRowId,
      claimToken,
      claimGeneration,
      guardAt,
      guardAt,
      resolved.managementId,
    ),
  ]);
  if (!renewed.meta.changes || !guard.meta.changes) {
    await compensateConfirmFailure(e, deviceRowId, claimToken, claimGeneration);
    throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device claim expired before promotion');
  }

  // 5) Promote tags using the server-authoritative management id only.
  try {
    const tagRes = await tailscale(e, `/device/${encodeURIComponent(resolved.managementId)}/tags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['tag:tunnel-client'] }),
    });
    await tagRes.body?.cancel();
    if (!tagRes.ok) throw new ApiError(502, 'TAILSCALE_ERROR', 'Failed to promote Tailscale device tags');
  } catch (err) {
    await compensateConfirmFailure(e, deviceRowId, claimToken, claimGeneration);
    throw err instanceof ApiError ? err : new ApiError(502, 'TAILSCALE_ERROR', 'Failed to promote Tailscale device tags');
  }

  // 6) Activate and retire the guard in one D1 transaction. Both pending and
  // claim leases are checked again after the external API call.
  let activate: D1Result;
  try {
    const activatedAt = now();
    [activate] = await e.DB.batch([
      e.DB.prepare(
        `UPDATE devices SET
           status = 'active',
           pending_expires_at = NULL,
           confirmed_at = ?,
           last_seen_at = ?,
           claim_token = NULL,
           claim_expires_at = NULL,
           updated_at = ?
         WHERE id = ? AND claim_token = ? AND claim_generation = ?
           AND status = 'pending' AND pending_expires_at > ?
           AND claim_expires_at > ? AND tailscale_node_id = ?`,
      ).bind(
        activatedAt,
        activatedAt,
        activatedAt,
        deviceRowId,
        claimToken,
        claimGeneration,
        activatedAt,
        activatedAt,
        resolved.managementId,
      ),
      e.DB.prepare(
        `UPDATE revocation_jobs SET completed_at = ?, last_error = NULL
         WHERE tailscale_node_id = ? AND device_id = ?
           AND ownership_generation = ? AND completed_at IS NULL
           AND EXISTS (
             SELECT 1 FROM devices
             WHERE id = ? AND status = 'active' AND claim_generation = ?
               AND tailscale_node_id = ?
           )`,
      ).bind(
        activatedAt,
        resolved.managementId,
        deviceRowId,
        claimGeneration,
        deviceRowId,
        claimGeneration,
        resolved.managementId,
      ),
    ]);
  } catch {
    // The pre-promotion guard remains durable even if D1 is temporarily
    // unavailable here.
    try {
      await compensateConfirmFailure(e, deviceRowId, claimToken, claimGeneration);
    } catch {
      // Scheduled processing will retry the already-persisted guard.
    }
    throw new ApiError(503, 'CONFIRM_ACTIVATION_FAILED', 'Device activation could not be committed');
  }

  if (!activate.meta.changes) {
    await compensateConfirmFailure(e, deviceRowId, claimToken, claimGeneration);
    throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device state changed');
  }

  const d = (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(deviceRowId).first<Row>())!;
  return publicDevice(d, a.deviceId);
}

// --- Router -------------------------------------------------------------------

async function route(req: Request, e: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/v1/health' && m === 'GET') {
    return Response.json({ ok: true, version: '0.0.1', buildSha: buildSha(e), service: 'api' });
  }

  if (p === '/api/v1/system/version' && m === 'GET') {
    return Response.json({ service: 'api', version: '0.0.1', buildSha: buildSha(e) });
  }

  if (p === '/api/v1/auth/methods' && m === 'GET') {
    const appleAudience = providerAudience(e, 'apple');
    const googleAudience = providerAudience(e, 'google');
    return Response.json({
      email: { enabled: emailDeliveryConfigured(e) },
      apple: { enabled: appleAudience !== undefined },
      google: {
        enabled: googleAudience !== undefined,
        ...(googleAudience ? { clientId: googleAudience } : {}),
      },
    });
  }

  if (p === '/api/v1/auth/email/start' && m === 'POST') {
    const b = await body(req, 16 * 1024);
    const submittedEmail = email(b.email);
    const name = str(b.deviceName, 'deviceName', 1, 100);
    const inst = str(b.installationId, 'installationId', 8, 200);
    if (!emailDeliveryConfigured(e)) {
      throw new ApiError(503, 'EMAIL_AUTH_UNAVAILABLE', 'Email sign-in is not configured');
    }
    await rateLimitEmailStart(e, req, submittedEmail);

    const existing = await e.DB.prepare('SELECT * FROM users WHERE email = ?')
      .bind(submittedEmail).first<Row>();
    // A verified mailbox is sufficient to create a test-stage account.
    // Disabled existing users remain ineligible and receive the same public
    // response shape as every other request.
    const eligible = existing
      ? !ineligible(existing)
      : await directSignupAllowed(e, submittedEmail);

    const challenge = id();
    const code = numericCode();
    const t = now();
    const ttl = envInt(e, 'EMAIL_CODE_TTL_SECONDS', 600);
    await e.DB.prepare(
      `INSERT INTO auth_challenges(
         id, kind, email, secret_hash, invitation_id, installation_id,
         device_name, attempts, max_attempts, expires_at, created_at
       ) VALUES(?, 'email_otp', ?, ?, ?, ?, ?, 0, 5, ?, ?)`,
    ).bind(
      challenge,
      submittedEmail,
      await challengeSecret(e, challenge, code),
      null,
      inst,
      name,
      t + ttl,
      t,
    ).run();

    if (eligible) {
      // Decouple provider latency from the public response so response timing
      // does not disclose whether an existing account was eligible.
      ctx.waitUntil((async () => {
        try {
          const delivered = await deliverEmailCode(e, submittedEmail, code, challenge, ttl);
          if (!delivered) {
            // Do not leave an undelivered code usable.
            await e.DB.prepare(
              'UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL',
            ).bind(now(), challenge).run();
          }
        } catch (deliveryStateError) {
          console.error(
            'email delivery state update failed',
            deliveryStateError instanceof Error
              ? deliveryStateError.message
              : String(deliveryStateError),
          );
        }
      })());
    }
    return Response.json(
      {
        challengeId: challenge,
        expiresIn: ttl,
        message: 'If this email is eligible, a sign-in code has been sent.',
      },
      { status: 202 },
    );
  }

  if (p === '/api/v1/auth/email/verify' && m === 'POST') {
    const b = await body(req, 4 * 1024);
    const challenge = challengeID(b.challengeId);
    const code = str(b.code, 'code', 6, 6);
    if (!/^\d{6}$/.test(code)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid code');
    await rateLimitChallenge(e, req, 'email-verify', challenge);
    const t = now();
    const claimed = await e.DB.prepare(
      `UPDATE auth_challenges
       SET attempts = attempts + 1,
           consumed_at = CASE WHEN secret_hash = ? THEN ? ELSE consumed_at END
       WHERE id = ? AND kind = 'email_otp' AND consumed_at IS NULL
         AND expires_at > ? AND attempts < max_attempts
       RETURNING *`,
    ).bind(await challengeSecret(e, challenge, code), t, challenge, t).first<Row>();
    if (!claimed || claimed.consumed_at !== t) {
      throw new ApiError(401, 'INVALID_OR_EXPIRED_CODE', 'The sign-in code is invalid or expired');
    }
    const user = await accountForVerifiedEmail(
      e,
      String(claimed.email).toLowerCase(),
    );
    return Response.json(await completePasswordlessAuth(
      e,
      user,
      String(claimed.device_name),
      String(claimed.installation_id),
    ));
  }

  if (p === '/api/v1/auth/oidc/challenge' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    const provider = oidcProvider(b.provider);
    const name = str(b.deviceName, 'deviceName', 1, 100);
    const inst = str(b.installationId, 'installationId', 8, 200);
    const audience = providerAudience(e, provider);
    if (!audience) {
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'This identity provider is not configured');
    }
    await rateLimitOidcStart(e, req, inst);
    const challenge = id();
    const nonce = randomToken(32);
    const t = now();
    const ttl = envInt(e, 'OIDC_CHALLENGE_TTL_SECONDS', 300);
    await e.DB.prepare(
      `INSERT INTO auth_challenges(
         id, kind, secret_hash, invitation_id, installation_id, device_name,
         attempts, max_attempts, expires_at, created_at
       ) VALUES(?, ?, ?, ?, ?, ?, 0, 3, ?, ?)`,
    ).bind(
      challenge,
      provider,
      await sha256(nonce),
      null,
      inst,
      name,
      t + ttl,
      t,
    ).run();
    return Response.json({
      challengeId: challenge,
      nonce,
      expiresIn: ttl,
      audience,
    });
  }

  if (p === '/api/v1/auth/oidc/verify' && m === 'POST') {
    const b = await body(req, 24 * 1024);
    const provider = oidcProvider(b.provider);
    const challenge = challengeID(b.challengeId);
    const idToken = str(b.idToken, 'idToken', 100, 16_384);
    const audience = providerAudience(e, provider);
    if (!audience) {
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'This identity provider is not configured');
    }
    await rateLimitChallenge(e, req, 'oidc-verify', challenge);
    const t = now();
    const pending = await e.DB.prepare(
      `SELECT * FROM auth_challenges
       WHERE id = ? AND kind = ? AND consumed_at IS NULL
         AND expires_at > ? AND attempts < max_attempts`,
    ).bind(challenge, provider, t).first<Row>();
    if (!pending) {
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }

    let identity: Awaited<ReturnType<typeof verifyOidcIdToken>>;
    try {
      identity = await verifyOidcIdToken(provider, idToken, audience, t);
    } catch (verificationError) {
      if (
        verificationError instanceof OidcVerificationError &&
        verificationError.temporary
      ) {
        throw new ApiError(
          503,
          'IDENTITY_PROVIDER_UNAVAILABLE',
          'The identity provider is temporarily unavailable',
        );
      }
      await recordChallengeFailure(e, challenge, provider);
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    const nonceHash = await sha256(identity.nonce);
    if (nonceHash !== pending.secret_hash) {
      await recordChallengeFailure(e, challenge, provider);
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    const consumed = await e.DB.prepare(
      `UPDATE auth_challenges
       SET attempts = attempts + 1, consumed_at = ?
       WHERE id = ? AND kind = ? AND secret_hash = ?
         AND consumed_at IS NULL AND expires_at > ? AND attempts < max_attempts`,
    ).bind(t, challenge, provider, nonceHash, t).run();
    if (!consumed.meta.changes) {
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    const user = await accountForOidcIdentity(e, identity);
    return Response.json(await completePasswordlessAuth(
      e,
      user,
      String(pending.device_name),
      String(pending.installation_id),
    ));
  }

  if (
    (p === '/api/v1/auth/redeem' || p === '/api/v1/auth/login') &&
    m === 'POST'
  ) {
    throw new ApiError(
      410,
      'PASSWORD_AUTH_DISABLED',
      'Password sign-in has been replaced by email, Apple, or Google sign-in',
    );
  }

  if (p === '/api/v1/auth/refresh' && m === 'POST') {
    const b = await body(req, 4 * 1024);
    const raw = str(b.refreshToken, 'refreshToken', 20, 500);
    const t = now();
    const s = await e.DB.prepare(
      `SELECT sessions.*, users.status user_status, users.quota_bytes, users.usage_bytes, users.expires_at user_expires_at,
              devices.installation_id, devices.status device_status, devices.pending_expires_at
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       JOIN devices ON devices.id = sessions.device_id
       WHERE refresh_hash = ? AND revoked_at IS NULL AND sessions.expires_at > ?`,
    ).bind(await sha256(raw), t).first<Row>();
    if (
      !s ||
      s.user_status !== 'active' ||
      !['active', 'pending'].includes(s.device_status) ||
      (s.device_status === 'pending' && s.pending_expires_at <= t) ||
      (s.user_expires_at !== null && s.user_expires_at <= t) ||
      (s.quota_bytes !== null && s.usage_bytes >= s.quota_bytes)
    ) {
      throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
    }
    const rotated = await e.DB.prepare(
      'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    ).bind(t, s.id).run();
    if (!rotated.meta.changes) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token was already used');
    return Response.json(await tokens(e, s.user_id, s.device_id, s.installation_id));
  }

  if (p === '/api/v1/auth/logout' && m === 'POST') {
    const a = await auth(req, e);
    const b: Row = await body(req, 4 * 1024).catch(() => ({} as Row));
    const raw = b.refreshToken;
    const t = now();
    const statements = [
      e.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?').bind(t, a.sessionId, a.userId),
    ];
    if (raw !== undefined) {
      str(raw, 'refreshToken', 20, 500);
      statements.push(
        e.DB.prepare(
          'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND refresh_hash = ? AND revoked_at IS NULL',
        ).bind(t, a.userId, await sha256(raw)),
      );
    }
    await e.DB.batch(statements);
    return new Response(null, { status: 204 });
  }

  if (p === '/api/v1/me' && m === 'GET') {
    const uid = await userId(req, e);
    const u = await e.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first<Row>();
    if (!u) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    return Response.json({ user: publicUser(u) });
  }

  if (p === '/api/v1/exit-catalog' && m === 'GET') {
    const a = await auth(req, e);
    return Response.json(await publicManagedCatalog(e, { userId: a.userId, filterHomeExits: true }));
  }

  if (p === '/api/v1/traffic-policy' && m === 'GET') {
    await auth(req, e);
    return Response.json(await publicTrafficPolicy(e));
  }

  if (p === '/api/v1/device-actions' && m === 'GET') {
    const a = await auth(req, e);
    const t = now();
    await e.DB.prepare("UPDATE device_actions SET status = 'expired' WHERE device_id = ? AND status IN ('pending','delivered') AND expires_at <= ?")
      .bind(a.deviceId, t).run();
    const q = await e.DB.prepare(
      "SELECT * FROM device_actions WHERE device_id = ? AND status IN ('pending','delivered') AND expires_at > ? ORDER BY created_at LIMIT 20",
    ).bind(a.deviceId, t).all<Row>();
    const pending = q.results.filter((x) => x.status === 'pending');
    if (pending.length) {
      await e.DB.prepare(
        `UPDATE device_actions SET status = 'delivered', delivered_at = ?
         WHERE device_id = ? AND status = 'pending' AND expires_at > ?`,
      ).bind(t, a.deviceId, t).run();
    }
    return Response.json({ actions: q.results.map((x) => publicAction({ ...x, status: 'delivered', delivered_at: x.delivered_at ?? t })) });
  }

  const actionResultMatch = p.match(/^\/api\/v1\/device-actions\/([^/]+)\/result$/);
  if (actionResultMatch && m === 'POST') {
    const a = await auth(req, e);
    const b = await body(req, 8 * 1024);
    const canonical = canonicalActionResult(b);
    const t = now();
    await e.DB.prepare("UPDATE device_actions SET status = 'expired' WHERE id = ? AND device_id = ? AND status IN ('pending','delivered') AND expires_at <= ?")
      .bind(actionResultMatch[1], a.deviceId, t).run();
    const existing = await e.DB.prepare('SELECT * FROM device_actions WHERE id = ?').bind(actionResultMatch[1]).first<Row>();
    if (!existing || existing.device_id !== a.deviceId) throw new ApiError(404, 'NOT_FOUND', 'Action not found');
    if (['succeeded', 'failed'].includes(existing.status)) {
      if (existing.status === canonical.result.outcome && existing.result_json === canonical.json) return Response.json({ action: publicAction(existing) });
      throw new ApiError(409, 'ACTION_RESULT_CONFLICT', 'Action already has a different result');
    }
    if (existing.status !== 'delivered') throw new ApiError(409, 'ACTION_NOT_DELIVERED', 'Action is not available for completion');
    const changed = await e.DB.prepare(
      `UPDATE device_actions SET status = ?, completed_at = ?, result_json = ?
       WHERE id = ? AND device_id = ? AND status = 'delivered' AND expires_at > ?`,
    ).bind(canonical.result.outcome, t, canonical.json, actionResultMatch[1], a.deviceId, t).run();
    if (!changed.meta.changes) throw new ApiError(409, 'ACTION_STATE_CHANGED', 'Action state changed');
    const row = await e.DB.prepare('SELECT * FROM device_actions WHERE id = ?').bind(actionResultMatch[1]).first<Row>();
    return Response.json({ action: publicAction(row!) });
  }

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
    await rateLimitDiagnostics(e, req, a.userId);
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
    // 200 on a replay, 201 on a new segment: the client advances its cursor on
    // either, but the distinction is what makes a cursor bug visible in logs.
    return Response.json(
      { segment: { id: stored.id, receivedAt: stored.receivedAt } },
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
    await rateLimitTelemetry(e, req, a.userId);
    return Response.json(
      await storeTelemetryWindow(
        e,
        a.userId,
        a.deviceId,
        parsed.appVersion,
        parsed.osVersion,
        parsed.windowStartMs,
        parsed.windowEndMs,
        parsed.json,
      ),
      { status: 201 },
    );
  }

  if (p === '/api/v1/routing-research/snapshots' && m === 'POST') {
    const a = await auth(req, e);
    const declaredOwner = req.headers.get('X-Tono-Routing-Owner');
    if (declaredOwner === null || !/^[0-9a-f]{64}$/.test(declaredOwner) ||
        declaredOwner !== await sha256Hex(a.userId)) {
      // A conflict (rather than 401) prevents an old account's request from
      // triggering token refresh and being replayed under a newer account.
      throw new ApiError(
        409,
        'ROUTING_RESEARCH_OWNER_MISMATCH',
        'Routing research owner does not match the authenticated account',
      );
    }
    // Request-level limits cover malformed bodies, replays, and conflicts. The
    // tighter limiter below applies only to distinct accepted snapshots.
    await consumeRateLimit(
      e,
      `rl:${await sha256(`routing-research:request-device:${a.deviceId}`)}`,
      envInt(e, 'RATE_LIMIT_ROUTING_RESEARCH_DEVICE_REQUEST_DAY', 100),
      ROUTING_RESEARCH_DAY_SECONDS,
    );
    const b = await body(req, 8 * 1024);
    const { snapshot, json } = canonicalRoutingResearch(b);
    const existing = await e.DB.prepare(
      `SELECT aggregate_json, received_at
       FROM routing_research_snapshots
       WHERE device_id = ? AND snapshot_id = ?`,
    ).bind(a.deviceId, snapshot.snapshotId).first<Row>();
    if (existing) {
      if (existing.aggregate_json !== json) throw new ApiError(409, 'SNAPSHOT_ID_CONFLICT', 'Snapshot ID was already used');
      return Response.json({ snapshotId: snapshot.snapshotId, receivedAt: Number(existing.received_at) });
    }
    await consumeRateLimit(
      e,
      `rl:${await sha256(`routing-research:new-device:${a.deviceId}`)}`,
      envInt(e, 'RATE_LIMIT_ROUTING_RESEARCH_DEVICE_DAY', 4),
      ROUTING_RESEARCH_DAY_SECONDS,
    );
    const receivedAt = now();
    const inserted = await e.DB.prepare(
      `INSERT INTO routing_research_snapshots(
         id, snapshot_id, user_id, device_id, received_at, observed_since,
         observed_until, app_version, build, os_version, architecture,
         aggregate_json
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(device_id, snapshot_id) DO NOTHING`,
    ).bind(
      id(), snapshot.snapshotId, a.userId, a.deviceId, receivedAt,
      snapshot.observedSince, snapshot.observedUntil, snapshot.appVersion,
      snapshot.build, snapshot.osVersion, snapshot.architecture, json,
    ).run();
    if (!inserted.meta.changes) {
      const replay = await e.DB.prepare(
        `SELECT aggregate_json, received_at
         FROM routing_research_snapshots
         WHERE device_id = ? AND snapshot_id = ?`,
      ).bind(a.deviceId, snapshot.snapshotId).first<Row>();
      if (replay?.aggregate_json === json) {
        return Response.json({
          snapshotId: snapshot.snapshotId,
          receivedAt: Number(replay.received_at),
        });
      }
      throw new ApiError(
        409,
        'SNAPSHOT_ID_CONFLICT',
        'Snapshot ID was already used',
      );
    }
    return Response.json({ snapshotId: snapshot.snapshotId, receivedAt }, { status: 201 });
  }

  if (p === '/api/v1/devices' && m === 'GET') {
    const a = await auth(req, e);
    await expirePending(e, a.userId);
    // Revoked devices are dead weight in a management list: the client renders
    // every row it gets, so leaving them in makes a successful revoke look like
    // it did nothing.
    const q = await e.DB.prepare(
      "SELECT * FROM devices WHERE user_id = ? AND status != 'revoked' ORDER BY created_at DESC",
    ).bind(a.userId).all<Row>();
    return Response.json({ devices: q.results.map((x) => publicDevice(x, a.deviceId)) });
  }

  let mt = p.match(/^\/api\/v1\/devices\/([^/]+)$/);
  if (mt && m === 'DELETE') {
    const uid = await userId(req, e);
    const d = await e.DB.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').bind(mt[1], uid).first<Row>();
    if (!d) throw new ApiError(404, 'NOT_FOUND', 'Device not found');
    await revokeDevice(e, d);
    await processRevocations(e);
    return new Response(null, { status: 204 });
  }

  mt = p.match(/^\/api\/v1\/devices\/([^/]+)\/enrollment$/);
  if (mt && m === 'POST') {
    if (!tailscaleEnrollmentEnabled(e)) {
      throw new ApiError(410, 'TAILSCALE_DISABLED', 'Tailscale enrollment is temporarily disabled');
    }
    const a = await auth(req, e);
    if (a.deviceId !== mt[1]) throw new ApiError(404, 'NOT_FOUND', 'Device not found for this session');
    const b = await body(req, 4 * 1024);
    const requestedInstallation = str(b.installationId, 'installationId', 8, 200);
    if (requestedInstallation !== a.installationId) {
      throw new ApiError(404, 'NOT_FOUND', 'Device not found for this installation');
    }
    let d = await e.DB.prepare(
      "SELECT * FROM devices WHERE id = ? AND user_id = ? AND installation_id = ? AND status IN ('pending', 'active')",
    ).bind(mt[1], a.userId, a.installationId).first<Row>();
    if (!d) throw new ApiError(404, 'NOT_FOUND', 'Device not found for this installation');
    if (d.status === 'active') {
      const t = now();
      const generation = Number(d.claim_generation ?? 0);
      const [, r] = await e.DB.batch([
        e.DB.prepare(
          `INSERT INTO revocation_jobs(
             id, device_id, tailscale_node_id, created_at, ownership_generation, reason
           )
           SELECT ?, id, tailscale_node_id, ?, claim_generation, 'identity_reenrollment'
           FROM devices
           WHERE id = ? AND user_id = ? AND installation_id = ?
             AND status = 'active' AND claim_generation = ?
             AND tailscale_node_id IS NOT NULL
           ON CONFLICT(tailscale_node_id) DO UPDATE SET
             completed_at = NULL,
             last_error = NULL,
             device_id = excluded.device_id,
             created_at = excluded.created_at,
             ownership_generation = excluded.ownership_generation,
             reason = excluded.reason`,
        ).bind(id(), t, d.id, a.userId, a.installationId, generation),
        e.DB.prepare(
          `UPDATE devices SET
             status = 'pending',
             tailscale_node_id = NULL,
             tailscale_stable_id = NULL,
             tailscale_api_node_id = NULL,
             tailscale_public_key = NULL,
             tailscale_ips = NULL,
             claim_token = NULL,
             claim_expires_at = NULL,
             claim_generation = claim_generation + 1,
             pending_expires_at = ?,
             enrollment_issued_at = NULL,
             enrollment_hostname = NULL,
             confirmed_at = NULL,
             updated_at = ?
           WHERE id = ? AND user_id = ? AND installation_id = ?
             AND status = 'active' AND claim_generation = ?`,
        ).bind(
          t + envInt(e, 'PENDING_DEVICE_TTL_SECONDS', 1_800),
          t,
          d.id,
          a.userId,
          a.installationId,
          generation,
        ),
      ]);
      if (!r.meta.changes) throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device state changed');
      await processRevocations(e);
      d = (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(d.id).first<Row>())!;
    }
    if (d.pending_expires_at <= now()) throw new ApiError(404, 'NOT_FOUND', 'Pending device expired');
    return Response.json({ enrollment: await issueEnrollment(e, d) });
  }

  mt = p.match(/^\/api\/v1\/devices\/([^/]+)\/confirm$/);
  if (mt && m === 'POST') {
    if (!tailscaleEnrollmentEnabled(e)) {
      throw new ApiError(410, 'TAILSCALE_DISABLED', 'Tailscale enrollment is temporarily disabled');
    }
    const a = await auth(req, e);
    const b = await body(req, 16 * 1024);
    const device = await confirmDevice(e, a, mt[1], b);
    return Response.json({ device });
  }

  if (p === '/api/v1/ops-ingest/home-targets' && m === 'GET') {
    if (typeof e.OPS_COLLECTOR_TOKEN !== 'string' || e.OPS_COLLECTOR_TOKEN.length < 32) {
      throw new ApiError(503, 'OPS_INGEST_UNCONFIGURED', 'Collector ingest is not configured');
    }
    await privileged(req, e.OPS_COLLECTOR_TOKEN);
    const q = await e.DB.prepare(
      `SELECT id, socks5_host, socks5_port FROM home_exits
       WHERE kind = 'socks5' AND status = 'active' AND socks5_host IS NOT NULL AND socks5_port IS NOT NULL
       LIMIT 200`,
    ).all<Row>();
    return Response.json({
      targets: q.results.map((row) => ({
        id: String(row.id),
        host: String(row.socks5_host),
        port: Number(row.socks5_port),
      })),
    });
  }

  // The roster the node client lists are reconciled against.
  //
  // Same rows as `/api/v1/home/exit-identities`, which the home agent reads
  // with its own token; this exists so the collector can drive node sync with
  // the token it already holds, rather than widening the home agent's.
  if (p === '/api/v1/ops-ingest/node-clients' && m === 'GET') {
    if (typeof e.OPS_COLLECTOR_TOKEN !== 'string' || e.OPS_COLLECTOR_TOKEN.length < 32) {
      throw new ApiError(503, 'OPS_INGEST_UNCONFIGURED', 'Collector ingest is not configured');
    }
    await privileged(req, e.OPS_COLLECTOR_TOKEN);
    const t = now();

    // Identities are otherwise minted lazily, on a catalog fetch, and only when
    // the catalog carries the placeholder. The published catalog is still the
    // legacy one with a literal shared UUID, so that branch has never run and
    // `exit_credentials` is empty — which deadlocks the cutover: the nodes need
    // the credentials before the catalog can carry the placeholder, and the
    // credentials were only created by serving that catalog.
    //
    // So the roster mints what is missing. `exitClientUUID` is unchanged and
    // still adopts whatever row exists, so an account that fetches a catalog
    // later is served the same identity this created.
    const pending = await e.DB.prepare(
      `SELECT users.id AS id
         FROM users
         LEFT JOIN exit_credentials ON exit_credentials.user_id = users.id
        WHERE exit_credentials.user_id IS NULL
          AND users.status = 'active'
          AND (users.expires_at IS NULL OR users.expires_at > ?)
          AND (users.quota_bytes IS NULL OR users.usage_bytes < users.quota_bytes)
        ORDER BY users.id
        LIMIT 500`,
    ).bind(t).all<Row>();
    if (pending.results.length) {
      await e.DB.batch(pending.results.map((row) => e.DB.prepare(
        'INSERT OR IGNORE INTO exit_credentials(user_id, client_uuid, created_at) VALUES(?,?,?)',
      ).bind(String(row.id), crypto.randomUUID(), t)));
    }

    const rows = await e.DB.prepare(
      `SELECT exit_credentials.user_id AS user_id, exit_credentials.client_uuid AS client_uuid
         FROM exit_credentials
         JOIN users ON users.id = exit_credentials.user_id
        WHERE users.status = 'active'
          AND (users.expires_at IS NULL OR users.expires_at > ?)
          AND (users.quota_bytes IS NULL OR users.usage_bytes < users.quota_bytes)
        ORDER BY exit_credentials.user_id`,
    ).bind(t).all<Row>();
    return Response.json({
      // Echoed so a reconciling agent can tell a stale response from an empty
      // roster: applying an empty list as if it were current would remove every
      // managed client from every node at once.
      observedAt: t,
      clients: rows.results.map((row) => ({
        userId: String(row.user_id),
        clientUUID: String(row.client_uuid),
        // The label per-user traffic accounting is keyed by. Namespaced so a
        // reconciler can tell the clients it owns from `shared-legacy` and the
        // hand-added entries it must never touch.
        email: `u:${String(row.user_id)}`,
      })),
    });
  }

  if (p === '/api/v1/ops-ingest/snapshot' && m === 'PUT') {
    if (typeof e.OPS_COLLECTOR_TOKEN !== 'string' || e.OPS_COLLECTOR_TOKEN.length < 32) {
      throw new ApiError(503, 'OPS_INGEST_UNCONFIGURED', 'Collector ingest is not configured');
    }
    await privileged(req, e.OPS_COLLECTOR_TOKEN);
    const payload = await body(req, 768 * 1024);
    rejectUnexpectedKeys(payload, ['report', 'agents', 'homeProbes']);
    if (payload.report === undefined && payload.agents === undefined && payload.homeProbes === undefined) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'report, agents or homeProbes is required');
    }
    const receivedAt = now();
    let quality = payload.report === undefined
      ? undefined
      : liveQualityReport(payload.report, receivedAt);
    if (payload.report !== undefined && !quality) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid quality report');
    }
    let agents = payload.agents === undefined ? undefined : liveAgents(payload.agents, receivedAt);
    if (payload.agents !== undefined && !agents) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid agent inventory');
    }
    // A collector that reaches Komari but gets an empty answer must not wipe
    // the live view: storing "[]" with a fresh timestamp flips every node to
    // "missing" with a current snapshot vouching for it. Keep the stored list
    // (and its age) and tell the collector, the same way the node-clients
    // roster refuses to apply an empty list. An empty list is still accepted
    // when nothing is stored yet.
    let reportIgnoredEmpty = false;
    let agentsIgnoredEmpty = false;
    if ((quality && quality.nodes.length === 0) || (agents && agents.length === 0)) {
      const current = await storedLiveSnapshot(e);
      if (quality && quality.nodes.length === 0 && current?.quality_json) {
        const storedQuality = JSON.parse(String(current.quality_json)) as Row | null;
        if (storedQuality && Array.isArray(storedQuality.nodes) && storedQuality.nodes.length > 0) {
          quality = undefined;
          reportIgnoredEmpty = true;
        }
      }
      if (agents && agents.length === 0 && current?.agents_json) {
        const storedAgents = JSON.parse(String(current.agents_json)) as unknown;
        if (Array.isArray(storedAgents) && storedAgents.length > 0) {
          agents = undefined;
          agentsIgnoredEmpty = true;
        }
      }
    }
    let probesUpdated = 0;
    const acceptedProbes: Array<{ id: string; status: 'alive' | 'dead' }> = [];
    if (payload.homeProbes !== undefined) {
      if (!Array.isArray(payload.homeProbes) || payload.homeProbes.length > 200) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid homeProbes');
      }
      const t = now();
      const validated: Array<{ id: string; status: 'alive' | 'dead' }> = [];
      for (const raw of payload.homeProbes) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid homeProbes');
        }
        const probe = raw as Row;
        const probeId = str(probe.id, 'id', 1, 100);
        const status = str(probe.status, 'status', 1, 20);
        if (status !== 'alive' && status !== 'dead') {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid home probe status');
        }
        validated.push({ id: probeId, status });
      }
      if (validated.length) {
        const results = await e.DB.batch(validated.map((probe) => e.DB.prepare(
          `UPDATE home_exits SET last_probed_at = ?, probe_status = ?, updated_at = updated_at
           WHERE id = ? AND kind = 'socks5'`,
        ).bind(t, probe.status, probe.id)));
        results.forEach((result, index) => {
          if (result.meta.changes) {
            probesUpdated += 1;
            acceptedProbes.push(validated[index]);
          }
        });
      }
      if (acceptedProbes.length) {
        await recordHomeProbeSamples(e.DB, acceptedProbes, t);
      }
    }
    const stored = payload.report === undefined && payload.agents === undefined
      ? { qualityUpdatedAt: null, agentsUpdatedAt: null, updatedAt: now() }
      : await storeLiveSnapshot(e, {
        quality: quality ?? undefined,
        agents: agents ?? undefined,
      });
    if (agents) {
      await recordAgentSamples(e.DB, agents as Array<{
        name: string;
        cpu: number | null;
        cpuCores: number | null;
        memTotal: number | null;
        memUsed: number | null;
        diskTotal: number | null;
        diskUsed: number | null;
        netIn: number | null;
        netOut: number | null;
        load1: number | null;
        load5: number | null;
        load15: number | null;
        swapTotal: number | null;
        swapUsed: number | null;
        tcpConnections: number | null;
        processes: number | null;
        uptime: number | null;
        observedAt: number | null;
      }>, stored.updatedAt);
    }
    if (quality?.nodes.length) {
      await recordQualitySamples(
        e.DB,
        quality.nodes.map((node) => ({
          name: String(node.name),
          ok: node.ok === true,
          quality: typeof node.quality === 'string' ? node.quality : null,
          blockStatus: node.block && typeof node.block === 'object'
            ? (optionalText((node.block as Row).status) ?? null)
            : null,
        })),
        stored.updatedAt,
      );
    }
    return Response.json({
      ok: true,
      qualityNodes: quality?.nodes.length ?? null,
      agentCount: agents?.length ?? null,
      homeProbesUpdated: probesUpdated,
      ...(reportIgnoredEmpty ? { reportIgnoredEmpty: true } : {}),
      ...(agentsIgnoredEmpty ? { agentsIgnoredEmpty: true } : {}),
      ...stored,
    });
  }

  if (p.startsWith('/api/v1/ops/')) {
    const actor = await operationsAdmin(req, e);
    const shared = await sharedAdministrativeResource(
      req, e, p.slice('/api/v1/ops/'.length), m, actor.email,
    );
    if (shared) return shared;

    const opsCache: OpsRequestCache = {};

    // --- Product ops reads (Cloudflare Access) ---
    if (m === 'GET') {
      if (p === '/api/v1/ops/dashboard') {
        return Response.json({ dashboard: await operationsDashboard(e, opsCache) });
      }
      if (p === '/api/v1/ops/system/version') {
        return Response.json({ system: { service: 'api', version: '0.0.1', buildSha: buildSha(e) } });
      }
      if (p === '/api/v1/ops/fleet-nodes') {
        return Response.json(await operationsFleetNodes(e, opsCache));
      }
      mt = p.match(/^\/api\/v1\/ops\/fleet-nodes\/([^/]+)\/retire-preview$/);
      if (mt) {
        const { nextYaml: _nextYaml, ...preview } = await operationsRetirePreview(e, fleetNodeName(mt[1]), opsCache);
        return Response.json(preview);
      }
      mt = p.match(/^\/api\/v1\/ops\/fleet-nodes\/([^/]+)\/quality-text$/);
      if (mt) {
        const node = await liveQualityNodeNamed(e, fleetNodeName(mt[1]));
        return Response.json({
          securityCheck: liveBoundedText(node?.securityCheck),
          backtrace: liveBoundedText(node?.backtrace),
        });
      }
      if (p === '/api/v1/ops/catalog-revisions') {
        return Response.json({ revisions: await operationsCatalogRevisions(e) });
      }
      if (p === '/api/v1/ops/users') {
        const url = new URL(req.url);
        const rawLimit = url.searchParams.get('limit');
        let limit: number | null = null;
        if (rawLimit !== null) {
          limit = Number(rawLimit);
          if (!Number.isSafeInteger(limit) || limit < 1 || limit > OPS_USERS_PAGE_LIMIT) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid limit');
          }
        }
        const rawCursor = url.searchParams.get('cursor');
        let cursor: { createdAt: number; id: string } | null = null;
        if (rawCursor !== null) {
          const parsed = rawCursor.match(/^(\d{1,12}):(.{1,100})$/);
          if (!parsed) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cursor');
          cursor = { createdAt: Number(parsed[1]), id: parsed[2] };
        }
        return Response.json(await operationsUsers(e, { cursor, limit }));
      }
      if (p === '/api/v1/ops/signup-allowlist') {
        const q = await e.DB.prepare(
          'SELECT email, created_at FROM signup_allowlist ORDER BY created_at DESC, email ASC',
        ).all<Row>();
        return Response.json({
          entries: q.results.map((entry) => ({
            email: String(entry.email),
            createdAt: Number(entry.created_at),
          })),
        });
      }
      if (p === '/api/v1/ops/live') {
        return Response.json({ live: await operationsLive(e, opsCache) });
      }
      if (p === '/api/v1/ops/metrics') {
        const url = new URL(req.url);
        const range = url.searchParams.get('range');
        if (range !== null && !['24h', '7d', '90d'].includes(range)) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported metrics range');
        }
        const rawFields = url.searchParams.get('fields');
        let fields: string[] | null = null;
        if (rawFields !== null) {
          fields = rawFields.split(',').map((field) => field.trim()).filter(Boolean);
          if (fields.length === 0 || !fields.every(isMetricField)) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported metrics field');
          }
        }
        return Response.json({
          metrics: await queryAgentMetrics(e.DB, {
            range,
            node: url.searchParams.get('node'),
            nowUnix: now(),
            fields,
          }),
        });
      }
      if (p === '/api/v1/ops/usage-hours') {
        const url = new URL(req.url);
        const range = url.searchParams.get('range');
        const hours = range === '7d' ? 24 * 7 : range === '90d' ? 24 * 90 : 24;
        if (range !== null && !['24h', '7d', '90d'].includes(range)) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported usage-hours range');
        }
        return Response.json({
          usageHours: await queryUserUsageHours(e.DB, now(), hours),
        });
      }
      if (p === '/api/v1/ops/activity') {
        return Response.json({ activity: await operationsActivity(e, opsCache) });
      }
      mt = p.match(/^\/api\/v1\/ops\/users\/([^/]+)\/home-binding$/);
      if (mt) {
        const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(mt[1]).first<Row>();
        if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
        const row = await e.DB.prepare(
          `SELECT
             user_home_bindings.user_id,
             users.email,
             user_home_bindings.home_exit_id,
             user_home_bindings.default_proxy_name,
             home_exits.proxy_name,
             home_exits.display_name,
             home_exits.kind,
             home_exits.socks5_host,
             home_exits.socks5_port,
             home_exits.egress_ipv4,
             home_exits.status AS home_status,
             user_home_bindings.created_at,
             user_home_bindings.updated_at
           FROM user_home_bindings
           JOIN users ON users.id = user_home_bindings.user_id
           JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
           WHERE user_home_bindings.user_id = ?`,
        ).bind(mt[1]).first<Row>();
        return Response.json({ binding: row ? publicHomeBinding(row) : null });
      }
      mt = p.match(/^\/api\/v1\/ops\/users\/([^/]+)\/detail$/);
      if (mt) {
        const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(mt[1]).first<Row>();
        if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
        const devices = await e.DB.prepare(
          'SELECT id, name, status, created_at, updated_at FROM devices WHERE user_id = ? ORDER BY created_at DESC',
        ).bind(mt[1]).all<Row>();
        const reports = await e.DB.prepare(
          `SELECT reference_code, received_at, client_version, os_version, report_json
           FROM diagnostics_reports WHERE user_id = ? ORDER BY received_at DESC LIMIT 20`,
        ).bind(mt[1]).all<Row>();
        const accounts = await e.DB.prepare(
          'SELECT * FROM product_accounts WHERE user_id = ? ORDER BY created_at DESC',
        ).bind(mt[1]).all<Row>();
        const events = await e.DB.prepare(
          'SELECT * FROM product_account_events WHERE user_id = ? ORDER BY at DESC LIMIT 50',
        ).bind(mt[1]).all<Row>();
        const activity = await e.DB.prepare(
          `SELECT received_at, client_version, os_version, payload_json
           FROM telemetry_windows WHERE user_id = ? ORDER BY received_at DESC LIMIT 1`,
        ).bind(mt[1]).first<Row>();
        let heartbeat: Row | null = null;
        if (activity) {
          let payload: Row = {};
          try {
            payload = JSON.parse(String(activity.payload_json));
          } catch {
            payload = {};
          }
          const selectedServer = typeof payload.selectedServer === 'string' ? payload.selectedServer : null;
          heartbeat = {
            lastSeenAt: Number(activity.received_at),
            clientVersion: String(activity.client_version),
            osVersion: String(activity.os_version),
            selectedServer,
            uiState: typeof payload.uiState === 'string' ? payload.uiState : null,
            ...telemetryPathFields(payload, Number(activity.received_at)),
            ...nodeHealthFromQuality(await liveQualityNodeNamed(e, selectedServer)),
          };
        }
        return Response.json({
          devices: devices.results.map((d) => ({
            id: String(d.id),
            name: String(d.name),
            status: String(d.status),
            createdAt: Number(d.created_at),
            updatedAt: Number(d.updated_at),
          })),
          diagnostics: reports.results.map((r) => ({
            referenceCode: String(r.reference_code),
            receivedAt: Number(r.received_at),
            clientVersion: String(r.client_version),
            osVersion: String(r.os_version),
            reportJson: String(r.report_json),
          })),
          product: {
            accounts: accounts.results.map(publicProductAccount),
            events: events.results.map(publicProductEvent),
            replaceCount: await replaceCountForUser(e, mt[1]),
          },
          heartbeat,
        });
      }
      mt = p.match(/^\/api\/v1\/ops\/incidents\/node\/([^/]+)$/);
      if (mt) {
        const name = decodeURIComponent(mt[1]);
        if (!name || name.length > 200) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid node name');
        const activity = await operationsActivity(e, opsCache);
        const affected = activity.users.filter((user) => user.selectedServer === name);
        return Response.json({
          node: name,
          onlineWindowSeconds: activity.onlineWindowSeconds,
          affected,
        });
      }
      throw new ApiError(404, 'NOT_FOUND', 'Route not found');
    }

    mt = p.match(/^\/api\/v1\/ops\/fleet-nodes\/([^/]+)\/retire$/);
    if (mt && m === 'POST') {
      const b = await body(req, 8 * 1024);
      return Response.json(await retireFleetNode(e, actor.email, fleetNodeName(mt[1]), b, opsCache));
    }

    // --- Product ops writes (same Access boundary; no ADMIN_API_TOKEN in browser) ---
    if (p === '/api/v1/ops/signup-allowlist' && m === 'DELETE') {
      const b = await body(req, 4 * 1024);
      const address = email(b.email);
      const deleted = await e.DB.prepare('DELETE FROM signup_allowlist WHERE email = ?').bind(address).run();
      if (deleted.meta.changes) {
        await writeOpsAudit(e, actor.email, 'allowlist.remove', 'signup_allowlist', address, address);
      }
      return new Response(null, { status: 204 });
    }
    if (p === '/api/v1/ops/users/onboard' && m === 'POST') {
      const b = await body(req, 16 * 1024);
      rejectUnexpectedKeys(b, [
        'email', 'line', 'homeExitId', 'accountRef', 'productAccountId', 'openedAt', 'notes', 'contact',
      ]);
      const address = email(b.email);
      const createdAt = now();
      await e.DB.prepare(
        'INSERT OR IGNORE INTO signup_allowlist(email, created_at) VALUES(?, ?)',
      ).bind(address, createdAt).run();
      const user = await e.DB.prepare('SELECT * FROM users WHERE email = ?').bind(address).first<Row>();
      const incomplete: string[] = [];
      if (!user) incomplete.push('user_not_registered');
      let binding = null;
      let account = null;
      let exitIdentityIssued = false;
      if (user) {
        await exitClientUUID(e, String(user.id));
        exitIdentityIssued = true;
        if (b.notes !== undefined || b.contact !== undefined) {
          await e.DB.prepare(
            `UPDATE users SET
               notes = CASE WHEN ? THEN ? ELSE notes END,
               contact = CASE WHEN ? THEN ? ELSE contact END,
               updated_at = ?
             WHERE id = ?`,
          ).bind(
            b.notes !== undefined, optionalNotes(b.notes),
            b.contact !== undefined, optionalNotes(b.contact, 'contact', 200),
            now(), user.id,
          ).run();
        }
        if (b.line !== undefined && b.line !== null && b.line !== '') {
          const assigned = await sharedAdministrativeResource(
            new Request(req.url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                userId: user.id,
                line: b.line,
                replace: true,
              }),
            }),
            e, 'home-exits/assign', 'POST', actor.email,
          );
          if (!assigned || !assigned.ok) {
            throw new ApiError(assigned?.status ?? 400, 'HOME_ASSIGN_FAILED', 'Could not assign the pasted home line');
          }
        } else if (b.homeExitId) {
          const homeExitId = str(b.homeExitId, 'homeExitId', 1, 100);
          const existing = await loadHomeBinding(e, String(user.id));
          await upsertHomeBinding(
            e, String(user.id), homeExitId,
            existing?.default_proxy_name == null ? null : String(existing.default_proxy_name),
          );
          await bumpCatalogRevision(e);
          await enqueueRefreshCatalogForUser(e, String(user.id));
        }
        binding = await loadHomeBinding(e, String(user.id));
        if (b.accountRef) {
          account = await createAssignedProductAccount(
            e, String(user.id), accountRefField(b.accountRef),
            optionalUnix(b.openedAt, 'openedAt') ?? now(),
            optionalNotes(b.notes), actor.email,
          );
        } else if (b.productAccountId) {
          const pooled = await e.DB.prepare(
            'SELECT account_ref FROM product_accounts WHERE id = ?',
          ).bind(str(b.productAccountId, 'productAccountId', 1, 100)).first<Row>();
          if (!pooled) throw new ApiError(404, 'NOT_FOUND', 'Product account not found');
          account = await createAssignedProductAccount(
            e, String(user.id), String(pooled.account_ref),
            optionalUnix(b.openedAt, 'openedAt') ?? now(),
            optionalNotes(b.notes), actor.email,
          );
        } else {
          account = await assignedProductForUser(e, String(user.id));
        }
        if (!account) incomplete.push('claude');
      }
      await writeOpsAudit(e, actor.email, 'user.onboard', 'user', user ? String(user.id) : null, address);
      return Response.json({
        email: address,
        userId: user ? String(user.id) : null,
        allowlisted: true,
        exitIdentityIssued,
        binding: binding ? publicHomeBinding(binding) : null,
        account: account ? publicProductAccount(account) : null,
        incomplete,
      }, { status: user && incomplete.length === 0 ? 200 : 202 });
    }
    mt = p.match(/^\/api\/v1\/ops\/users\/([^/]+)$/);
    if (mt && m === 'PATCH') {
      const b = await body(req, 16 * 1024);
      // A misspelled field used to return 200 and change nothing. For an
      // endpoint whose job includes clearing a billing cycle so a locked-out
      // customer can connect again, a silent success is the worst possible
      // answer: the operator believes the account was reset and only finds out
      // when the customer is still suspended.
      rejectUnexpectedKeys(b, ['status', 'expiresAt', 'notes', 'contact', 'plan', 'resetUsage']);
      const status = b.status;
      const expiresAt = b.expiresAt;
      // The console is where a quota lockout is noticed — the dashboard raises
      // "已超配额" from this same data — so it is where ending the cycle has to
      // be possible. It lived only on the token-admin endpoint, which meant the
      // one documented remedy for a paying customer who cannot connect was a
      // hand-written API call.
      //
      // Ending a cycle, not editing a number: the collector re-sends a
      // fleet-wide cumulative total every ten minutes and the write is a MAX(),
      // so zeroing `usage_bytes` alone is undone within ten minutes. Moving the
      // baseline up to the reported counter is what actually clears it.
      const resetUsage = b.resetUsage;
      if (resetUsage !== undefined && resetUsage !== true) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'resetUsage may only be true');
      }
      if (status !== undefined && !['active', 'disabled'].includes(status)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
      }
      if (
        expiresAt !== undefined &&
        expiresAt !== null &&
        (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
      ) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid expiresAt');
      }
      if (
        status === undefined && expiresAt === undefined && resetUsage === undefined
        && b.notes === undefined && b.contact === undefined && b.plan === undefined
      ) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'status, expiresAt, notes, contact, plan or resetUsage is required');
      }
      if (status === 'active') {
        const residual = await e.DB.prepare(
          `SELECT
             users.status current_status,
             (SELECT COUNT(*) FROM devices
              WHERE user_id = ? AND status IN ('active', 'pending')) live_devices,
             (SELECT COUNT(*) FROM revocation_jobs
              JOIN devices ON devices.id = revocation_jobs.device_id
              WHERE devices.user_id = ? AND revocation_jobs.completed_at IS NULL) pending_jobs
           FROM users WHERE users.id = ?`,
        ).bind(mt[1], mt[1], mt[1]).first<Row>();
        if (!residual) throw new ApiError(404, 'NOT_FOUND', 'User not found');
        if (
          residual.current_status !== 'active' &&
          ((residual.live_devices ?? 0) > 0 || (residual.pending_jobs ?? 0) > 0)
        ) {
          throw new ApiError(409, 'REVOCATION_PENDING', 'Wait for tailnet device revocation before re-enabling this user');
        }
      }
      if (b.plan !== undefined && b.plan !== null && b.plan !== '' && b.plan !== PRODUCT_CLAUDE) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid plan');
      }
      const updated = await e.DB.prepare(
        `UPDATE users SET
           status = COALESCE(?, status),
           expires_at = CASE WHEN ? THEN ? ELSE expires_at END,
           notes = CASE WHEN ? THEN ? ELSE notes END,
           contact = CASE WHEN ? THEN ? ELSE contact END,
           plan = CASE WHEN ? THEN ? ELSE plan END,
           usage_baseline_bytes = CASE WHEN ? THEN usage_reported_bytes ELSE usage_baseline_bytes END,
           usage_bytes = CASE WHEN ? THEN 0 ELSE usage_bytes END,
           updated_at = ?
         WHERE id = ?`,
      ).bind(
        status ?? null,
        expiresAt !== undefined,
        expiresAt ?? null,
        b.notes !== undefined,
        b.notes === undefined ? null : optionalNotes(b.notes),
        b.contact !== undefined,
        b.contact === undefined ? null : optionalNotes(b.contact, 'contact', 200),
        b.plan !== undefined,
        b.plan === undefined || b.plan === null || b.plan === '' ? null : PRODUCT_CLAUDE,
        resetUsage === true,
        resetUsage === true,
        now(),
        mt[1],
      ).run();
      if (!updated.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'User not found');
      if (resetUsage === true) {
        await writeOpsAudit(e, actor.email, 'user.usage-reset', 'user', mt[1], 'billing cycle reset');
      }
      const changedFields = [
        status !== undefined ? 'status' : null,
        expiresAt !== undefined ? 'expiresAt' : null,
        b.notes !== undefined ? 'notes' : null,
        b.contact !== undefined ? 'contact' : null,
        b.plan !== undefined ? 'plan' : null,
      ].filter((name): name is string => name !== null);
      if (changedFields.length) {
        await writeOpsAudit(e, actor.email, 'user.update', 'user', mt[1], `changed ${changedFields.join(', ')}`);
      }
      await enforceUser(e, mt[1]);
      return Response.json({ ok: true });
    }

    return new Response(null, {
      status: 405,
      headers: { allow: 'GET, POST, PUT, PATCH, DELETE' },
    });
  }

  if (p.startsWith('/api/v1/admin/')) {
    await privileged(req, e.ADMIN_API_TOKEN);
    const shared = await sharedAdministrativeResource(
      req, e, p.slice('/api/v1/admin/'.length), m, 'token-admin',
    );
    if (shared) return shared;
    if (p === '/api/v1/admin/routing-research/summary' && m === 'GET') {
      let unexpectedQuery = false;
      url.searchParams.forEach((_value, key) => { if (key !== 'days') unexpectedQuery = true; });
      if (unexpectedQuery) throw new ApiError(400, 'VALIDATION_ERROR', 'Unexpected query parameter');
      const rawDays = url.searchParams.get('days');
      const days = rawDays === null ? 30 : Number(rawDays);
      if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid days');
      const timestamp = now();
      const since = timestamp - days * ROUTING_RESEARCH_DAY_SECONDS;
      // Filter by when traffic was observed rather than delayed receipt time.
      // JSON1 expands only the canonical fixed-vocabulary entries; grouping is
      // done in D1 so no per-user rows enter the API process or response.
      const overall = await e.DB.prepare(
        `SELECT COUNT(*) snapshot_count,
                COUNT(DISTINCT user_id) participant_count,
                COUNT(DISTINCT device_id) device_count
         FROM routing_research_snapshots
         WHERE observed_until >= ? AND observed_until <= ?`,
      ).bind(since, timestamp).first<Row>();
      const participantCount = Number(overall?.participant_count ?? 0);
      if (participantCount < ROUTING_RESEARCH_MIN_SUMMARY_PARTICIPANTS) {
        return Response.json({
          days,
          cohortMinimum: ROUTING_RESEARCH_MIN_SUMMARY_PARTICIPANTS,
          suppressed: true,
          byApp: [],
          byBundleComponent: [],
          byBuild: [],
        });
      }
      const appRows = await e.DB.prepare(
        `WITH filtered AS (
           SELECT user_id, device_id, aggregate_json
           FROM routing_research_snapshots
           WHERE observed_until >= ? AND observed_until <= ?
         ), entries AS (
           SELECT filtered.user_id, filtered.device_id,
                  json_extract(item.value, '$.app') app,
                  json_extract(item.value, '$.connectionCount') connection_count,
                  json_extract(item.value, '$.directConnectionCount') direct_count,
                  json_extract(item.value, '$.proxiedConnectionCount') proxied_count,
                  json_extract(item.value, '$.blockedConnectionCount') blocked_count,
                  json_extract(item.value, '$.trafficVolume') traffic_volume
           FROM filtered, json_each(filtered.aggregate_json, '$.entries') item
         )
         SELECT app, COUNT(DISTINCT user_id) participant_count,
                COUNT(DISTINCT device_id) device_count,
                COUNT(*) snapshot_count,
                SUM(connection_count) connection_count,
                SUM(direct_count) direct_count,
                SUM(proxied_count) proxied_count,
                SUM(blocked_count) blocked_count,
                SUM(CASE WHEN traffic_volume = 'none' THEN 1 ELSE 0 END) volume_none,
                SUM(CASE WHEN traffic_volume = 'under_1_mib' THEN 1 ELSE 0 END) volume_under_1_mib,
                SUM(CASE WHEN traffic_volume = '1_to_10_mib' THEN 1 ELSE 0 END) volume_1_to_10_mib,
                SUM(CASE WHEN traffic_volume = '10_to_100_mib' THEN 1 ELSE 0 END) volume_10_to_100_mib,
                SUM(CASE WHEN traffic_volume = '100_mib_to_1_gib' THEN 1 ELSE 0 END) volume_100_mib_to_1_gib,
                SUM(CASE WHEN traffic_volume = '1_to_10_gib' THEN 1 ELSE 0 END) volume_1_to_10_gib,
                SUM(CASE WHEN traffic_volume = 'over_10_gib' THEN 1 ELSE 0 END) volume_over_10_gib
         FROM entries
         GROUP BY app
         HAVING COUNT(DISTINCT user_id) >= 3
         ORDER BY participant_count DESC, device_count DESC, app`,
      ).bind(since, timestamp).all<Row>();
      const componentRows = await e.DB.prepare(
        `WITH filtered AS (
           SELECT user_id, device_id, aggregate_json
           FROM routing_research_snapshots
           WHERE observed_until >= ? AND observed_until <= ?
         ), components AS (
           SELECT filtered.user_id, filtered.device_id,
                  json_extract(item.value, '$.app') app,
                  json_extract(item.value, '$.bundleComponent') bundle_component,
                  json_extract(item.value, '$.connectionCount') connection_count,
                  json_extract(item.value, '$.directConnectionCount') direct_count,
                  json_extract(item.value, '$.proxiedConnectionCount') proxied_count,
                  json_extract(item.value, '$.blockedConnectionCount') blocked_count,
                  json_extract(item.value, '$.trafficVolume') traffic_volume
           FROM filtered,
                json_each(filtered.aggregate_json, '$.bundleComponents') item
         )
         SELECT app, bundle_component,
                COUNT(DISTINCT user_id) participant_count,
                COUNT(DISTINCT device_id) device_count,
                COUNT(*) snapshot_count,
                SUM(connection_count) connection_count,
                SUM(direct_count) direct_count,
                SUM(proxied_count) proxied_count,
                SUM(blocked_count) blocked_count,
                SUM(CASE WHEN traffic_volume = 'none' THEN 1 ELSE 0 END) volume_none,
                SUM(CASE WHEN traffic_volume = 'under_1_mib' THEN 1 ELSE 0 END) volume_under_1_mib,
                SUM(CASE WHEN traffic_volume = '1_to_10_mib' THEN 1 ELSE 0 END) volume_1_to_10_mib,
                SUM(CASE WHEN traffic_volume = '10_to_100_mib' THEN 1 ELSE 0 END) volume_10_to_100_mib,
                SUM(CASE WHEN traffic_volume = '100_mib_to_1_gib' THEN 1 ELSE 0 END) volume_100_mib_to_1_gib,
                SUM(CASE WHEN traffic_volume = '1_to_10_gib' THEN 1 ELSE 0 END) volume_1_to_10_gib,
                SUM(CASE WHEN traffic_volume = 'over_10_gib' THEN 1 ELSE 0 END) volume_over_10_gib
         FROM components
         GROUP BY app, bundle_component
         HAVING COUNT(DISTINCT user_id) >= 3
         ORDER BY participant_count DESC, device_count DESC, app,
                  bundle_component`,
      ).bind(since, timestamp).all<Row>();
      const buildRows = await e.DB.prepare(
        `SELECT app_version, build,
                COUNT(DISTINCT user_id) participant_count,
                COUNT(DISTINCT device_id) device_count,
                COUNT(*) snapshot_count
         FROM routing_research_snapshots
         WHERE observed_until >= ? AND observed_until <= ?
         GROUP BY app_version, build
         HAVING COUNT(DISTINCT user_id) >= 3
         ORDER BY participant_count DESC, app_version DESC, build DESC`,
      ).bind(since, timestamp).all<Row>();
      return Response.json({
        days,
        cohortMinimum: ROUTING_RESEARCH_MIN_SUMMARY_PARTICIPANTS,
        participantCount,
        deviceCount: Number(overall?.device_count ?? 0),
        snapshotCount: Number(overall?.snapshot_count ?? 0),
        byApp: appRows.results.map((row) => ({
          app: String(row.app),
          participantCount: Number(row.participant_count),
          deviceCount: Number(row.device_count),
          snapshotCount: Number(row.snapshot_count),
          connectionCount: Number(row.connection_count),
          directConnectionCount: Number(row.direct_count),
          proxiedConnectionCount: Number(row.proxied_count),
          blockedConnectionCount: Number(row.blocked_count),
          trafficVolumes: {
            none: Number(row.volume_none),
            under_1_mib: Number(row.volume_under_1_mib),
            '1_to_10_mib': Number(row.volume_1_to_10_mib),
            '10_to_100_mib': Number(row.volume_10_to_100_mib),
            '100_mib_to_1_gib': Number(row.volume_100_mib_to_1_gib),
            '1_to_10_gib': Number(row.volume_1_to_10_gib),
            over_10_gib: Number(row.volume_over_10_gib),
          },
        })),
        byBundleComponent: componentRows.results.map((row) => ({
          app: String(row.app),
          bundleComponent: String(row.bundle_component),
          participantCount: Number(row.participant_count),
          deviceCount: Number(row.device_count),
          snapshotCount: Number(row.snapshot_count),
          connectionCount: Number(row.connection_count),
          directConnectionCount: Number(row.direct_count),
          proxiedConnectionCount: Number(row.proxied_count),
          blockedConnectionCount: Number(row.blocked_count),
          trafficVolumes: {
            none: Number(row.volume_none),
            under_1_mib: Number(row.volume_under_1_mib),
            '1_to_10_mib': Number(row.volume_1_to_10_mib),
            '10_to_100_mib': Number(row.volume_10_to_100_mib),
            '100_mib_to_1_gib': Number(row.volume_100_mib_to_1_gib),
            '1_to_10_gib': Number(row.volume_1_to_10_gib),
            over_10_gib: Number(row.volume_over_10_gib),
          },
        })),
        byBuild: buildRows.results.map((row) => ({
          appVersion: String(row.app_version),
          build: String(row.build),
          participantCount: Number(row.participant_count),
          deviceCount: Number(row.device_count),
          snapshotCount: Number(row.snapshot_count),
        })),
      });
    }

    mt = p.match(/^\/api\/v1\/admin\/diagnostics\/reports\/([^/]+)$/);
    if (mt && m === 'GET') {
      const row = await e.DB.prepare(
        'SELECT * FROM diagnostics_reports WHERE reference_code = ?',
      ).bind(normalizedReferenceCode(mt[1])).first<Row>();
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Diagnostics report not found');
      return Response.json({ report: publicDiagnosticsReport(row) });
    }
    if (p === '/api/v1/admin/telemetry/windows' && m === 'GET') {
      const userId = url.searchParams.get('userId');
      if (userId !== null && (userId.length < 1 || userId.length > 200)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid userId');
      }
      const q = userId
        ? await e.DB.prepare(
          'SELECT * FROM telemetry_windows WHERE user_id = ? ORDER BY received_at DESC LIMIT 100',
        ).bind(userId).all<Row>()
        : await e.DB.prepare(
          'SELECT * FROM telemetry_windows ORDER BY received_at DESC LIMIT 100',
        ).all<Row>();
      return Response.json({ windows: q.results.map(publicTelemetryWindow) });
    }
    if (p === '/api/v1/admin/diagnostics/logs' && m === 'GET') {
      const url = new URL(req.url);
      const userId = url.searchParams.get('userId');
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw === null
        ? 200
        : Math.min(Math.max(Number(limitRaw) || 0, 1), 1000);
      const rows = userId
        ? await e.DB.prepare(
          `SELECT * FROM diagnostics_log_objects WHERE user_id = ?
             ORDER BY received_at DESC LIMIT ?`,
        ).bind(userId, limit).all<Row>()
        : await e.DB.prepare(
          `SELECT * FROM diagnostics_log_objects
             ORDER BY received_at DESC LIMIT ?`,
        ).bind(limit).all<Row>();
      return Response.json({
        segments: rows.results.map((row) => ({
          id: String(row.id),
          userId: String(row.user_id),
          deviceId: row.device_id == null ? undefined : String(row.device_id),
          sessionId: String(row.session_id),
          sequence: Number(row.sequence),
          byteSize: Number(row.byte_size),
          lineCount: Number(row.line_count),
          receivedAt: Number(row.received_at),
          clientVersion: String(row.client_version),
          osVersion: String(row.os_version),
        })),
      });
    }
    mt = p.match(/^\/api\/v1\/admin\/diagnostics\/logs\/([^/]+)$/);
    if (mt && m === 'GET') {
      const row = await e.DB.prepare(
        'SELECT r2_key, session_id, sequence FROM diagnostics_log_objects WHERE id = ?',
      ).bind(mt[1]).first<Row>();
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Log segment not found');
      const object = await e.DIAGNOSTICS_LOGS.get(String(row.r2_key));
      // The index outlives a bucket lifecycle rule or a partial retention
      // sweep, so a missing object is an expected 404 rather than a 500.
      if (!object) throw new ApiError(404, 'NOT_FOUND', 'Log segment payload is gone');
      const name = `${row.session_id}-${String(row.sequence).padStart(7, '0')}.jsonl.gz`;
      return new Response(object.body, {
        headers: {
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="${name}"`,
          'cache-control': 'no-store',
        },
      });
    }
    if (p === '/api/v1/admin/signup-allowlist' && m === 'GET') {
      const q = await e.DB.prepare(
        'SELECT email, created_at FROM signup_allowlist ORDER BY created_at DESC, email ASC',
      ).all<Row>();
      return Response.json({
        entries: q.results.map((entry) => ({
          email: entry.email,
          createdAt: Number(entry.created_at),
        })),
      });
    }
    if (p === '/api/v1/admin/signup-allowlist' && m === 'DELETE') {
      const b = await body(req, 4 * 1024);
      await e.DB.prepare(
        'DELETE FROM signup_allowlist WHERE email = ?',
      ).bind(email(b.email)).run();
      return new Response(null, { status: 204 });
    }
    if (p === '/api/v1/admin/invitations' && m === 'GET') {
      const q = await e.DB.prepare(
        'SELECT id, email, expires_at, redeemed_at, created_at FROM invitations ORDER BY created_at DESC',
      ).all();
      return Response.json({ invitations: q.results });
    }
    if (p === '/api/v1/admin/invitations' && m === 'POST') {
      const b = await body(req, 16 * 1024);
      const code = randomToken(24);
      const t = now();
      const days = Number(b.expiresInDays ?? 7);
      if (!Number.isInteger(days) || days < 1 || days > 90) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid expiresInDays');
      }
      await e.DB.prepare(
        'INSERT INTO invitations(id, code_hash, email, expires_at, created_at) VALUES(?, ?, ?, ?, ?)',
      ).bind(id(), await sha256(code), email(b.email), t + days * 86400, t).run();
      return Response.json({ inviteCode: code, expiresAt: t + days * 86400 }, { status: 201 });
    }
    mt = p.match(/^\/api\/v1\/admin\/invitations\/([^/]+)$/);
    if (mt && m === 'DELETE') {
      await e.DB.prepare('DELETE FROM invitations WHERE id = ? AND redeemed_at IS NULL').bind(mt[1]).run();
      return new Response(null, { status: 204 });
    }
    if (p === '/api/v1/admin/users' && m === 'GET') {
      const q = await e.DB.prepare('SELECT * FROM users ORDER BY created_at DESC').all<Row>();
      return Response.json({ users: q.results.map(publicUser) });
    }
    mt = p.match(/^\/api\/v1\/admin\/users\/([^/]+)$/);
    if (mt && m === 'PATCH') {
      const b = await body(req, 16 * 1024);
      // A misspelled field used to return 200 and change nothing. For an
      // endpoint whose job includes clearing a billing cycle so a locked-out
      // customer can connect again, a silent success is the worst possible
      // answer: the operator believes the account was reset, and only the
      // customer finds out otherwise.
      rejectUnexpectedKeys(b, ['status', 'quotaBytes', 'deviceLimit', 'expiresAt', 'resetUsage']);
      const status = b.status;
      const quota = b.quotaBytes;
      // Ending a cycle, not editing a number. The collector keeps a fleet-wide
      // cumulative total and re-sends it every ten minutes, so zeroing
      // `usage_bytes` on its own would be undone by the next report; moving the
      // baseline to the counter is what actually clears the cycle.
      const resetUsage = b.resetUsage;
      if (resetUsage !== undefined && resetUsage !== true) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'resetUsage may only be true');
      }
      const deviceLimit = b.deviceLimit;
      const expiresAt = b.expiresAt;
      if (status !== undefined && !['active', 'disabled'].includes(status)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
      }
      if (
        expiresAt !== undefined &&
        expiresAt !== null &&
        (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
      ) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid expiresAt');
      }
      if (quota !== undefined && quota !== null && (!Number.isSafeInteger(quota) || quota < 0)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid quotaBytes');
      }
      if (
        deviceLimit !== undefined &&
        (!Number.isSafeInteger(deviceLimit) || deviceLimit < 1 || deviceLimit > 25)
      ) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid deviceLimit');
      }
      if (status === 'active') {
        const residual = await e.DB.prepare(
          `SELECT
             users.status current_status,
             (SELECT COUNT(*) FROM devices
              WHERE user_id = ? AND status IN ('active', 'pending')) live_devices,
             (SELECT COUNT(*) FROM revocation_jobs
              JOIN devices ON devices.id = revocation_jobs.device_id
              WHERE devices.user_id = ? AND revocation_jobs.completed_at IS NULL) pending_jobs
           FROM users WHERE users.id = ?`,
        ).bind(mt[1], mt[1], mt[1]).first<Row>();
        if (!residual) throw new ApiError(404, 'NOT_FOUND', 'User not found');
        if (
          residual.current_status !== 'active' &&
          ((residual.live_devices ?? 0) > 0 || (residual.pending_jobs ?? 0) > 0)
        ) {
          throw new ApiError(409, 'REVOCATION_PENDING', 'Wait for tailnet device revocation before re-enabling this user');
        }
      }
      const updated = await e.DB.prepare(
        `UPDATE users SET
           status = COALESCE(?, status),
           quota_bytes = CASE WHEN ? THEN ? ELSE quota_bytes END,
           device_limit = CASE WHEN ? THEN ? ELSE device_limit END,
           expires_at = CASE WHEN ? THEN ? ELSE expires_at END,
           usage_baseline_bytes = CASE WHEN ? THEN usage_reported_bytes ELSE usage_baseline_bytes END,
           usage_bytes = CASE WHEN ? THEN 0 ELSE usage_bytes END,
           updated_at = ?
         WHERE id = ?`,
      ).bind(
        status ?? null,
        quota !== undefined,
        quota ?? null,
        deviceLimit !== undefined,
        deviceLimit ?? null,
        expiresAt !== undefined,
        expiresAt ?? null,
        resetUsage === true,
        resetUsage === true,
        now(),
        mt[1],
      ).run();
      if (!updated.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'User not found');
      await enforceUser(e, mt[1]);
      return Response.json({ ok: true });
    }
  }

  if (p === '/api/v1/home/inventory' && m === 'GET') {
    await privileged(req, e.HOME_AGENT_TOKEN);
    const rows = await e.DB.prepare(
      `SELECT
         devices.tailscale_stable_id,
         devices.tailscale_public_key,
         devices.user_id,
         devices.status,
         users.usage_bytes
       FROM devices
       JOIN users ON users.id = devices.user_id
       WHERE devices.tailscale_stable_id IS NOT NULL
         AND devices.tailscale_public_key IS NOT NULL
       ORDER BY devices.tailscale_stable_id, devices.created_at
       LIMIT 2001`,
    ).all<Row>();
    if (rows.results.length > 2_000) {
      throw new ApiError(
        503,
        'HOME_INVENTORY_TOO_LARGE',
        'Home inventory requires a paginated agent upgrade',
      );
    }
    return Response.json({
      devices: rows.results.map((row) => ({
        stableNodeId: String(row.tailscale_stable_id),
        // This key was matched against server-side inventory during confirm.
        // Older Device API versions may not expose stableNodeId, so the home
        // agent uses publicKey—not client audit metadata—for attribution.
        publicKey: String(row.tailscale_public_key),
        userId: String(row.user_id),
        status: String(row.status),
        usageBytes: Number(row.usage_bytes),
      })),
    });
  }

  // The list an exit reconciles its client roster against. Pull rather than push:
  // an exit reaching out needs no inbound path and no per-exit credential held by
  // the control plane, and a Worker cannot reach a private management API anyway.
  //
  // The list *is* the enforcement. It excludes accounts that are not active, have
  // expired, or have passed their quota, so an exit that reconciles removes them —
  // and removal is what stops traffic. Enforcement that only stops counting does
  // not stop anything.
  if (p === '/api/v1/home/exit-identities' && m === 'GET') {
    await privileged(req, e.HOME_AGENT_TOKEN);
    const t = now();
    const rows = await e.DB.prepare(
      `SELECT exit_credentials.user_id AS user_id, exit_credentials.client_uuid AS client_uuid
         FROM exit_credentials
         JOIN users ON users.id = exit_credentials.user_id
        WHERE users.status = 'active'
          AND (users.expires_at IS NULL OR users.expires_at > ?)
          AND (users.quota_bytes IS NULL OR users.usage_bytes < users.quota_bytes)
        ORDER BY exit_credentials.user_id`,
    ).bind(t).all<Row>();
    return Response.json({
      // Echoed so a reconciling agent can tell a stale response from an empty
      // roster: applying an empty list as if it were current would disconnect
      // every account at once.
      observedAt: t,
      identities: rows.results.map((row) => ({
        userId: String(row.user_id),
        clientUUID: String(row.client_uuid),
      })),
    });
  }

  // Same handler for the home agent and the collector. The collector is what
  // has SSH to all sixteen nodes and therefore what reads the per-user byte
  // counters; giving it the home agent's token instead would widen that one
  // rather than scope this.
  if ((p === '/api/v1/home/usage' || p === '/api/v1/ops-ingest/usage') && m === 'POST') {
    if (p === '/api/v1/ops-ingest/usage') {
      if (typeof e.OPS_COLLECTOR_TOKEN !== 'string' || e.OPS_COLLECTOR_TOKEN.length < 32) {
        throw new ApiError(503, 'OPS_INGEST_UNCONFIGURED', 'Collector ingest is not configured');
      }
      await privileged(req, e.OPS_COLLECTOR_TOKEN);
    } else {
      await privileged(req, e.HOME_AGENT_TOKEN);
    }
    const b = await body(req, 512 * 1024);
    const reports = b.reports;
    if (!Array.isArray(reports) || reports.length < 1 || reports.length > 500) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'reports must contain 1-500 items');
    }
    const receivedAt = now();
    const unique = new Map<string, {
      reportId: string;
      userId: string;
      totalBytes: number;
      observedAt: number;
    }>();
    const users = new Set<string>();
    for (const x of reports) {
      if (x === null || typeof x !== 'object' || Array.isArray(x)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid usage report');
      }
      const reportId = str(x.reportId, 'reportId', 1, 100);
      const reportUserId = str(x.userId, 'userId', 1, 100);
      if (
        !Number.isSafeInteger(x.totalBytes) ||
        x.totalBytes < 0 ||
        !Number.isSafeInteger(x.observedAt) ||
        x.observedAt < 0 ||
        x.observedAt > receivedAt + 300
      ) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid usage report');
      }
      const normalized = {
        reportId,
        userId: reportUserId,
        totalBytes: x.totalBytes as number,
        observedAt: x.observedAt as number,
      };
      const prior = unique.get(reportId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(normalized)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Conflicting duplicate reportId');
      }
      unique.set(reportId, normalized);
      users.add(reportUserId);
    }
    if (users.size > 100) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'A batch may contain at most 100 distinct users');
    }

    const encodedReports = JSON.stringify([...unique.values()]);
    const unknownUser = await e.DB.prepare(
      `WITH input AS (
         SELECT json_extract(value, '$.userId') AS user_id
         FROM json_each(?)
       )
       SELECT input.user_id
       FROM input LEFT JOIN users ON users.id = input.user_id
       WHERE users.id IS NULL
       LIMIT 1`,
    ).bind(encodedReports).first<Row>();
    if (unknownUser) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Usage report references an unknown user');
    }

    try {
      await e.DB.batch([
        e.DB.prepare(
        `WITH input AS (
           SELECT
             json_extract(value, '$.reportId') AS report_id,
             json_extract(value, '$.userId') AS user_id,
             CAST(json_extract(value, '$.totalBytes') AS INTEGER) AS total_bytes,
             CAST(json_extract(value, '$.observedAt') AS INTEGER) AS observed_at
           FROM json_each(?)
         )
         INSERT OR IGNORE INTO usage_reports(
           report_id, user_id, total_bytes, observed_at, created_at
         )
         SELECT report_id, user_id, total_bytes, observed_at, ?
         FROM input`,
        ).bind(encodedReports, receivedAt),
        e.DB.prepare(
        `WITH input AS (
           SELECT
             json_extract(value, '$.reportId') AS report_id,
             json_extract(value, '$.userId') AS user_id,
             CAST(json_extract(value, '$.totalBytes') AS INTEGER) AS total_bytes,
             CAST(json_extract(value, '$.observedAt') AS INTEGER) AS observed_at
           FROM json_each(?)
         ),
         accepted AS (
           SELECT input.user_id, MAX(input.total_bytes) AS total_bytes
           FROM input
           JOIN usage_reports
             ON usage_reports.report_id = input.report_id
            AND usage_reports.user_id = input.user_id
            AND usage_reports.total_bytes = input.total_bytes
            AND usage_reports.observed_at = input.observed_at
           GROUP BY input.user_id
         )
         UPDATE users
         SET usage_reported_bytes = MAX(
               usage_reported_bytes,
               (SELECT accepted.total_bytes FROM accepted WHERE accepted.user_id = users.id)
             ),
             usage_bytes = MAX(
               0,
               MAX(
                 usage_reported_bytes,
                 (SELECT accepted.total_bytes FROM accepted WHERE accepted.user_id = users.id)
               ) - usage_baseline_bytes
             ),
             updated_at = ?
         WHERE id IN (SELECT user_id FROM accepted)`,
        ).bind(encodedReports, receivedAt),
      ]);
    } catch (x) {
      if (String(x).includes('USAGE_REPORT_CONFLICT')) {
        throw new ApiError(409, 'USAGE_REPORT_CONFLICT', 'reportId was already used with different content');
      }
      throw x;
    }

    const ineligibleUsers = await e.DB.prepare(
      `WITH input AS (
         SELECT DISTINCT json_extract(value, '$.userId') AS user_id
         FROM json_each(?)
       )
       SELECT users.id
       FROM users JOIN input ON input.user_id = users.id
       WHERE users.status != 'active'
          OR (users.expires_at IS NOT NULL AND users.expires_at <= ?)
          OR (users.quota_bytes IS NOT NULL AND users.usage_bytes >= users.quota_bytes)`,
    ).bind(encodedReports, receivedAt).all<Row>();
    for (const user of ineligibleUsers.results) {
      await enforceUser(e, user.id, false);
    }
    if (ineligibleUsers.results.length > 0) await processRevocations(e);
    return Response.json({ accepted: reports.length, uniqueReports: unique.size });
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found');
}

export default {
  async fetch(req: Request, e: Env, ctx: ExecutionContext) {
    const origin = req.headers.get('origin');
    const url = new URL(req.url);
    const path = url.pathname;
    const isReleaseHost = url.hostname.toLowerCase() === 'releases.afk.ccwu.cc';
    const secure = (r: Response, includeCors = true) => {
      const h = new Headers(r.headers);
      const isOpsUi = path === '/ops' || path.startsWith('/ops/');
      h.set(
        'content-security-policy',
        isOpsUi
          // style-src needs 'unsafe-inline': the console draws meter widths
          // with React style attributes. Scripts stay 'self'-only.
          ? "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'"
          : "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'none'; object-src 'none'; script-src 'self'; style-src 'self'",
      );
      h.set('permissions-policy', 'camera=(), geolocation=(), microphone=()');
      h.set('referrer-policy', 'no-referrer');
      h.set('x-content-type-options', 'nosniff');
      h.set('x-frame-options', 'DENY');
      if (path.startsWith('/api/') || path === '/' || path === '/ops' || path === '/ops/' || path.endsWith('.html')) {
        h.set('cache-control', 'no-store');
      }
      if (isReleaseHost) {
        h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
        h.set(
          'content-security-policy',
          "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
        );
      }
      if (includeCors && origin) {
        h.set('access-control-allow-origin', origin);
        h.append('vary', 'Origin');
      }
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    };
    if (isReleaseHost) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return secure(new Response('Method not allowed', {
          status: 405,
          headers: { allow: 'GET, HEAD' },
        }), false);
      }
      // Installers come from R2, not from the GitHub release they were built by.
      // A release asset is only anonymously downloadable while the repository is
      // public, and github.com is not dependably reachable from where most of
      // these users are; neither is true of this bucket. The Sparkle and Tauri
      // signatures cover the bytes, not the address, so serving the same file
      // from here is verified exactly as before.
      const download = /^\/download\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(path);
      if (download) {
        const key = download[1];
        const sizeHint = (await e.RELEASES.head(key))?.size ?? 0;
        const range = parseBytesRange(req.headers.get('range'), sizeHint);
        const object = range
          ? await e.RELEASES.get(key, { range: { offset: range.offset, length: range.length } })
          : await e.RELEASES.get(key);
        if (!object) return secure(new Response('Not found', { status: 404 }), false);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('accept-ranges', 'bytes');
        headers.set('cache-control', 'public, max-age=31536000, immutable');
        headers.set('content-disposition', `attachment; filename="${key}"`);
        if (range) {
          const end = range.offset + range.length - 1;
          headers.set('content-range', `bytes ${range.offset}-${end}/${sizeHint || '*'}`);
          headers.set('content-length', String(range.length));
          if (req.method === 'HEAD') {
            return secure(new Response(null, { status: 206, headers }), false);
          }
          const bytes = await object.arrayBuffer();
          const start = bytes.byteLength === sizeHint ? range.offset : 0;
          return secure(new Response(bytes.slice(start, start + range.length), {
            status: 206,
            headers,
          }), false);
        }
        headers.set('content-length', String(object.size));
        return secure(new Response(req.method === 'HEAD' ? null : object.body, { headers }), false);
      }

      const assetPath = new Map([
        ['/', '/releases/'],
        ['/index.html', '/releases/'],
        ['/releases', '/releases/'],
        ['/releases/', '/releases/'],
        ['/style.css', '/releases/style.css'],
        ['/manifest.json', '/releases/manifest.json'],
        ['/appcast.xml', '/appcast.xml'],
        ['/macos/appcast.xml', '/appcast.xml'],
        // Windows updaters used to ask raw.githubusercontent.com, which is
        // blocked in mainland China — so the customers most in need of a fix
        // were the ones who could not be told one existed, unless they were
        // already connected through the product being fixed.
        ['/windows/latest.json', '/windows/latest.json'],
        ['/favicon.svg', '/releases/favicon.svg'],
        ['/favicon.ico', '/releases/favicon.svg'],
        ['/robots.txt', '/releases/robots.txt'],
        ['/sitemap.xml', '/releases/sitemap.xml'],
        ['/.well-known/security.txt', '/releases/security.txt'],
        ['/help', '/releases/help.html'],
        ['/help/', '/releases/help.html'],
        ['/status', '/releases/status.html'],
        ['/status/', '/releases/status.html'],
        ['/archive', '/releases/archive.html'],
        ['/archive/', '/releases/archive.html'],
      ]).get(path);
      if (!assetPath) {
        return secure(new Response('Not found', { status: 404 }), false);
      }
      const assetURL = new URL(req.url);
      assetURL.pathname = assetPath;
      assetURL.searchParams.set('tono-release-revision', RELEASE_ASSET_REVISION);
      return secure(await e.ASSETS.fetch(new Request(assetURL, req)), false);
    }
    if (origin && origin !== e.ALLOWED_ORIGIN) {
      return secure(error(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed')), false);
    }
    const isOperationsPath = path === '/ops' || path.startsWith('/ops/') || path.startsWith('/api/v1/ops/');
    if (req.method === 'OPTIONS' && !isOperationsPath) {
      return secure(new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'authorization,content-type',
          'access-control-max-age': '86400',
        },
      }));
    }
    try {
      if (path === '/ops' || path.startsWith('/ops/')) {
        await operationsAdmin(req, e);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          return secure(new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } }));
        }
        const assetRequest = path === '/ops'
          ? new Request(new URL('/ops/', req.url), req)
          : req;
        return secure(await e.ASSETS.fetch(assetRequest));
      }
      if (
        path === '/' ||
        path === '/index.html' ||
        path === '/admin.js' ||
        path === '/style.css'
      ) {
        return secure(Response.json(
          { error: { code: 'NOT_FOUND', message: 'This host is the Tono API' } },
          { status: 404 },
        ), false);
      }
      return secure(
        path.startsWith('/api/')
          ? await route(req, e, ctx)
          : await e.ASSETS.fetch(req),
      );
    } catch (x) {
      return secure(error(x));
    }
  },
  async scheduled(_controller: ScheduledController, e: Env, ctx: ExecutionContext) {
    ctx.waitUntil(enforceAll(e));
  },
} satisfies ExportedHandler<Env>;
