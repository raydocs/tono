// 客户 360：谁在用？用了多少？去了哪里？连不上为什么？

import type {
  CustomerHealthWord,
  CustomerLifecycle,
  CustomerVerdict,
  FunnelStage,
  Measured,
  Platform,
  RouteKind,
  ServiceFamily,
  Tone,
} from './vocabulary';
import {
  CUSTOMER_HEALTH_WORDS,
  CUSTOMER_LIFECYCLES,
  CUSTOMER_VERDICTS,
  FUNNEL_STAGES,
  PLATFORMS,
  ROUTE_KINDS,
  SERVICE_FAMILIES,
  TONES,
} from './vocabulary';
import {
  arrayOf,
  bool,
  enumList,
  fields,
  int,
  measured,
  measuredBool,
  measuredInt,
  oneOf,
  optInt,
  optOneOf,
  optText,
  text,
  textList,
} from './checkers';
import { assertLogWindow, type LogWindowDto } from './log-windows';

export * from './connection-events';

/** One hour of one customer: 在线 / 已连接 heat bar plus bytes. */
export interface ActivityHourDto {
  hourAt: number;
  onlineMinutes: number;
  connectedMinutes: number;
  bytesUp: number;
  bytesDown: number;
  node: string | null;
  platform: Platform | null;
  appVersion: string | null;
}

/** 流量去向: eTLD+1 only. No URL paths, no IPs — see the privacy note in the plan. */
export interface DestinationRowDto {
  dayAt: number;
  etld1: string;
  route: RouteKind;
  node: string | null;
  connections: number;
  bytesUp: number;
  bytesDown: number;
  topProcesses: string[];
}

export interface ServiceUsageDto {
  dayAt: number;
  family: ServiceFamily;
  route: RouteKind;
  bytes: number;
  sessions: number;
  lastSeenAt: number | null;
}

/** 现在：是否在连、连在哪、连了多久、哪台设备、什么版本、哪个运营商。 */
export interface CustomerNowDto {
  connected: Measured<boolean>;
  node: string | null;
  connectedSince: number | null;
  deviceId: string | null;
  platform: Platform | null;
  appVersion: string | null;
  osVersion: string | null;
  carrier: string | null;
  asn: number | null;
  region: string | null;
}

export interface CustomerDeviceDto {
  id: string;
  name: string;
  platform: Platform | null;
  appVersion: string | null;
  osVersion: string | null;
  status: string;
  selectedServer: string | null;
  lastSeenAt: number | null;
  createdAt: number;
  /** Live telemetry from ops_device_status; false when that row does not exist. */
  connected: boolean;
  lastFailAt: number | null;
  lastFailCode: string | null;
  lastFailNode: string | null;
  /** `X-Tono-Path` of the last sign-in/refresh/catalog fetch and when stamped; null for older builds. */
  clientPath: string | null; clientPathAt: number | null;
}

/** 待办 rows. Always the `rem` tone, never an incident, never a colour decision. */
export interface ChoreDto {
  id: string;
  kind: string;
  summary: string;
  dueAt: number | null;
  createdAt: number;
}

export interface CustomerBillingDto {
  plan: string | null;
  deviceLimit: number;
  quotaBytes: number | null;
  usageBytes: Measured<number>;
  expiresAt: number | null;
  firstEntitledAt: number | null;
  createdAt: number;
}

/** The last thing that went wrong, so the table can say why without a detail fetch. */
export interface CustomerFailureDto {
  at: number;
  node: string | null;
  stage: string | null;
  code: string | null;
}

export interface CustomerSummaryDto {
  userId: string;
  email: string;
  wechatId: string | null;
  verdict: CustomerVerdict;
  health: CustomerHealthWord;
  tone: Tone;
  reason: string | null;
  lifecycle: CustomerLifecycle;
  deviceCount: number;
  platforms: Platform[];
  selectedServer: string | null;
  connected: Measured<boolean>;
  lastFailure: CustomerFailureDto | null;
  usageBytes: Measured<number>;
  quotaBytes: number | null;
  services: ServiceFamily[];
  /** The oldest version any of their devices runs — what drives 版本过旧. */
  minAppVersion: string | null;
  expiresAt: number | null;
  lastSeenAt: number | null;
  stage: FunnelStage;
  stageSinceAt: number;
  firstConnectedAt: number | null;
  updatedAt: number;
  /** Sent only as true: another customer or pending invite has the same WeChat id. */
  wechatDuplicate?: boolean;
}

