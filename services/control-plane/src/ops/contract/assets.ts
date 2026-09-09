// 设置页与状态页：资产、账号、分流候选、操作记录、数据源新鲜度。

import type { Measured, SourceId } from './vocabulary';
import { SOURCE_IDS } from './vocabulary';
import {
  arrayOf,
  bool,
  fields,
  int,
  measured,
  measuredInt,
  oneOf,
  optInt,
  optNum,
  optText,
  text,
} from './checkers';

export const ACTOR_TYPES = ['owner', 'system', 'collector', 'agent'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/**
 * One line of 操作记录.
 *
 * `actorType`/`actorRole` exist today with a single administrator so that
 * adding roles later is a data change, not a migration of every audit row.
 */
export interface AuditEntryDto {
  id: string;
  at: number;
  actorEmail: string | null;
  actorType: ActorType;
  actorRole: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string | null;
  requestId: string | null;
}

export const SOURCE_STATES = ['ready', 'stale', 'error', 'missing'] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

export interface SourceHealthDto {
  source: SourceId;
  state: SourceState;
  asOfSec: number | null;
  message: string | null;
}

/**
 * The header's 数据源 dot, collapsed to one word.
 *
 * The old console explained each data source on every page; this replaces all
 * of it. `ok` is false as soon as any source is not ready, because a green dot
 * over a dead collector is the failure mode the 死人开关 exists to catch.
 */
export interface SystemHealthDto {
  ok: boolean;
  buildSha: string | null;
  contractVersion: number;
  sources: SourceHealthDto[];
  cronLastRunAt: number | null;
  cronLastDurationMs: number | null;
  cronLastError: string | null;
  updatedAt: number;
}

export const CANDIDATE_STATUSES = ['new', 'accepted', 'rejected', 'already_direct'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/** 直连候选收件箱: a domain the routing rules probably should not tunnel. */
export interface DirectCandidateDto {
  etld1: string;
  status: CandidateStatus;
  firstSeen: number;
  users: number;
  bytes30d: number;
  /** Where the name resolves. Null when nothing has looked yet — never assume 大陆. */
  countryHint: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
}

export const CLOUD_KINDS = ['vps', 'cloudflare', 'domain_registrar', 'other'] as const;
export type CloudKind = (typeof CLOUD_KINDS)[number];

/**
 * A vendor account a node or domain is billed to.
 *
 * Login credentials never live here: `secretRef` names an entry in the
 * operator's password manager and `loginEmailMasked` is already masked when
 * it is stored, so a database dump is not an account takeover.
 */
export interface ProviderAccountDto {
  id: string;
  provider: string;
  label: string;
  cloudKind: CloudKind;
  loginEmailMasked: string | null;
  billingUrl: string | null;
  balanceHint: string | null;
  renewNotes: string | null;
  secretRef: string | null;
  nodeCount: number;
  createdAt: number;
  updatedAt: number;
}

export const BILLING_KINDS = ['monthly', 'per_gb', 'bundle'] as const;
export type BillingKind = (typeof BILLING_KINDS)[number];

/** Which of the three metering legs this line's bytes came from. */
export const METER_SOURCES = ['client_route', 'node_stats', 'provider_api', 'manual'] as const;
export type MeterSource = (typeof METER_SOURCES)[number];

export interface HomeLineUsageDto {
  bytesUp: number;
  bytesDown: number;
  users: number;
  source: MeterSource;
}

/** One day of one line, as `home-lines/{id}/usage` returns it. */
export interface HomeLineUsageDayDto extends HomeLineUsageDto {
  dayAt: number;
}

export interface HomeLineProbeDto {
  alive: number;
  total: number;
  uptimeRatio: number | null;
  status: string | null;
}

/** 家宽资产: registration, expiry, billing and metering for one residential line. */
export interface HomeLineDto {
  id: string;
  proxyName: string;
  displayName: string;
  status: string;
  isp: string | null;
  region: string | null;
  providerAccountId: string | null;
  price: number | null;
  currency: string | null;
  billingKind: BillingKind | null;
  bundleBytes: number | null;
  cycleStart: number | null;
  cycleEnd: number | null;
  expiresAt: number | null;
  meterSource: MeterSource | null;
  usage: Measured<HomeLineUsageDto | null>;
  probe: Measured<HomeLineProbeDto | null>;
  boundUsers: Measured<number>;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

const AUDIT_KEYS = [
  'id', 'at', 'actorEmail', 'actorType', 'actorRole', 'action',
  'targetType', 'targetId', 'summary', 'requestId',
];

export function assertAuditEntry(value: unknown, path = 'auditEntry'): AuditEntryDto {
  const row = fields(value, path, AUDIT_KEYS);
  return {
    id: text(row, path, 'id'),
    at: int(row, path, 'at'),
    actorEmail: optText(row, path, 'actorEmail'),
    actorType: oneOf<ActorType>(row, path, 'actorType', ACTOR_TYPES),
    actorRole: optText(row, path, 'actorRole'),
    action: text(row, path, 'action'),
    targetType: text(row, path, 'targetType'),
    targetId: optText(row, path, 'targetId'),
    summary: optText(row, path, 'summary'),
    requestId: optText(row, path, 'requestId'),
  };
}

const SOURCE_HEALTH_KEYS = ['source', 'state', 'asOfSec', 'message'];

export function assertSourceHealth(value: unknown, path = 'sourceHealth'): SourceHealthDto {
  const row = fields(value, path, SOURCE_HEALTH_KEYS);
  return {
    source: oneOf<SourceId>(row, path, 'source', SOURCE_IDS),
    state: oneOf<SourceState>(row, path, 'state', SOURCE_STATES),
    asOfSec: optInt(row, path, 'asOfSec'),
    message: optText(row, path, 'message'),
  };
}

const SYSTEM_HEALTH_KEYS = [
  'ok', 'buildSha', 'contractVersion', 'sources',
  'cronLastRunAt', 'cronLastDurationMs', 'cronLastError', 'updatedAt',
];

export function assertSystemHealth(value: unknown, path = 'systemHealth'): SystemHealthDto {
  const row = fields(value, path, SYSTEM_HEALTH_KEYS);
  return {
    ok: bool(row, path, 'ok'),
    buildSha: optText(row, path, 'buildSha'),
    contractVersion: int(row, path, 'contractVersion'),
    sources: arrayOf(row, path, 'sources', assertSourceHealth),
    cronLastRunAt: optInt(row, path, 'cronLastRunAt'),
    cronLastDurationMs: optInt(row, path, 'cronLastDurationMs'),
    cronLastError: optText(row, path, 'cronLastError'),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

const CANDIDATE_KEYS = [
  'etld1', 'status', 'firstSeen', 'users', 'bytes30d', 'countryHint', 'decidedBy', 'decidedAt',
];

export function assertDirectCandidate(value: unknown, path = 'directCandidate'): DirectCandidateDto {
  const row = fields(value, path, CANDIDATE_KEYS);
  return {
    etld1: text(row, path, 'etld1'),
    status: oneOf<CandidateStatus>(row, path, 'status', CANDIDATE_STATUSES),
    firstSeen: int(row, path, 'firstSeen'),
    users: int(row, path, 'users'),
    bytes30d: int(row, path, 'bytes30d'),
    countryHint: optText(row, path, 'countryHint'),
    decidedBy: optText(row, path, 'decidedBy'),
    decidedAt: optInt(row, path, 'decidedAt'),
  };
}

const PROVIDER_KEYS = [
  'id', 'provider', 'label', 'cloudKind', 'loginEmailMasked', 'billingUrl',
  'balanceHint', 'renewNotes', 'secretRef', 'nodeCount', 'createdAt', 'updatedAt',
];

export function assertProviderAccount(value: unknown, path = 'providerAccount'): ProviderAccountDto {
  const row = fields(value, path, PROVIDER_KEYS);
  return {
    id: text(row, path, 'id'),
    provider: text(row, path, 'provider'),
    label: text(row, path, 'label'),
    cloudKind: oneOf<CloudKind>(row, path, 'cloudKind', CLOUD_KINDS),
    loginEmailMasked: optText(row, path, 'loginEmailMasked'),
    billingUrl: optText(row, path, 'billingUrl'),
    balanceHint: optText(row, path, 'balanceHint'),
    renewNotes: optText(row, path, 'renewNotes'),
    secretRef: optText(row, path, 'secretRef'),
    nodeCount: int(row, path, 'nodeCount'),
    createdAt: int(row, path, 'createdAt'),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

const USAGE_KEYS = ['bytesUp', 'bytesDown', 'users', 'source'];

function homeLineUsage(value: unknown, path: string): HomeLineUsageDto | null {
  if (value === null) return null;
  const row = fields(value, path, USAGE_KEYS);
  return {
    bytesUp: int(row, path, 'bytesUp'),
    bytesDown: int(row, path, 'bytesDown'),
    users: int(row, path, 'users'),
    source: oneOf<MeterSource>(row, path, 'source', METER_SOURCES),
  };
}

export function assertHomeLineUsageDay(value: unknown, path = 'homeLineUsage'): HomeLineUsageDayDto {
  const row = fields(value, path, [...USAGE_KEYS, 'dayAt']);
  return {
    dayAt: int(row, path, 'dayAt'),
    bytesUp: int(row, path, 'bytesUp'),
    bytesDown: int(row, path, 'bytesDown'),
    users: int(row, path, 'users'),
    source: oneOf<MeterSource>(row, path, 'source', METER_SOURCES),
  };
}

const PROBE_KEYS = ['alive', 'total', 'uptimeRatio', 'status'];

function homeLineProbe(value: unknown, path: string): HomeLineProbeDto | null {
  if (value === null) return null;
  const row = fields(value, path, PROBE_KEYS);
  return {
    alive: int(row, path, 'alive'),
    total: int(row, path, 'total'),
    uptimeRatio: optNum(row, path, 'uptimeRatio'),
    status: optText(row, path, 'status'),
  };
}

const HOME_LINE_KEYS = [
  'id', 'proxyName', 'displayName', 'status', 'isp', 'region', 'providerAccountId',
  'price', 'currency', 'billingKind', 'bundleBytes', 'cycleStart', 'cycleEnd', 'expiresAt',
  'meterSource', 'usage', 'probe', 'boundUsers', 'notes', 'createdAt', 'updatedAt',
];

export function assertHomeLine(value: unknown, path = 'homeLine'): HomeLineDto {
  const row = fields(value, path, HOME_LINE_KEYS);
  return {
    id: text(row, path, 'id'),
    proxyName: text(row, path, 'proxyName'),
    displayName: text(row, path, 'displayName'),
    status: text(row, path, 'status'),
    isp: optText(row, path, 'isp'),
    region: optText(row, path, 'region'),
    providerAccountId: optText(row, path, 'providerAccountId'),
    price: optNum(row, path, 'price'),
    currency: optText(row, path, 'currency'),
    billingKind: row.billingKind === null
      ? null
      : oneOf<BillingKind>(row, path, 'billingKind', BILLING_KINDS),
    bundleBytes: optInt(row, path, 'bundleBytes'),
    cycleStart: optInt(row, path, 'cycleStart'),
    cycleEnd: optInt(row, path, 'cycleEnd'),
    expiresAt: optInt(row, path, 'expiresAt'),
    meterSource: row.meterSource === null
      ? null
      : oneOf<MeterSource>(row, path, 'meterSource', METER_SOURCES),
    usage: measured(row, path, 'usage', homeLineUsage),
    probe: measured(row, path, 'probe', homeLineProbe),
    boundUsers: measured(row, path, 'boundUsers', measuredInt),
    notes: optText(row, path, 'notes'),
    createdAt: int(row, path, 'createdAt'),
    updatedAt: int(row, path, 'updatedAt'),
  };
}
