// 设置页：资产、账号、分流候选。

import type { Measured } from './vocabulary';
import {
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

export const CLOUD_KINDS = ['vps', 'cloudflare', 'domain_registrar', 'residential', 'other'] as const;
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