export interface CustomerDetailDto {
  userId: string;
  email: string;
  wechatId: string | null;
  contact: string | null;
  notes: string | null;
  verdict: CustomerVerdict;
  health: CustomerHealthWord;
  tone: Tone;
  reason: string | null;
  lifecycle: CustomerLifecycle;
  now: CustomerNowDto;
  devices: CustomerDeviceDto[];
  chores: ChoreDto[];
  billing: CustomerBillingDto;
  stage: FunnelStage;
  stageSinceAt: number;
  firstConnectedAt: number | null;
  updatedAt: number;
  logWindows?: LogWindowDto[];
}

const HOUR_KEYS = [
  'hourAt', 'onlineMinutes', 'connectedMinutes', 'bytesUp', 'bytesDown', 'node', 'platform', 'appVersion',
];

export function assertActivityHour(value: unknown, path = 'activityHour'): ActivityHourDto {
  const row = fields(value, path, HOUR_KEYS);
  return {
    hourAt: int(row, path, 'hourAt'),
    onlineMinutes: int(row, path, 'onlineMinutes'),
    connectedMinutes: int(row, path, 'connectedMinutes'),
    bytesUp: int(row, path, 'bytesUp'),
    bytesDown: int(row, path, 'bytesDown'),
    node: optText(row, path, 'node'),
    platform: optOneOf<Platform>(row, path, 'platform', PLATFORMS),
    appVersion: optText(row, path, 'appVersion'),
  };
}

const DESTINATION_KEYS = [
  'dayAt', 'etld1', 'route', 'node', 'connections', 'bytesUp', 'bytesDown', 'topProcesses',
];

export function assertDestinationRow(value: unknown, path = 'destination'): DestinationRowDto {
  const row = fields(value, path, DESTINATION_KEYS);
  return {
    dayAt: int(row, path, 'dayAt'),
    etld1: text(row, path, 'etld1'),
    route: oneOf<RouteKind>(row, path, 'route', ROUTE_KINDS),
    node: optText(row, path, 'node'),
    connections: int(row, path, 'connections'),
    bytesUp: int(row, path, 'bytesUp'),
    bytesDown: int(row, path, 'bytesDown'),
    topProcesses: textList(row, path, 'topProcesses'),
  };
}

const SERVICE_KEYS = ['dayAt', 'family', 'route', 'bytes', 'sessions', 'lastSeenAt'];

export function assertServiceUsage(value: unknown, path = 'serviceUsage'): ServiceUsageDto {
  const row = fields(value, path, SERVICE_KEYS);
  return {
    dayAt: int(row, path, 'dayAt'),
    family: oneOf<ServiceFamily>(row, path, 'family', SERVICE_FAMILIES),
    route: oneOf<RouteKind>(row, path, 'route', ROUTE_KINDS),
    bytes: int(row, path, 'bytes'),
    sessions: int(row, path, 'sessions'),
    lastSeenAt: optInt(row, path, 'lastSeenAt'),
  };
}

const NOW_KEYS = [
  'connected', 'node', 'connectedSince', 'deviceId', 'platform',
  'appVersion', 'osVersion', 'carrier', 'asn', 'region',
];

export function assertCustomerNow(value: unknown, path = 'now'): CustomerNowDto {
  const row = fields(value, path, NOW_KEYS);
  return {
    connected: measured(row, path, 'connected', measuredBool),
    node: optText(row, path, 'node'),
    connectedSince: optInt(row, path, 'connectedSince'),
    deviceId: optText(row, path, 'deviceId'),
    platform: optOneOf<Platform>(row, path, 'platform', PLATFORMS),
    appVersion: optText(row, path, 'appVersion'),
    osVersion: optText(row, path, 'osVersion'),
    carrier: optText(row, path, 'carrier'),
    asn: optInt(row, path, 'asn'),
    region: optText(row, path, 'region'),
  };
}

