// Canonical forms of client-uploaded device reports (routing research
// snapshots, device-action results) and the protected-route proof derived
// from them. Moved verbatim from index.ts; this module never imports
// index.ts back.

import { ROUTING_RESEARCH_RETENTION_MAX_SECONDS } from './scheduled';
import { ApiError } from './errors';
import { type Row, now, str } from './env';
import { exactKeys } from './traffic-policy';
import { rejectUnexpectedKeys } from './request';
import { publicAction } from './ops/shared-admin';

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
export const ROUTING_RESEARCH_DAY_SECONDS = 24 * 60 * 60;
export const ROUTING_RESEARCH_MIN_SUMMARY_PARTICIPANTS = 3;

/** Failure vocabulary for device-action snapshots. (Diagnostics uploads carry
 *  the client's own free-text `error`/`failedStage` instead; see
 *  `canonicalDiagnosticsReport`.) */
const errorCategories = ['preparation', 'helper', 'kill_switch', 'tunnel', 'policy', 'dns', 'exit_check', 'data_plane', 'other'];
const crashLabels = ['SIGABRT', 'SIGILL', 'SIGSEGV', 'SIGBUS', 'SIGFPE', 'SIGTRAP', 'signal', 'exception'];

export function canonicalRoutingResearch(value: unknown) {
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

export function canonicalActionResult(value: unknown) {
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

export function freshestProtectedRouteProof(
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
export function publicAdministrativeAction(row: Row) {
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
