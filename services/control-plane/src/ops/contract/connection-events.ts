// 连接时间线的一行：客户页和节点页共用。

import type { ConnectionEventKind, Platform } from './vocabulary';
import { CONNECTION_EVENT_KINDS, PLATFORMS } from './vocabulary';
import { bool, fields, int, oneOf, optInt, optOneOf, optText, text } from './checkers';

/** Where a flattened event came from. `failure` is the client's immediate report. */
export const EVENT_SOURCES = ['window', 'direct', 'diagnostics', 'failure'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/**
 * One row of the connection timeline.
 *
 * `edge*` is the customer's own carrier as seen by Cloudflare on the upload,
 * and is not the node's egress: `edgeViaExit` marks an upload that travelled
 * through the tunnel, where the ASN describes the exit rather than the person.
 * Mixing the two is how a node's carrier label ended up on a customer row.
 */
export interface ConnectionEventDto {
  id: string;
  atMs: number;
  receivedAt: number;
  source: EventSource;
  userId: string;
  deviceId: string | null;
  platform: Platform | null;
  appVersion: string | null;
  osVersion: string | null;
  kind: ConnectionEventKind;
  node: string | null;
  stage: string | null;
  outcome: string | null;
  code: string | null;
  /** The core's own dial/handshake error, truncated and redacted upstream. */
  error: string | null;
  elapsedMs: number | null;
  delayMs: number | null;
  tcpDelayMs: number | null;
  exitDelayMs: number | null;
  catalogRevision: number | null;
  edgeAsn: number | null;
  edgeAsOrg: string | null;
  edgeCountry: string | null;
  edgeRegion: string | null;
  edgeViaExit: boolean;
  /** Present when the client reported the attempt's transport. */
  transport?: 'tcp' | 'hy2' | null;
  /**
   * Present when the client reported them. `nodeSwitch`: node names.
   * `controlPlanePathFail`: the failed and the next control-plane path label
   * (`pinned`, `system_dns`, `relay`, …) and the failure class; never an address.
   */
  from?: string | null;
  to?: string | null;
  reason?: string | null;
}

const EVENT_KEYS = [
  'id', 'atMs', 'receivedAt', 'source', 'userId', 'deviceId', 'platform', 'appVersion', 'osVersion',
  'kind', 'node', 'stage', 'outcome', 'code', 'error', 'elapsedMs', 'delayMs', 'tcpDelayMs',
  'exitDelayMs', 'catalogRevision', 'edgeAsn', 'edgeAsOrg', 'edgeCountry', 'edgeRegion', 'edgeViaExit',
  'transport', 'from', 'to', 'reason',
];

export function assertConnectionEvent(value: unknown, path = 'connectionEvent'): ConnectionEventDto {
  const row = fields(value, path, EVENT_KEYS);
  return {
    id: text(row, path, 'id'),
    atMs: int(row, path, 'atMs'),
    receivedAt: int(row, path, 'receivedAt'),
    source: oneOf<EventSource>(row, path, 'source', EVENT_SOURCES),
    userId: text(row, path, 'userId'),
    deviceId: optText(row, path, 'deviceId'),
    platform: optOneOf<Platform>(row, path, 'platform', PLATFORMS),
    appVersion: optText(row, path, 'appVersion'),
    osVersion: optText(row, path, 'osVersion'),
    kind: oneOf<ConnectionEventKind>(row, path, 'kind', CONNECTION_EVENT_KINDS),
    node: optText(row, path, 'node'),
    stage: optText(row, path, 'stage'),
    outcome: optText(row, path, 'outcome'),
    code: optText(row, path, 'code'),
    error: optText(row, path, 'error'),
    elapsedMs: optInt(row, path, 'elapsedMs'),
    delayMs: optInt(row, path, 'delayMs'),
    tcpDelayMs: optInt(row, path, 'tcpDelayMs'),
    exitDelayMs: optInt(row, path, 'exitDelayMs'),
    catalogRevision: optInt(row, path, 'catalogRevision'),
    edgeAsn: optInt(row, path, 'edgeAsn'),
    edgeAsOrg: optText(row, path, 'edgeAsOrg'),
    edgeCountry: optText(row, path, 'edgeCountry'),
    edgeRegion: optText(row, path, 'edgeRegion'),
    edgeViaExit: bool(row, path, 'edgeViaExit'),
    ...(row.transport === undefined ? {} : { transport: optOneOf(row, path, 'transport', ['tcp', 'hy2'] as const) }),
    ...(row.from === undefined ? {} : { from: optText(row, path, 'from') }),
    ...(row.to === undefined ? {} : { to: optText(row, path, 'to') }),
    ...(row.reason === undefined ? {} : { reason: optText(row, path, 'reason') }),
  };
}