const DEVICE_KEYS = [
  'id', 'name', 'platform', 'appVersion', 'osVersion', 'status', 'selectedServer', 'lastSeenAt', 'createdAt',
  'connected', 'lastFailAt', 'lastFailCode', 'lastFailNode', 'clientPath', 'clientPathAt',
];

export function assertCustomerDevice(value: unknown, path = 'device'): CustomerDeviceDto {
  const row = fields(value, path, DEVICE_KEYS);
  return {
    id: text(row, path, 'id'),
    name: text(row, path, 'name'),
    platform: optOneOf<Platform>(row, path, 'platform', PLATFORMS),
    appVersion: optText(row, path, 'appVersion'),
    osVersion: optText(row, path, 'osVersion'),
    status: text(row, path, 'status'),
    selectedServer: optText(row, path, 'selectedServer'),
    lastSeenAt: optInt(row, path, 'lastSeenAt'),
    createdAt: int(row, path, 'createdAt'),
    connected: bool(row, path, 'connected'),
    lastFailAt: optInt(row, path, 'lastFailAt'),
    lastFailCode: optText(row, path, 'lastFailCode'),
    lastFailNode: optText(row, path, 'lastFailNode'),
    clientPath: optText(row, path, 'clientPath'), clientPathAt: optInt(row, path, 'clientPathAt'),
  };
}

const CHORE_KEYS = ['id', 'kind', 'summary', 'dueAt', 'createdAt'];

export function assertChore(value: unknown, path = 'chore'): ChoreDto {
  const row = fields(value, path, CHORE_KEYS);
  return {
    id: text(row, path, 'id'),
    kind: text(row, path, 'kind'),
    summary: text(row, path, 'summary'),
    dueAt: optInt(row, path, 'dueAt'),
    createdAt: int(row, path, 'createdAt'),
  };
}

const BILLING_KEYS = [
  'plan', 'deviceLimit', 'quotaBytes', 'usageBytes', 'expiresAt', 'firstEntitledAt', 'createdAt',
];

export function assertCustomerBilling(value: unknown, path = 'billing'): CustomerBillingDto {
  const row = fields(value, path, BILLING_KEYS);
  return {
    plan: optText(row, path, 'plan'),
    deviceLimit: int(row, path, 'deviceLimit'),
    quotaBytes: optInt(row, path, 'quotaBytes'),
    usageBytes: measured(row, path, 'usageBytes', measuredInt),
    expiresAt: optInt(row, path, 'expiresAt'),
    firstEntitledAt: optInt(row, path, 'firstEntitledAt'),
    createdAt: int(row, path, 'createdAt'),
  };
}

const FAILURE_KEYS = ['at', 'node', 'stage', 'code'];

export function assertCustomerFailure(value: unknown, path = 'lastFailure'): CustomerFailureDto {
  const row = fields(value, path, FAILURE_KEYS);
  return {
    at: int(row, path, 'at'),
    node: optText(row, path, 'node'),
    stage: optText(row, path, 'stage'),
    code: optText(row, path, 'code'),
  };
}

const CUSTOMER_SUMMARY_KEYS = [
  'userId', 'email', 'wechatId', 'verdict', 'health', 'tone', 'reason', 'lifecycle', 'deviceCount',
  'platforms', 'selectedServer', 'connected', 'lastFailure', 'usageBytes', 'quotaBytes', 'services',
  'minAppVersion', 'expiresAt', 'lastSeenAt', 'stage', 'stageSinceAt', 'firstConnectedAt', 'updatedAt',
  'wechatDuplicate',
];

