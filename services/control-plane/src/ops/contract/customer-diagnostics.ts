// Customer diagnostics timeline and the failure-cluster list.
// Split from customers.ts so that file stays under the 500-line ops budget.

import type { Platform } from './vocabulary';
import { PLATFORMS } from './vocabulary';
import {
  arrayOf,
  bool,
  fields,
  int,
  oneOf,
  optInt,
  optOneOf,
  optText,
  text,
} from './checkers';

const DIAGNOSTICS_SESSION_KEYS = [
  'id', 'deviceId', 'startedAtMs', 'endedAtMs', 'node', 'entryNodeId', 'residentialExitId',
  'bytesUp', 'bytesDown', 'outcome', 'reason', 'appVersion', 'appBuild', 'gitCommit',
  'platform', 'osVersion', 'coreVersion', 'channel',
];
const DIAGNOSTICS_HOP_KEYS = [
  'sessionId', 'deviceId', 'index', 'role', 'nodeId', 'connected', 'handshakeMs', 'failureCode', 'atMs',
];
const DIAGNOSTICS_EXIT_KEYS = [
  'atMs', 'ipPrefix', 'asn', 'country', 'city', 'networkKind', 'previousAsn', 'previousCountry', 'previousCity',
];
const DIAGNOSTICS_DNS_KEYS = [
  'atMs', 'resolver', 'leakOutside', 'geoMatchesExit', 'mode', 'ipv6Leak',
  'resolverCountry', 'exitCountry', 'appVersion', 'channel',
];
const DIAGNOSTICS_AI_KEYS = [
  'bucketStartMs', 'service', 'exitKind', 'exitId', 'exitCountry', 'routingLeak', 'exitSwitched',
  'dnsOk', 'tzMismatch', 'appVersion', 'channel',
];
const CUSTOMER_DIAGNOSTICS_KEYS = [
  'userId', 'sessions', 'hops', 'exits', 'dnsChecks', 'aiRoutes', 'updatedAt',
];

export interface CustomerDiagnosticsDto {
  userId: string;
  sessions: ReturnType<typeof assertDiagnosticsSession>[];
  hops: ReturnType<typeof assertDiagnosticsHop>[];
  exits: ReturnType<typeof assertDiagnosticsExit>[];
  dnsChecks: ReturnType<typeof assertDiagnosticsDns>[];
  aiRoutes: ReturnType<typeof assertDiagnosticsAi>[];
  updatedAt: number;
}

function assertDiagnosticsSession(value: unknown, path: string) {
  const row = fields(value, path, DIAGNOSTICS_SESSION_KEYS);
  return {
    id: text(row, path, 'id'),
    deviceId: optText(row, path, 'deviceId'),
    startedAtMs: int(row, path, 'startedAtMs'),
    endedAtMs: optInt(row, path, 'endedAtMs'),
    node: optText(row, path, 'node'),
    entryNodeId: optText(row, path, 'entryNodeId'),
    residentialExitId: optText(row, path, 'residentialExitId'),
    bytesUp: int(row, path, 'bytesUp'),
    bytesDown: int(row, path, 'bytesDown'),
    outcome: optText(row, path, 'outcome'),
    reason: optText(row, path, 'reason'),
    appVersion: text(row, path, 'appVersion'),
    appBuild: optText(row, path, 'appBuild'),
    gitCommit: optText(row, path, 'gitCommit'),
    platform: optOneOf<Platform>(row, path, 'platform', PLATFORMS),
    osVersion: optText(row, path, 'osVersion'),
    coreVersion: optText(row, path, 'coreVersion'),
    channel: optOneOf(row, path, 'channel', ['release', 'beta'] as const),
  };
}

function assertDiagnosticsHop(value: unknown, path: string) {
  const row = fields(value, path, DIAGNOSTICS_HOP_KEYS);
  return {
    sessionId: text(row, path, 'sessionId'),
    deviceId: optText(row, path, 'deviceId'),
    index: int(row, path, 'index'),
    role: oneOf(row, path, 'role', ['entry', 'residential'] as const),
    nodeId: optText(row, path, 'nodeId'),
    connected: bool(row, path, 'connected'),
    handshakeMs: optInt(row, path, 'handshakeMs'),
    failureCode: optText(row, path, 'failureCode'),
    atMs: int(row, path, 'atMs'),
  };
}

