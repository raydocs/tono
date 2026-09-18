import {
  hmacSha256,
  jwtSign,
  randomToken,
  sha256,
} from './crypto';
import {
  OidcVerificationError,
  verifyOidcIdToken,
  type OidcProvider,
} from './oidc';
import { AccessVerificationError, verifyAccessRequest } from './access';
import {
  recordAgentSamples,
  recordHomeProbeSamples,
  recordQualitySamples,
  retainOperationsTimeseries,
} from './ops-timeseries';
import { snapshotUserUsageHours } from './ops-usage-hours';
import { runOpsCron } from './ops/cron';
import { afterSnapshot, recordExitAgentAsn } from './ops/ingest-hooks';
import { consumeRateLimit } from './ops/ingest-limits';
import { opsIngestRoutes } from './ops/ingest';
import { ApiError } from './errors';
import { parseBytesRange } from './http';
import {
  type Env,
  type Row,
  now,
  id,
  str,
  envInt,
  tailscaleEnrollmentEnabled,
  requiredSecret,
} from './env';
import {
  clientIp,
  auth,
  userId,
  privileged,
  authenticateExitNode,
} from './auth';
import {
  publicManagedCatalog,
  exitCredentialRolloutPhase,
} from './catalog';
import {
  exactKeys,
  publicTrafficPolicy,
} from './traffic-policy';
import {
  rejectUnexpectedKeys,
  body,
  error,
  email,
  optionalText,
} from './request';
import { DIAGNOSTICS_DAY_SECONDS } from './diagnostics-limits';
import {
  sharedAdministrativeResource,
  backfillDeviceExitCredentials,
  USAGE_METERING_NODE_READY_SECONDS,
  publicAction,
  publicDevice,
  type SharedAdminDeps,
} from './ops/shared-admin';
import {
  liveQualityReport,
  liveAgents,
  storedLiveSnapshot,
  storeLiveSnapshot,
} from './ops/live';
import {
  publicUser,
} from './ops/reads';
import {
  opsRoutes, publicSystemRoute,
  type OpsRouterDeps,
} from './ops/router';
import { insertUserCarryingAllowlistProfile } from './signup-profile';
import { handleReleaseHost } from './releases/host';
import {
  telemetryRoutes,
  publicDiagnosticsReport,
  publicTelemetryWindow,
  normalizedReferenceCode,
  DIAGNOSTICS_RETENTION_DEFAULT_SECONDS,
  DIAGNOSTICS_LOG_RETENTION_DEFAULT_SECONDS,
  TELEMETRY_RETENTION_DEFAULT_SECONDS,
  OPS_AUDIT_RETENTION_SECONDS,
} from './telemetry/routes';

export { parseBytesRange } from './http';
export { retirementCatalogPlan } from './catalog-yaml';
export type { Env } from './env';
export { FLEET_QUALITY_STATUSES } from './ops/live';

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

/** Failure vocabulary for device-action snapshots. (Diagnostics uploads carry
 *  the client's own free-text `error`/`failedStage` instead; see
 *  `canonicalDiagnosticsReport`.) */
