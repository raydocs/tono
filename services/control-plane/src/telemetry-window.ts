import { ApiError } from './errors';
import { type Row, str } from './env';
import { DIAGNOSTICS_MAX_REPORTED_AT_MS } from './diagnostics-limits';
import { diagnosticsInt, rejectUnexpectedKeys } from './request';
import { isPlatform } from './ops/platform';

export const TELEMETRY_MAX_EVENTS = 200;
const TELEMETRY_PAYLOAD_MAX_BYTES = 64 * 1024;
const TELEMETRY_MAX_REPORTED_AT_MS = DIAGNOSTICS_MAX_REPORTED_AT_MS;

const telemetryWindowKeys = [
  'schemaVersion', 'kind', 'windowStartMs', 'windowEndMs',
  'appVersion', 'osVersion', 'osArch',
  'uiState', 'accountState', 'selectedServer', 'catalogRevision',
  'killSwitchMode', 'killSwitchWanted', 'killSwitchLive',
  'dnsEnabled', 'exitDelayMs', 'tcpDelayMs', 'exitDelayAtMs', 'tcpDelayAtMs',
  'eventCount', 'eventsDropped', 'events',
  'platform', 'bytesByRoute',
];

/** Bytes the client itself attributed to each route over the window. */
const BYTES_BY_ROUTE_KEYS = ['cloud', 'residential', 'direct'];
const BYTES_BY_ROUTE_MAX = 1_000_000_000_000_000;

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

export function canonicalTelemetryWindow(value: unknown) {
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
  if (source.platform !== undefined && source.platform !== null) {
    const platform = str(source.platform, 'platform', 1, 20);
    if (!isPlatform(platform)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid platform');
    window.platform = platform;
  }
  if (source.bytesByRoute !== undefined && source.bytesByRoute !== null) {
    rejectUnexpectedKeys(source.bytesByRoute, BYTES_BY_ROUTE_KEYS);
    const routes: Row = {};
    for (const key of BYTES_BY_ROUTE_KEYS) {
      const bytes = diagnosticsInt(source.bytesByRoute, key, 0, BYTES_BY_ROUTE_MAX, true);
      if (bytes !== undefined) routes[key] = bytes;
    }
    window.bytesByRoute = routes;
  }

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