function assertDiagnosticsExit(value: unknown, path: string) {
  const row = fields(value, path, DIAGNOSTICS_EXIT_KEYS);
  return {
    atMs: int(row, path, 'atMs'),
    ipPrefix: optText(row, path, 'ipPrefix'),
    asn: optInt(row, path, 'asn'),
    country: optText(row, path, 'country'),
    city: optText(row, path, 'city'),
    networkKind: oneOf(row, path, 'networkKind', ['residential', 'datacenter', 'unknown'] as const),
    previousAsn: optInt(row, path, 'previousAsn'),
    previousCountry: optText(row, path, 'previousCountry'),
    previousCity: optText(row, path, 'previousCity'),
  };
}

function assertDiagnosticsDns(value: unknown, path: string) {
  const row = fields(value, path, DIAGNOSTICS_DNS_KEYS);
  return {
    atMs: int(row, path, 'atMs'),
    resolver: oneOf(row, path, 'resolver', ['system', 'tunnel', 'unknown'] as const),
    leakOutside: bool(row, path, 'leakOutside'),
    geoMatchesExit: row.geoMatchesExit === null ? null : bool(row, path, 'geoMatchesExit'),
    mode: oneOf(row, path, 'mode', ['fake-ip', 'real-ip', 'unknown'] as const),
    ipv6Leak: bool(row, path, 'ipv6Leak'),
    resolverCountry: optText(row, path, 'resolverCountry'),
    exitCountry: optText(row, path, 'exitCountry'),
    appVersion: optText(row, path, 'appVersion'),
    channel: optOneOf(row, path, 'channel', ['release', 'beta'] as const),
  };
}

function assertDiagnosticsAi(value: unknown, path: string) {
  const row = fields(value, path, DIAGNOSTICS_AI_KEYS);
  return {
    bucketStartMs: int(row, path, 'bucketStartMs'),
    service: oneOf(row, path, 'service', ['claude', 'openai'] as const),
    exitKind: oneOf(row, path, 'exitKind', ['residential', 'datacenter', 'direct', 'unknown'] as const),
    exitId: optText(row, path, 'exitId'),
    exitCountry: optText(row, path, 'exitCountry'),
    routingLeak: bool(row, path, 'routingLeak'),
    exitSwitched: bool(row, path, 'exitSwitched'),
    dnsOk: row.dnsOk === null ? null : bool(row, path, 'dnsOk'),
    tzMismatch: row.tzMismatch === null ? null : bool(row, path, 'tzMismatch'),
    appVersion: optText(row, path, 'appVersion'),
    channel: optOneOf(row, path, 'channel', ['release', 'beta'] as const),
  };
}

export function assertCustomerDiagnostics(value: unknown, path = 'customerDiagnostics'): CustomerDiagnosticsDto {
  const row = fields(value, path, CUSTOMER_DIAGNOSTICS_KEYS);
  return {
    userId: text(row, path, 'userId'),
    sessions: arrayOf(row, path, 'sessions', assertDiagnosticsSession),
    hops: arrayOf(row, path, 'hops', assertDiagnosticsHop),
    exits: arrayOf(row, path, 'exits', assertDiagnosticsExit),
    dnsChecks: arrayOf(row, path, 'dnsChecks', assertDiagnosticsDns),
    aiRoutes: arrayOf(row, path, 'aiRoutes', assertDiagnosticsAi),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

const FAILURE_CLUSTER_KEYS = [
  'id', 'code', 'stage', 'appVersion', 'platform', 'node', 'severity', 'count', 'users', 'devices',
  'firstSeenMs', 'lastSeenMs', 'status', 'sample', 'detailPath',
];

function assertFailureCluster(value: unknown, path: string) {
  const row = fields(value, path, FAILURE_CLUSTER_KEYS);
  return {
    id: text(row, path, 'id'),
    code: text(row, path, 'code'),
    stage: text(row, path, 'stage'),
    appVersion: text(row, path, 'appVersion'),
    platform: text(row, path, 'platform'),
    node: text(row, path, 'node'),
    severity: oneOf(row, path, 'severity', ['p0', 'normal'] as const),
    count: int(row, path, 'count'),
    users: int(row, path, 'users'),
    devices: int(row, path, 'devices'),
    firstSeenMs: int(row, path, 'firstSeenMs'),
    lastSeenMs: int(row, path, 'lastSeenMs'),
    status: text(row, path, 'status'),
    sample: optText(row, path, 'sample'),
    detailPath: text(row, path, 'detailPath'),
  };
}

/** Access-gated cluster list. `sample` is redacted JSON text, not the bot's object. */
export function assertFailureClusterList(value: unknown, path = 'failureClusters') {
  const row = fields(value, path, ['clusters', 'updatedAt']);
  return {
    clusters: arrayOf(row, path, 'clusters', assertFailureCluster),
    updatedAt: int(row, path, 'updatedAt'),
  };
}