const errorCategories = ['preparation', 'helper', 'kill_switch', 'tunnel', 'policy', 'dns', 'exit_check', 'data_plane', 'other'];
const crashLabels = ['SIGABRT', 'SIGILL', 'SIGSEGV', 'SIGBUS', 'SIGFPE', 'SIGTRAP', 'signal', 'exception'];

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
  const residentialCountKey = 'residentialConnectionCount';
  const booleanKeys = [
    'connectionLimitReached', 'connected', 'killSwitchArmed', 'tunPresent',
    'protectedDNSConfigured',
  ];
  const expectedKeys = [
    'observedSince', 'droppedEndpointCount', ...countKeys, residentialCountKey, ...booleanKeys,
    'exitIdentityConsistency', 'physicalBypassProbe', 'entries',
  ];
  const requiredKeys = expectedKeys.filter((key) => key !== residentialCountKey);
  const hasResidentialCount = Object.prototype.hasOwnProperty.call(
    value && typeof value === 'object' ? value : {},
    residentialCountKey,
  );
  rejectUnexpectedKeys(value, expectedKeys);
  if (!exactKeys(value, hasResidentialCount ? expectedKeys : requiredKeys) ||
      !Number.isSafeInteger(value.observedSince) || value.observedSince < 0 || value.observedSince > now() + 300 ||
      !Number.isSafeInteger(value.droppedEndpointCount) || value.droppedEndpointCount < 0 || value.droppedEndpointCount > 64 ||
      !Array.isArray(value.entries) || value.entries.length > 10) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid Claude traffic research snapshot');
  }
  for (const key of [...countKeys, ...(hasResidentialCount ? [residentialCountKey] : [])]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1_000_000) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
    }
  }
  const residentialConnectionCount = hasResidentialCount
    ? value.residentialConnectionCount as number
    : 0;
  for (const key of booleanKeys) {
    if (typeof value[key] !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${key}`);
    }
  }
  if (value.identifiedProcessConnectionCount > value.observedConnectionCount ||
      residentialConnectionCount + value.proxiedConnectionCount +
        value.directConnectionCount + value.blockedConnectionCount !== value.observedConnectionCount ||
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
  const retainedRouteCounts = new Map<string, number>();
  const entries = value.entries.map((raw: unknown) => {
    rejectUnexpectedKeys(raw, ['service', 'client', 'host', 'network', 'port', 'route', 'connections', 'upBytes', 'downBytes']);
    if (!exactKeys(raw, ['service', 'client', 'host', 'network', 'port', 'route', 'connections', 'upBytes', 'downBytes'])) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid Claude traffic research entry');
    }
    const service = str(raw.service, 'service', 1, 20);
    const client = str(raw.client, 'client', 1, 20);
    const host = str(raw.host, 'host', 1, 100);
    const network = str(raw.network, 'network', 1, 3);
    const route = str(raw.route, 'route', 1, 11);
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
        !['TCP', 'UDP'].includes(network) ||
        !['RESIDENTIAL', 'PROXIED', 'DIRECT', 'BLOCKED'].includes(route) ||
        !Number.isSafeInteger(raw.port) || raw.port < 1 || raw.port > 65535 ||
        !Number.isSafeInteger(raw.connections) || raw.connections < 1 || raw.connections > 1_000_000 ||
        !Number.isSafeInteger(raw.upBytes) || raw.upBytes < 0 || raw.upBytes > 1_000_000_000_000_000 ||
        !Number.isSafeInteger(raw.downBytes) || raw.downBytes < 0 || raw.downBytes > 1_000_000_000_000_000) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid Claude traffic research entry');
    }
    const key = `${service}\n${client}\n${host}\n${network}\n${raw.port}\n${route}`;
    if (seen.has(key)) throw new ApiError(400, 'VALIDATION_ERROR', 'Duplicate Claude traffic research entry');
    seen.add(key);
    retainedRouteCounts.set(
      route,
      (retainedRouteCounts.get(route) ?? 0) + raw.connections,
    );
    return {
      service, client, host, network, port: raw.port, route,
      connections: raw.connections, upBytes: raw.upBytes, downBytes: raw.downBytes,
    };
  }).sort((a, b) => {
    const left = `${a.service}\n${a.client}\n${a.host}\n${a.network}\n${String(a.port).padStart(5, '0')}\n${a.route}`;
    const right = `${b.service}\n${b.client}\n${b.host}\n${b.network}\n${String(b.port).padStart(5, '0')}\n${b.route}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const [route, count] of retainedRouteCounts) {
    const available = route === 'RESIDENTIAL'
      ? residentialConnectionCount
      : route === 'PROXIED'
        ? value.proxiedConnectionCount
        : route === 'DIRECT'
          ? value.directConnectionCount
          : value.blockedConnectionCount;
    if (count > available) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Claude traffic entries exceed route totals');
    }
  }
  return {
    observedSince: value.observedSince,
    droppedEndpointCount: value.droppedEndpointCount,
    ...Object.fromEntries(countKeys.map((key) => [key, value[key]])),
    ...(hasResidentialCount ? { residentialConnectionCount } : {}),
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
    rejectUnexpectedKeys(s, [...bools, ...strings, 'reconnectAttempt', 'lastErrorCategory', 'lastCrashLabel', 'catalogRevision']);
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
    // Which managed catalog the device is actually running. The telemetry
    // window carries the same field under the same name and bounds; a snapshot
    // result is that claim on demand, which is the whole point of asking one
    // Mac for a snapshot rather than waiting for its next window.
    if (s.catalogRevision !== undefined && s.catalogRevision !== null) {
      if (!Number.isSafeInteger(s.catalogRevision) || s.catalogRevision < 0 || s.catalogRevision > 1_000_000_000_000) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid catalogRevision');
      snapshot.catalogRevision = s.catalogRevision;
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

function protectedRouteProofFromAction(row: Row | null | undefined) {
  if (!row) return null;
  let result: Row | null = null;
  try {
    const parsed = row.result_json ? JSON.parse(String(row.result_json)) : null;
    result = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Row : null;
  } catch {
    result = null;
  }
  const research = result?.trafficResearch;
  const evidence = research && typeof research === 'object' && !Array.isArray(research)
    ? research as Row
    : null;
  if (!evidence) {
    return {
      source: 'device_action',
      status: String(row.status),
      createdAt: Number(row.created_at),
      completedAt: row.completed_at === null ? null : Number(row.completed_at),
      evidence: null,
    };
  }
  const residentialReported = Object.prototype.hasOwnProperty.call(
    evidence,
    'residentialConnectionCount',
  );
  const routes = {
    observed: Number(evidence.observedConnectionCount),
    residential: residentialReported ? Number(evidence.residentialConnectionCount) : 0,
    proxied: Number(evidence.proxiedConnectionCount),
    direct: Number(evidence.directConnectionCount),
    blocked: Number(evidence.blockedConnectionCount),
    unknown: 0,
  };
  const unsafe =
    evidence.exitIdentityConsistency === 'MISMATCHED' ||
    evidence.physicalBypassProbe === 'REACHABLE' ||
    Number(evidence.unsafeProtectionObservationCount) > 0 ||
    Number(evidence.protectedDirectConnectionCount) > 0;
  const confirmed =
    !unsafe &&
    residentialReported &&
    routes.residential > 0 &&
    evidence.connected === true &&
    evidence.killSwitchArmed === true &&
    evidence.tunPresent === true &&
    evidence.protectedDNSConfigured === true &&
    evidence.exitIdentityConsistency === 'MATCHED' &&
    evidence.physicalBypassProbe === 'BLOCKED';
  return {
    source: 'device_action',
    status: String(row.status),
    createdAt: Number(row.created_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    evidence: {
      verdict: unsafe ? 'unsafe' : confirmed ? 'confirmed' : 'inconclusive',
      observedSince: Number(evidence.observedSince),
      residentialReported,
      routes,
      connected: evidence.connected === true,
      killSwitchArmed: evidence.killSwitchArmed === true,
      tunPresent: evidence.tunPresent === true,
      protectedDNSConfigured: evidence.protectedDNSConfigured === true,
      exitIdentityConsistency: String(evidence.exitIdentityConsistency),
      physicalBypassProbe: String(evidence.physicalBypassProbe),
      unsafeProtectionObservationCount: Number(evidence.unsafeProtectionObservationCount),
      protectedDirectConnectionCount: Number(evidence.protectedDirectConnectionCount),
    },
  };
}

function protectedRouteProofFromTelemetry(row: Row | null | undefined) {
  if (!row) return null;
  let payload: Row | null = null;
  try {
    const parsed = row.payload_json ? JSON.parse(String(row.payload_json)) : null;
    payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Row
      : null;
  } catch {
    payload = null;
  }
  if (!payload || !Array.isArray(payload.events)) return null;

  const acceptedRoutes = new Set(['RESIDENTIAL', 'PROXIED', 'DIRECT', 'BLOCKED', 'UNKNOWN']);
  const routeEvents = payload.events.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const event = raw as Row;
    if (!['protectedRouteAggregate', 'protectedRouteInvariantViolation'].includes(String(event.kind)) ||
        !acceptedRoutes.has(String(event.outcome)) ||
        !Number.isSafeInteger(event.generation) || Number(event.generation) < 0 ||
        !Number.isSafeInteger(event.ts) || Number(event.ts) < 0 ||
        !Number.isSafeInteger(event.counter) || Number(event.counter) <= 0 ||
        Number(event.counter) > 1_000_000) {
      return [];
    }
    return [{
      route: String(event.outcome),
      generation: Number(event.generation),
      timestamp: Number(event.ts),
      count: Number(event.counter),
    }];
  });
  if (routeEvents.length === 0) return null;

  // One Windows controller sample expands a cumulative session snapshot into
  // at most five route events. If a telemetry window spans two sessions, use
  // only the generation containing the newest event rather than mixing them.
  const latest = routeEvents.reduce((left, right) =>
    right.timestamp > left.timestamp ||
    (right.timestamp === left.timestamp && right.generation > left.generation)
      ? right
      : left);
  const counts = {
    RESIDENTIAL: 0,
    PROXIED: 0,
    DIRECT: 0,
    BLOCKED: 0,
    UNKNOWN: 0,
  };
  for (const event of routeEvents) {
    if (event.generation !== latest.generation) continue;
    const route = event.route as keyof typeof counts;
    counts[route] = Math.max(counts[route], event.count);
  }
  const observed = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (observed === 0) return null;
  const unsafe = counts.DIRECT > 0 || counts.PROXIED > 0;
  const receivedAt = Number(row.received_at);
  const connected = payload.uiState === 'connected';
  return {
    source: 'periodic_telemetry',
    status: 'observed',
    createdAt: receivedAt,
    completedAt: receivedAt,
    evidence: {
      // Windows periodic evidence proves the final Mihomo chain but does not
      // run the two on-demand identity/bypass probes, so a clean residential
      // observation remains explicitly inconclusive rather than "confirmed".
      verdict: unsafe ? 'unsafe' : 'inconclusive',
      observedSince: Math.floor(Math.min(...routeEvents
        .filter((event) => event.generation === latest.generation)
        .map((event) => event.timestamp)) / 1_000),
      residentialReported: true,
      routes: {
        observed,
        residential: counts.RESIDENTIAL,
        proxied: counts.PROXIED,
        direct: counts.DIRECT,
        blocked: counts.BLOCKED,
        unknown: counts.UNKNOWN,
      },
      connected,
      killSwitchArmed: payload.killSwitchLive === true,
      // Windows reaches Connected only after the real WinTUN data-plane gate.
      tunPresent: connected,
      protectedDNSConfigured: typeof payload.dnsEnabled === 'boolean' ? payload.dnsEnabled : null,
      exitIdentityConsistency: 'INCONCLUSIVE',
      physicalBypassProbe: 'INCONCLUSIVE',
      unsafeProtectionObservationCount: 0,
      protectedDirectConnectionCount: counts.DIRECT,
    },
  };
}

function freshestProtectedRouteProof(
  action: Row | null | undefined,
  telemetry: Row | null | undefined,
) {
  const actionProof = protectedRouteProofFromAction(action);
  const telemetryProof = protectedRouteProofFromTelemetry(telemetry);
  if (!actionProof?.evidence) return telemetryProof ?? actionProof;
  if (!telemetryProof?.evidence) return actionProof;
  const actionAt = actionProof.completedAt ?? actionProof.createdAt;
  const telemetryAt = telemetryProof.completedAt ?? telemetryProof.createdAt;
  return telemetryAt > actionAt ? telemetryProof : actionProof;
}

// The canonical action result retains a bounded endpoint sample for engineering
// analysis. The routine ops UI needs only aggregate proof, so its listing never
// receives endpoint hosts or any future raw entry fields by accident.
function publicAdministrativeAction(row: Row) {
  const action = publicAction(row);
  if (row.action !== 'claude_traffic_snapshot' || !row.result_json) return action;
  const proof = protectedRouteProofFromAction(row);
  return {
    ...action,
    result: {
      outcome: action.status,
      protectedRouteProof: proof?.evidence ?? null,
    },
  };
}


async function exitCredentialRoster(e: Env, timestamp: number) {
  await backfillDeviceExitCredentials(e);
  const phase = await exitCredentialRolloutPhase(e);
  const legacyUnion = phase === 'dual'
    ? `UNION
       SELECT credentials.user_id AS user_id, NULL AS device_id,
              credentials.client_uuid AS client_uuid
         FROM exit_credentials credentials
         JOIN users ON users.id = credentials.user_id
        WHERE users.status = 'active'
          AND (users.expires_at IS NULL OR users.expires_at > ?)
          AND (users.quota_bytes IS NULL OR users.usage_bytes < users.quota_bytes)
          AND (
            NOT EXISTS (SELECT 1 FROM devices WHERE devices.user_id = users.id)
            OR EXISTS (
              SELECT 1 FROM devices
              WHERE devices.user_id = users.id
                AND devices.status IN ('pending', 'active')
            )
          )`
    : '';
  const rows = await e.DB.prepare(
    `SELECT credentials.user_id AS user_id, credentials.device_id AS device_id,
            credentials.client_uuid AS client_uuid
       FROM device_exit_credentials credentials
       JOIN devices ON devices.id = credentials.device_id
       JOIN users ON users.id = devices.user_id
      WHERE devices.status IN ('pending', 'active')
        AND users.status = 'active'
        AND (users.expires_at IS NULL OR users.expires_at > ?)
        AND (users.quota_bytes IS NULL OR users.usage_bytes < users.quota_bytes)
     ${legacyUnion}
      ORDER BY user_id, device_id`,
  ).bind(...(phase === 'dual' ? [timestamp, timestamp] : [timestamp])).all<Row>();
  return { rows: rows.results, retireSharedLegacy: phase === 'device_only' };
}

async function exitCredentialLabel(userId: string, deviceId: string | null, clientUUID: string) {
  if (!deviceId) return `u:${userId}`;
  return `u:${userId}:${deviceId}:${await sha256Hex(clientUUID)}`;
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

/** Multiset equality for Tailscale addresses (order-independent). */
function sameAddressSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map(String).sort();
  const sb = [...b].map(String).sort();
  return sa.every((x, i) => x === sb[i]);
}

// --- Rate limiting (D1) -------------------------------------------------------

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
    await insertUserCarryingAllowlistProfile(e, userId, emailAddr, t);
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

// --- Tokens / devices ---------------------------------------------------------

async function tokens(e: Env, user: string, device: string, installation: string) {
  const refresh = randomToken();
  const t = now();
  const sid = id();
  // Every API request re-checks the session, user and device rows in auth(), so
  // revocation does not depend on JWT expiry. A one-day access token avoids
  // rotating three D1 rows every fifteen minutes on every idle client.
  const accessTTL = envInt(e, 'ACCESS_TOKEN_TTL_SECONDS', 86_400);
  const refreshTTL = envInt(e, 'REFRESH_TOKEN_TTL_SECONDS', 2_592_000);
  try {
    await e.DB.prepare(
      'INSERT INTO sessions(id, user_id, refresh_hash, expires_at, created_at, device_id) VALUES(?, ?, ?, ?, ?, ?)',
    ).bind(sid, user, await sha256(refresh), t + refreshTTL, t, device).run();
  } catch (x) {
    if (String(x).includes('SESSION_DEVICE_INELIGIBLE')) {
      throw new ApiError(
        409,
        'DEVICE_AUTHORIZATION_CHANGED',
        'Device authorization changed during sign-in; start sign-in again',
      );
    }
    throw x;
  }
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
      e.DB.prepare(
        `DELETE FROM device_exit_credentials
         WHERE device_id = ?
           AND EXISTS (
             SELECT 1 FROM devices
             WHERE id = ? AND status = 'revoked' AND claim_generation = ?
           )`,
      ).bind(d.id, d.id, d.claim_generation),
    );
    await e.DB.batch(statements);
  }
}