export function assertCustomerSummary(value: unknown, path = 'customerSummary'): CustomerSummaryDto {
  const row = fields(value, path, CUSTOMER_SUMMARY_KEYS);
  return {
    userId: text(row, path, 'userId'),
    email: text(row, path, 'email'),
    wechatId: optText(row, path, 'wechatId'),
    verdict: oneOf<CustomerVerdict>(row, path, 'verdict', CUSTOMER_VERDICTS),
    health: oneOf<CustomerHealthWord>(row, path, 'health', CUSTOMER_HEALTH_WORDS),
    tone: oneOf<Tone>(row, path, 'tone', TONES),
    reason: optText(row, path, 'reason'),
    lifecycle: oneOf<CustomerLifecycle>(row, path, 'lifecycle', CUSTOMER_LIFECYCLES),
    deviceCount: int(row, path, 'deviceCount'),
    platforms: enumList<Platform>(row, path, 'platforms', PLATFORMS),
    selectedServer: optText(row, path, 'selectedServer'),
    connected: measured(row, path, 'connected', measuredBool),
    lastFailure: row.lastFailure === null
      ? null
      : assertCustomerFailure(row.lastFailure, `${path}.lastFailure`),
    usageBytes: measured(row, path, 'usageBytes', measuredInt),
    quotaBytes: optInt(row, path, 'quotaBytes'),
    services: enumList<ServiceFamily>(row, path, 'services', SERVICE_FAMILIES),
    minAppVersion: optText(row, path, 'minAppVersion'),
    expiresAt: optInt(row, path, 'expiresAt'),
    lastSeenAt: optInt(row, path, 'lastSeenAt'),
    stage: oneOf<FunnelStage>(row, path, 'stage', FUNNEL_STAGES),
    stageSinceAt: int(row, path, 'stageSinceAt'),
    firstConnectedAt: optInt(row, path, 'firstConnectedAt'),
    updatedAt: int(row, path, 'updatedAt'),
    ...(row.wechatDuplicate === undefined ? {} : { wechatDuplicate: bool(row, path, 'wechatDuplicate') }),
  };
}

const CUSTOMER_DETAIL_KEYS = [
  'userId', 'email', 'wechatId', 'contact', 'notes', 'verdict', 'health', 'tone', 'reason',
  'lifecycle', 'now', 'devices', 'chores', 'billing', 'stage', 'stageSinceAt', 'firstConnectedAt', 'updatedAt',
  'logWindows',
];

export function assertCustomerDetail(value: unknown, path = 'customerDetail'): CustomerDetailDto {
  const row = fields(value, path, CUSTOMER_DETAIL_KEYS);
  return {
    userId: text(row, path, 'userId'),
    email: text(row, path, 'email'),
    wechatId: optText(row, path, 'wechatId'),
    contact: optText(row, path, 'contact'),
    notes: optText(row, path, 'notes'),
    verdict: oneOf<CustomerVerdict>(row, path, 'verdict', CUSTOMER_VERDICTS),
    health: oneOf<CustomerHealthWord>(row, path, 'health', CUSTOMER_HEALTH_WORDS),
    tone: oneOf<Tone>(row, path, 'tone', TONES),
    reason: optText(row, path, 'reason'),
    lifecycle: oneOf<CustomerLifecycle>(row, path, 'lifecycle', CUSTOMER_LIFECYCLES),
    now: assertCustomerNow(row.now, `${path}.now`),
    devices: arrayOf(row, path, 'devices', assertCustomerDevice),
    chores: arrayOf(row, path, 'chores', assertChore),
    billing: assertCustomerBilling(row.billing, `${path}.billing`),
    stage: oneOf<FunnelStage>(row, path, 'stage', FUNNEL_STAGES),
    stageSinceAt: int(row, path, 'stageSinceAt'),
    firstConnectedAt: optInt(row, path, 'firstConnectedAt'),
    updatedAt: int(row, path, 'updatedAt'),
    ...(row.logWindows === undefined
      ? {}
      : { logWindows: arrayOf(row, path, 'logWindows', assertLogWindow) }),
  };
}

export { assertLogWindow, type LogWindowDto } from './log-windows';
export {
  assertCustomerDiagnostics,
  assertFailureClusterList,
  type CustomerDiagnosticsDto,
} from './customer-diagnostics';