async function ensureDevice(e: Env, user: string, name: string, installation: string) {
  await expirePending(e, user);
  let d = await e.DB.prepare('SELECT * FROM devices WHERE user_id = ? AND installation_id = ?').bind(user, installation).first<Row>();
  const enrollmentEnabled = tailscaleEnrollmentEnabled(e);
  const pendingTTL = envInt(e, 'PENDING_DEVICE_TTL_SECONDS', 1_800);
  let did = d?.id || id();

  for (let attempt = 0; attempt < 4; attempt++) {
    const tNow = now();

    if (d?.status === 'active') {
      const touched = await e.DB.prepare(
        `UPDATE devices SET name = ?, last_seen_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND installation_id = ? AND status = 'active'`,
      ).bind(name, tNow, tNow, d.id, user, installation).run();
      if (touched.meta.changes) {
        await e.DB.prepare(
          `INSERT OR IGNORE INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
           SELECT id, user_id, ?, ? FROM devices
           WHERE id = ? AND user_id = ? AND status = 'active'`,
        ).bind(crypto.randomUUID(), tNow, d.id, user).run();
        return (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(d.id).first<Row>())!;
      }
      d = await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(d.id).first<Row>();
      continue;
    }

    if (d?.status === 'pending') {
      if (enrollmentEnabled) {
        await e.DB.prepare(
          `INSERT OR IGNORE INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
           SELECT id, user_id, ?, ? FROM devices
           WHERE id = ? AND user_id = ? AND status = 'pending'`,
        ).bind(crypto.randomUUID(), tNow, d.id, user).run();
        return d;
      }
      const activated = await e.DB.prepare(
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
         WHERE id = ? AND user_id = ? AND installation_id = ? AND status = 'pending'`,
      ).bind(name, tNow, tNow, tNow, d.id, user, installation).run();
      if (activated.meta.changes) {
        await e.DB.prepare(
          `INSERT OR IGNORE INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
           SELECT id, user_id, ?, ? FROM devices
           WHERE id = ? AND user_id = ? AND status = 'active'`,
        ).bind(crypto.randomUUID(), tNow, d.id, user).run();
        return (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(d.id).first<Row>())!;
      }
      d = await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(d.id).first<Row>();
      continue;
    }

    // D1 batch statements are one SQLite transaction. Select the current LRU
    // victim(s), revoke them, occupy the slot and mint the replacement identity
    // inside that single boundary. A competing invocation either observes the
    // committed result or has its whole batch rolled back on UNIQUE/DEVICE_LIMIT;
    // it can no longer commit an eviction before discovering that another
    // request already inserted the same installation.
    const rotationId = id();
    const statements: D1PreparedStatement[] = [
      e.DB.prepare(
        `INSERT INTO device_rotation_victims(rotation_id, device_id)
         SELECT ?, candidate.id
         FROM devices candidate
         WHERE candidate.user_id = ?
           AND candidate.status IN ('pending', 'active')
           AND candidate.id != ?
         ORDER BY MAX(
                    COALESCE(candidate.last_seen_at, candidate.created_at),
                    COALESCE((
                      SELECT received_at
                      FROM telemetry_windows
                      WHERE device_id = candidate.id
                      ORDER BY received_at DESC
                      LIMIT 1
                    ), 0)
                  ) ASC,
                  candidate.created_at ASC,
                  candidate.rowid ASC
         LIMIT MAX(0,
           (SELECT COUNT(*) FROM devices live
            WHERE live.user_id = ? AND live.status IN ('pending', 'active') AND live.id != ?)
           - COALESCE((SELECT device_limit FROM users WHERE id = ?), 2) + 1
         )`,
      ).bind(rotationId, user, did, user, did, user),
      e.DB.prepare(
        `INSERT INTO revocation_jobs(
           id, device_id, tailscale_node_id, created_at, ownership_generation, reason
         )
         SELECT ? || ':' || devices.id,
                devices.id, devices.tailscale_node_id, ?, devices.claim_generation,
                'device_rotated'
         FROM devices
         JOIN device_rotation_victims victims ON victims.device_id = devices.id
         WHERE victims.rotation_id = ? AND devices.tailscale_node_id IS NOT NULL
         ON CONFLICT(tailscale_node_id) DO UPDATE SET
           completed_at = NULL,
           last_error = NULL,
           device_id = excluded.device_id,
           created_at = excluded.created_at,
           ownership_generation = excluded.ownership_generation,
           reason = excluded.reason`,
      ).bind(rotationId, tNow, rotationId),
      e.DB.prepare(
        `UPDATE devices SET
           status = 'revoked',
           claim_token = NULL,
           claim_expires_at = NULL,
           updated_at = ?
         WHERE id IN (
           SELECT device_id FROM device_rotation_victims WHERE rotation_id = ?
         ) AND status IN ('pending', 'active')`,
      ).bind(tNow, rotationId),
      e.DB.prepare(
        `UPDATE sessions SET revoked_at = ?
         WHERE revoked_at IS NULL AND device_id IN (
           SELECT device_id FROM device_rotation_victims WHERE rotation_id = ?
         )`,
      ).bind(tNow, rotationId),
      e.DB.prepare(
        `DELETE FROM device_exit_credentials
         WHERE device_id IN (
           SELECT victims.device_id
           FROM device_rotation_victims victims
           JOIN devices ON devices.id = victims.device_id
           WHERE victims.rotation_id = ? AND devices.status = 'revoked'
         )`,
      ).bind(rotationId),
    ];

    if (d) {
      statements.push(enrollmentEnabled
        ? e.DB.prepare(
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
           WHERE id = ? AND user_id = ? AND installation_id = ? AND status = 'revoked'`,
        ).bind(name, tNow + pendingTTL, tNow, did, user, installation)
        : e.DB.prepare(
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
           WHERE id = ? AND user_id = ? AND installation_id = ? AND status = 'revoked'`,
        ).bind(name, tNow, tNow, tNow, did, user, installation));
    } else {
      statements.push(enrollmentEnabled
        ? e.DB.prepare(
          `INSERT INTO devices(
             id, user_id, installation_id, name, status,
             pending_expires_at, created_at, updated_at
           ) VALUES(?, ?, ?, ?, 'pending', ?, ?, ?)`,
        ).bind(did, user, installation, name, tNow + pendingTTL, tNow, tNow)
        : e.DB.prepare(
          `INSERT INTO devices(
             id, user_id, installation_id, name, status,
             pending_expires_at, confirmed_at, last_seen_at, created_at, updated_at
           ) VALUES(?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?)`,
        ).bind(did, user, installation, name, tNow, tNow, tNow, tNow));
    }
    statements.push(
      e.DB.prepare(
        `INSERT INTO device_rotation_guards(rotation_id, valid)
         VALUES(?, CASE WHEN EXISTS(
           SELECT 1 FROM devices
           WHERE id = ? AND user_id = ? AND installation_id = ?
             AND status IN ('pending', 'active')
         ) THEN 1 ELSE 0 END)`,
      ).bind(rotationId, did, user, installation),
      e.DB.prepare(
        `INSERT OR IGNORE INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
         SELECT id, user_id, ?, ? FROM devices
         WHERE id = ? AND user_id = ? AND status IN ('pending', 'active')`,
      ).bind(crypto.randomUUID(), tNow, did, user),
      e.DB.prepare('DELETE FROM device_rotation_guards WHERE rotation_id = ?').bind(rotationId),
      e.DB.prepare('DELETE FROM device_rotation_victims WHERE rotation_id = ?').bind(rotationId),
    );

    try {
      await e.DB.batch(statements);
      return (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(did).first<Row>())!;
    } catch (x) {
      if (String(x).includes('UNIQUE constraint failed: devices.user_id, devices.installation_id')) {
        const existing = await e.DB.prepare('SELECT * FROM devices WHERE user_id = ? AND installation_id = ?')
          .bind(user, installation).first<Row>();
        if (existing && ['pending', 'active'].includes(String(existing.status))) {
          const updated = await e.DB.prepare(
            `UPDATE devices SET name = ?, last_seen_at = ?, updated_at = ?
             WHERE id = ? AND status IN ('pending', 'active')`,
          ).bind(name, tNow, tNow, existing.id).run();
          if (updated.meta.changes) {
            return (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(existing.id).first<Row>())!;
          }
        } else if (existing) {
          d = existing;
          did = String(existing.id);
          continue;
        }
      }
      if (
        String(x).includes('DEVICE_LIMIT') ||
        String(x).includes('device_rotation_guards.valid')
      ) {
        d = await e.DB.prepare('SELECT * FROM devices WHERE user_id = ? AND installation_id = ?')
          .bind(user, installation).first<Row>();
        if (d) did = String(d.id);
        if (attempt < 3) continue;
        throw new ApiError(409, 'DEVICE_LIMIT', 'Concurrent device rotation did not settle');
      }
      throw x;
    }
  }
  throw new ApiError(409, 'DEVICE_LIMIT', 'This account has reached its device allowance');
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
    e.DB.prepare(
      `DELETE FROM device_exit_credentials
       WHERE device_id = ?
         AND EXISTS (
           SELECT 1 FROM devices
           WHERE devices.id = ? AND devices.status = 'revoked'
         )`,
    ).bind(d.id, d.id),
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
    `SELECT * FROM revocation_jobs WHERE completed_at IS NULL
     ORDER BY last_attempt_at, created_at, id LIMIT 40`,
  ).all<Row>();
  let oauthToken: string | undefined;
  for (const job of jobs.results) {
    try {
      const jobGeneration = Number(job.ownership_generation ?? -1);
      const t = now();
      // Rotate failed and claim-deferred jobs behind less recently attempted
      // work, without dropping the durable retry or growing the batch limit.
      await e.DB.prepare(
        'UPDATE revocation_jobs SET last_attempt_at = ? WHERE id = ? AND completed_at IS NULL',
      ).bind(t, job.id).run();

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
  // Keep each retention branch indexable. The old OR made SQLite scan the whole
  // sessions table every five minutes even though both predicates had indexes.
  await e.DB.prepare(
    `DELETE FROM sessions WHERE id IN (
       SELECT id FROM sessions
       WHERE revoked_at IS NOT NULL AND revoked_at <= ?
       LIMIT 500
     )`,
  ).bind(t - 86_400).run();
  await e.DB.prepare(
    `DELETE FROM sessions WHERE id IN (
       SELECT id FROM sessions
       WHERE revoked_at IS NULL AND expires_at <= ?
       LIMIT 500
     )`,
  ).bind(t).run();
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
  await e.DB.prepare('DELETE FROM telemetry_windows WHERE received_at <= ?')
    .bind(t - envInt(e, 'TELEMETRY_RETENTION_SECONDS', TELEMETRY_RETENTION_DEFAULT_SECONDS))
    .run();
  // Individual report ids are bounded retry evidence, not the billing ledger.
  // usage_report_sources retains the monotonic per-node totals, so deleting old
  // ids cannot lower or double-count usage; a stale replay is ignored by that
  // source's total/observed_at guards.
  await e.DB.prepare(
    `DELETE FROM usage_reports WHERE report_id IN (
       SELECT report_id FROM usage_reports
       WHERE created_at <= ?
       ORDER BY created_at
       LIMIT 500
     )`,
  ).bind(t - 14 * 86_400).run();
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
  try { await runOpsCron(e, t); } catch (x) { console.error('ops cron failed', x instanceof Error ? x.message : String(x)); }
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

  const publicSystem = await publicSystemRoute(req, e, p, m, { buildSha, consumeRateLimit });
  if (publicSystem) return publicSystem;

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
    const reserved = await e.DB.prepare(
      `UPDATE auth_challenges
       SET attempts = attempts + 1
       WHERE id = ? AND kind = ? AND consumed_at IS NULL
         AND expires_at > ? AND attempts < max_attempts
       RETURNING *`,
    ).bind(challenge, provider, t).first<Row>();
    if (!reserved) {
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
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    const nonceHash = await sha256(identity.nonce);
    if (nonceHash !== reserved.secret_hash) {
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    const consumed = await e.DB.prepare(
      `UPDATE auth_challenges
       SET consumed_at = ?
       WHERE id = ? AND kind = ? AND secret_hash = ?
         AND consumed_at IS NULL AND expires_at > ?`,
    ).bind(t, challenge, provider, nonceHash, t).run();
    if (!consumed.meta.changes) {
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    const user = await accountForOidcIdentity(e, identity);
    return Response.json(await completePasswordlessAuth(
      e,
      user,
      String(reserved.device_name),
      String(reserved.installation_id),
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
    const rotated = await e.DB.batch([
      e.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(t, s.id),
      e.DB.prepare('UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ?').bind(t, t, s.device_id),
    ]);
    if (!rotated[0].meta.changes) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token was already used');
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
    return Response.json(await publicManagedCatalog(e, {
      userId: a.userId, deviceId: a.deviceId, filterHomeExits: true,
      hy2AcceptHeader: req.headers.get('X-Tono-Accept'),
    }));
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

  const telemetry = await telemetryRoutes(req, e, p, m);
  if (telemetry) return telemetry;

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

  const ingest = await opsIngestRoutes(req, e, p, m);
  if (ingest) return ingest;

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
    const roster = await exitCredentialRoster(e, t);
    return Response.json({
      // Echoed so a reconciling agent can tell a stale response from an empty
      // roster: applying an empty list as if it were current would remove every
      // managed client from every node at once.
      observedAt: t,
      retireSharedLegacy: roster.retireSharedLegacy,
      clients: await Promise.all(roster.rows.map(async (row) => {
        const userId = String(row.user_id);
        const deviceId = row.device_id ? String(row.device_id) : null;
        const clientUUID = String(row.client_uuid);
        return {
          userId,
          deviceId: deviceId ?? undefined,
          clientUUID,
          // Credential generation is part of the metric label, so replacing a
          // device UUID cannot leave the old UUID installed under the same
          // label. Hash it rather than exposing an access credential in stats.
          email: await exitCredentialLabel(userId, deviceId, clientUUID),
        };
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
           WHERE id = ? AND kind = 'socks5'
             AND (probe_status != ? OR last_probed_at IS NULL OR last_probed_at <= ?)`,
        ).bind(t, probe.status, probe.id, probe.status, t - 300)));
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
    await afterSnapshot(e, stored.updatedAt);
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

  const sharedAdminDeps: SharedAdminDeps = {
    revokeDevice,
    processRevocations,
    enforceUser,
    publicAdministrativeAction,
  };

  const opsRouterDeps: OpsRouterDeps = {
    buildSha,
    freshestProtectedRouteProof,
    enforceUser,
    sharedAdminDeps,
  };

  if (p.startsWith('/api/v1/ops/')) {
    const actor = await operationsAdmin(req, e);
    const shared = await sharedAdministrativeResource(
      req, e, p.slice('/api/v1/ops/'.length), m, actor.email, sharedAdminDeps,
    );
    if (shared) return shared;
    const routed = await opsRoutes(req, e, p, m, actor, ctx, opsRouterDeps);
    if (routed) return routed;
    return new Response(null, {
      status: 405,
      headers: { allow: 'GET, POST, PUT, PATCH, DELETE' },
    });
  }

  if (p.startsWith('/api/v1/admin/')) {
    await privileged(req, e.ADMIN_API_TOKEN);
    const shared = await sharedAdministrativeResource(
      req, e, p.slice('/api/v1/admin/'.length), m, 'token-admin', sharedAdminDeps,
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
    const node = await authenticateExitNode(req, e, true);
    const t = now();
    const rows = await e.DB.prepare(
      `SELECT
         devices.tailscale_stable_id,
         devices.tailscale_public_key,
         devices.user_id,
         devices.status,
         users.usage_bytes,
         COALESCE(source.last_total_bytes, 0) AS source_usage_bytes
       FROM devices
       JOIN users ON users.id = devices.user_id
       LEFT JOIN usage_report_sources source
         ON source.user_id = devices.user_id AND source.source_id = ?
       WHERE devices.tailscale_stable_id IS NOT NULL
         AND devices.tailscale_public_key IS NOT NULL
       ORDER BY devices.tailscale_stable_id, devices.created_at
       LIMIT 2001`,
    ).bind(node?.id ?? '').all<Row>();
    if (rows.results.length > 2_000) {
      throw new ApiError(
        503,
        'HOME_INVENTORY_TOO_LARGE',
        'Home inventory requires a paginated agent upgrade',
      );
    }
    return Response.json({
      nodeId: node?.id,
      observedAt: t,
      devices: rows.results.map((row) => ({
        stableNodeId: String(row.tailscale_stable_id),
        // This key was matched against server-side inventory during confirm.
        // Older Device API versions may not expose stableNodeId, so the home
        // agent uses publicKey—not client audit metadata—for attribution.
        publicKey: String(row.tailscale_public_key),
        userId: String(row.user_id),
        status: String(row.status),
        usageBytes: Number(row.usage_bytes),
        // A reporter's cumulative counter is scoped to its authenticated
        // source. Seeding each node from the account-wide SUM makes every
        // additional exit re-report the other exits' history and overbill the
        // account. Keep usageBytes for old read-only dual-phase consumers, but
        // new reporters must recover from this source-local watermark.
        sourceUsageBytes: Number(row.source_usage_bytes),
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
    const node = await authenticateExitNode(req, e, true);
    await recordExitAgentAsn(e, req, node?.name ?? null);
    const t = now();
    const roster = await exitCredentialRoster(e, t);
    return Response.json({
      // New agents verify this before touching Xray or billing state. Existing
      // node source IDs are accounting identities and cannot be renamed without
      // an exactly-once ledger migration. Legacy dual-phase readers receive no
      // nodeId and old agents safely ignore this additive field.
      nodeId: node?.id,
      // Echoed so a reconciling agent can tell a stale response from an empty
      // roster: applying an empty list as if it were current would disconnect
      // every account at once.
      observedAt: t,
      retireSharedLegacy: roster.retireSharedLegacy,
      identities: roster.rows.map((row) => ({
        userId: String(row.user_id),
        deviceId: row.device_id ? String(row.device_id) : undefined,
        clientUUID: String(row.client_uuid),
      })),
    });
  }

  if (p === '/api/v1/home/roster-ack' && m === 'POST') {
    const node = await authenticateExitNode(req, e);
    await recordExitAgentAsn(e, req, node?.name ?? null);
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['observedAt', 'meteringProtocolVersion']);
    const t = now();
    if (
      !Number.isSafeInteger(b.observedAt) ||
      b.observedAt < 0 ||
      b.observedAt > t + 300
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid roster observedAt');
    }
    await e.DB.prepare(
      `UPDATE exit_nodes
       SET last_roster_at = MAX(last_roster_at, ?), updated_at = ?
       WHERE id = ? AND status = 'active'`,
    ).bind(b.observedAt, t, node!.id).run();
    return Response.json({ nodeId: node!.id, observedAt: b.observedAt });
  }

  if (p === '/api/v1/home/metering-ack' && m === 'POST') {
    const node = await authenticateExitNode(req, e);
    await recordExitAgentAsn(e, req, node?.name ?? null);
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['meteringProtocolVersion', 'observedAt']);
    const t = now();
    if (
      b.meteringProtocolVersion !== 2 ||
      !Number.isSafeInteger(b.observedAt) ||
      b.observedAt > t ||
      b.observedAt <= t - USAGE_METERING_NODE_READY_SECONDS
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid metering acknowledgement');
    }
    await e.DB.prepare(
      `UPDATE exit_nodes
       SET metering_protocol_version = 2,
           metering_last_seen_at = ?
       WHERE id = ? AND status = 'active'
         AND metering_last_seen_at < ?`,
    ).bind(b.observedAt, node!.id, b.observedAt).run();
    return Response.json({
      nodeId: node!.id,
      meteringProtocolVersion: 2,
      observedAt: b.observedAt,
    });
  }

  // Same handler for the home agent and the collector. The collector is what
  // has SSH to all sixteen nodes and therefore what reads the per-user byte
  // counters; giving it the home agent's token instead would widen that one
  // rather than scope this.
  //
  // Named reporters are shadowed while a legacy source exists. The explicit
  // v2 cutover snapshots the named sum already represented by the legacy
  // authority, after which only named-source growth advances account usage.
  if ((p === '/api/v1/home/usage' || p === '/api/v1/ops-ingest/usage') && m === 'POST') {
    let authenticatedSourceId = '';
    const metering = await e.DB.prepare(
      'SELECT phase FROM usage_metering_rollout WHERE singleton_id = 1',
    ).first<Row>();
    const meteringPhase = metering?.phase === 'v2_required' ? 'v2_required' : 'dual';
    if (p === '/api/v1/ops-ingest/usage') {
      if (typeof e.OPS_COLLECTOR_TOKEN !== 'string' || e.OPS_COLLECTOR_TOKEN.length < 32) {
        throw new ApiError(503, 'OPS_INGEST_UNCONFIGURED', 'Collector ingest is not configured');
      }
      await privileged(req, e.OPS_COLLECTOR_TOKEN);
      if (meteringPhase === 'v2_required') {
        throw new ApiError(409, 'METERING_V2_REQUIRED', 'Legacy collector metering is disabled');
      }
    } else {
      const node = await authenticateExitNode(req, e);
      authenticatedSourceId = node!.id;
      await recordExitAgentAsn(e, req, node!.name);
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
      sourceId: string;
      protocolVersion: number;
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
      const submittedSourceId = x.sourceId === undefined || x.sourceId === null
        ? null
        : str(x.sourceId, 'sourceId', 1, 64);
      if (p === '/api/v1/home/usage') {
        if (submittedSourceId === null) {
          throw new ApiError(400, 'SOURCE_ID_REQUIRED', 'Named usage must include its sourceId');
        }
        if (submittedSourceId !== authenticatedSourceId) {
          throw new ApiError(403, 'SOURCE_ID_MISMATCH', 'Usage source does not match the authenticated exit node');
        }
      }
      if (p === '/api/v1/ops-ingest/usage' && submittedSourceId !== null) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Collector usage may not name an exit source');
      }
      // The trusted source is the authenticated exit-node record. The legacy
      // collector remains in the empty-string MAX bucket and cannot impersonate
      // a per-node SUM counter.
      const reportSourceId = authenticatedSourceId;
      const reportProtocolVersion = x.protocolVersion === undefined || x.protocolVersion === null
        ? 1
        : x.protocolVersion;
      if (p === '/api/v1/ops-ingest/usage' && reportProtocolVersion !== 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Collector usage is legacy protocol v1');
      }
      if (
        p === '/api/v1/home/usage' &&
        meteringPhase === 'v2_required' &&
        reportProtocolVersion !== 2
      ) {
        throw new ApiError(409, 'METERING_V2_REQUIRED', 'Named usage must use protocol v2');
      }
      if (
        !Number.isSafeInteger(reportProtocolVersion) ||
        (reportProtocolVersion !== 1 && reportProtocolVersion !== 2) ||
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
        sourceId: reportSourceId,
        protocolVersion: reportProtocolVersion as number,
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

    // The fold below consumes one observation per (account, source). Combining
    // two rows with independent MAX(totalBytes) and MAX(observedAt) manufactures
    // a pair that no reporter sent and can hide a real counter reset. Agents
    // already queue at most one cumulative report per source/account, so reject
    // ambiguous callers instead of guessing an order.
    const sourceReports = new Set<string>();
    for (const report of unique.values()) {
      const key = JSON.stringify([report.userId, report.sourceId]);
      if (sourceReports.has(key)) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'A batch may contain at most one report per user and source',
        );
      }
      sourceReports.add(key);
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
        ...(p === '/api/v1/ops-ingest/usage' ? [e.DB.prepare(
          `UPDATE usage_metering_rollout
           SET legacy_last_seen_at = ?
           WHERE singleton_id = 1
             AND (phase = 'v2_required' OR legacy_last_seen_at < ?)`,
        ).bind(receivedAt, receivedAt - 60)] : []),
        e.DB.prepare(
        `WITH input AS (
           SELECT
             json_extract(value, '$.reportId') AS report_id,
             json_extract(value, '$.userId') AS user_id,
             json_extract(value, '$.sourceId') AS source_id,
             CAST(json_extract(value, '$.protocolVersion') AS INTEGER) AS protocol_version,
             CAST(json_extract(value, '$.totalBytes') AS INTEGER) AS total_bytes,
             CAST(json_extract(value, '$.observedAt') AS INTEGER) AS observed_at
           FROM json_each(?)
         )
         INSERT OR IGNORE INTO usage_reports(
           report_id, user_id, source_id, protocol_version, total_bytes, observed_at, created_at
         )
         SELECT report_id, user_id, source_id, protocol_version, total_bytes, observed_at, ?
         FROM input
         -- Protocol v2 is durably idempotent on the strictly increasing
         -- (user, authenticated source, observed_at) watermark below. Storing
         -- and later deleting a second row for every report multiplies the D1
         -- write volume without adding replay protection. Retain immutable IDs
         -- only for legacy v1 senders whose wall clocks are not monotonic. A
         -- fresh legacy ID carrying an unchanged/lower MAX counter is neither
         -- replay evidence nor billing input, so it writes no row. Reusing an
         -- existing ID is still attempted so the immutability trigger can
         -- distinguish an exact replay from conflicting content.
         WHERE protocol_version = 1
           AND (
             source_id != ''
             OR EXISTS (
               SELECT 1 FROM usage_reports
               WHERE usage_reports.report_id = input.report_id
             )
             OR NOT EXISTS (
               SELECT 1 FROM usage_report_sources
               WHERE usage_report_sources.user_id = input.user_id
                 AND usage_report_sources.source_id = input.source_id
             )
             OR total_bytes > COALESCE((
               SELECT last_total_bytes FROM usage_report_sources
               WHERE usage_report_sources.user_id = input.user_id
                 AND usage_report_sources.source_id = input.source_id
             ), -1)
           )`,
        ).bind(encodedReports, receivedAt),
        // One cumulative figure per (account, source). Within a source the
        // figure only ever rises, so the difference from the last one is what
        // this source has newly carried; a figure *below* the last one is a node
        // that was rebuilt and started counting again, and all of it is new. The
        // legacy source keeps MAX instead: it is an aggregate over a changing
        // set of nodes, so it falls when a node leaves the fleet, and reading
        // that as a reset would bill the account for its history a second time.
        e.DB.prepare(
        `WITH input AS (
           SELECT
             json_extract(value, '$.reportId') AS report_id,
             json_extract(value, '$.userId') AS user_id,
             json_extract(value, '$.sourceId') AS source_id,
             CAST(json_extract(value, '$.protocolVersion') AS INTEGER) AS protocol_version,
             CAST(json_extract(value, '$.totalBytes') AS INTEGER) AS total_bytes,
             CAST(json_extract(value, '$.observedAt') AS INTEGER) AS observed_at
           FROM json_each(?)
         ),
         accepted AS (
           SELECT input.user_id,
                  input.source_id,
                  input.protocol_version,
                  input.total_bytes,
                  input.observed_at
           FROM input
           WHERE input.protocol_version = 2
           UNION ALL
           SELECT input.user_id,
                  input.source_id,
                  input.protocol_version,
                  input.total_bytes,
                  input.observed_at
           FROM input
           JOIN usage_reports
             ON usage_reports.report_id = input.report_id
            AND usage_reports.user_id = input.user_id
            AND usage_reports.source_id = input.source_id
            AND usage_reports.protocol_version = input.protocol_version
            AND usage_reports.total_bytes = input.total_bytes
            AND usage_reports.observed_at = input.observed_at
           WHERE input.protocol_version = 1
         )
         INSERT INTO usage_report_sources(
           user_id, source_id, protocol_version,
           last_total_bytes, accumulated_bytes, observed_at, updated_at
         )
         SELECT user_id, source_id, protocol_version,
                total_bytes, total_bytes, observed_at, ?
         FROM accepted
         WHERE true
         ON CONFLICT(user_id, source_id) DO UPDATE SET
           accumulated_bytes = CASE
             WHEN usage_report_sources.source_id = ''
               THEN MAX(usage_report_sources.accumulated_bytes, excluded.last_total_bytes)
             WHEN excluded.last_total_bytes >= usage_report_sources.last_total_bytes
               THEN usage_report_sources.accumulated_bytes
                    + (excluded.last_total_bytes - usage_report_sources.last_total_bytes)
             ELSE usage_report_sources.accumulated_bytes + excluded.last_total_bytes
           END,
           last_total_bytes = CASE
             WHEN usage_report_sources.source_id = ''
               THEN MAX(usage_report_sources.last_total_bytes, excluded.last_total_bytes)
             ELSE excluded.last_total_bytes
           END,
           observed_at = CASE
             WHEN usage_report_sources.source_id = ''
               THEN MAX(usage_report_sources.observed_at, excluded.observed_at)
             WHEN excluded.protocol_version > usage_report_sources.protocol_version
               THEN excluded.observed_at
             ELSE MAX(usage_report_sources.observed_at, excluded.observed_at)
           END,
           protocol_version = MAX(
             usage_report_sources.protocol_version,
             excluded.protocol_version
           ),
           updated_at = excluded.updated_at
         -- v1 used a node wall clock, so accept a higher cumulative value even
         -- when that clock stepped backwards. The first v2 row replaces that
         -- watermark with the server-roster clock. Thereafter only a strictly
         -- newer v2 observation can move this source: report IDs are pruned, and
         -- accepting an old high-water row after a reset would rebill history.
         WHERE (
              usage_report_sources.source_id = ''
              AND excluded.last_total_bytes > usage_report_sources.last_total_bytes
            )
            OR excluded.protocol_version > usage_report_sources.protocol_version
            OR (
              excluded.protocol_version = usage_report_sources.protocol_version
              AND (
                excluded.observed_at > usage_report_sources.observed_at
                OR (
                  excluded.protocol_version = 1
                  AND excluded.last_total_bytes > usage_report_sources.last_total_bytes
                )
              )
            )`,
        ).bind(encodedReports, receivedAt),
        e.DB.prepare(
        `WITH input AS (
           SELECT
             json_extract(value, '$.reportId') AS report_id,
             json_extract(value, '$.userId') AS user_id,
             json_extract(value, '$.sourceId') AS source_id,
             CAST(json_extract(value, '$.protocolVersion') AS INTEGER) AS protocol_version,
             CAST(json_extract(value, '$.totalBytes') AS INTEGER) AS total_bytes,
             CAST(json_extract(value, '$.observedAt') AS INTEGER) AS observed_at
           FROM json_each(?)
         ),
         accepted_reports AS (
           SELECT input.user_id
           FROM input
           WHERE input.protocol_version = 2
           UNION ALL
           SELECT input.user_id
           FROM input
           JOIN usage_reports
             ON usage_reports.report_id = input.report_id
            AND usage_reports.user_id = input.user_id
            AND usage_reports.source_id = input.source_id
            AND usage_reports.protocol_version = input.protocol_version
            AND usage_reports.total_bytes = input.total_bytes
            AND usage_reports.observed_at = input.observed_at
           WHERE input.protocol_version = 1
         ),
         accepted AS (
           SELECT DISTINCT user_id FROM accepted_reports
         ),
         effective AS (
           SELECT accepted.user_id,
                  CASE rollout.phase
                    WHEN 'dual' THEN CASE
                      WHEN EXISTS (
                        SELECT 1 FROM usage_report_sources legacy
                        WHERE legacy.user_id = accepted.user_id
                          AND legacy.source_id = ''
                      ) THEN COALESCE((
                        SELECT accumulated_bytes FROM usage_report_sources legacy
                        WHERE legacy.user_id = accepted.user_id
                          AND legacy.source_id = ''
                      ), 0)
                      ELSE COALESCE((
                        SELECT SUM(accumulated_bytes) FROM usage_report_sources named
                        WHERE named.user_id = accepted.user_id
                          AND named.source_id != ''
                      ), 0)
                    END
                    ELSE CASE
                      WHEN baseline.user_id IS NOT NULL THEN
                        baseline.reported_bytes + MAX(
                          0,
                          COALESCE((
                            SELECT SUM(accumulated_bytes) FROM usage_report_sources named
                            WHERE named.user_id = accepted.user_id
                              AND named.source_id != ''
                          ), 0) - baseline.named_bytes
                        )
                      ELSE COALESCE((
                        SELECT SUM(accumulated_bytes) FROM usage_report_sources named
                        WHERE named.user_id = accepted.user_id
                          AND named.source_id != ''
                      ), 0)
                    END
                  END AS total_bytes
           FROM accepted
           CROSS JOIN usage_metering_rollout rollout
           LEFT JOIN usage_metering_cutover_baselines baseline
             ON baseline.user_id = accepted.user_id
           WHERE rollout.singleton_id = 1
         )
         UPDATE users
         SET usage_reported_bytes = MAX(
               usage_reported_bytes,
               COALESCE((SELECT total_bytes FROM effective WHERE user_id = users.id), 0)
             ),
             usage_bytes = MAX(
               0,
               MAX(
                 usage_reported_bytes,
                 COALESCE((SELECT total_bytes FROM effective WHERE user_id = users.id), 0)
               ) - usage_baseline_bytes
             ),
             updated_at = ?
         WHERE id IN (SELECT user_id FROM effective)
           AND (
             usage_reported_bytes < COALESCE(
               (SELECT total_bytes FROM effective WHERE user_id = users.id), 0
             )
             OR usage_bytes != MAX(
               0,
               MAX(
                 usage_reported_bytes,
                 COALESCE((SELECT total_bytes FROM effective WHERE user_id = users.id), 0)
               ) - usage_baseline_bytes
             )
           )`,
        ).bind(encodedReports, receivedAt),
      ]);
    } catch (x) {
      if (String(x).includes('USAGE_REPORT_CONFLICT')) {
        throw new ApiError(409, 'USAGE_REPORT_CONFLICT', 'reportId was already used with different content');
      }
      if (String(x).includes('USAGE_METERING_V2_REQUIRED')) {
        throw new ApiError(409, 'METERING_V2_REQUIRED', 'Metering rollout now requires named protocol v2');
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
    const releaseResponse = await handleReleaseHost(req, e);
    if (releaseResponse) return releaseResponse;

    const origin = req.headers.get('origin');
    const url = new URL(req.url);
    const path = url.pathname;
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
      if (includeCors && origin) {
        h.set('access-control-allow-origin', origin);
        h.append('vary', 'Origin');
      }
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    };
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
