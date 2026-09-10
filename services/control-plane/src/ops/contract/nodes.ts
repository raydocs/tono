// 节点：机器能不能卖、客户能不能连上、什么时候到期。

import type {
  CarrierKey,
  Measured,
  NodeHealthWord,
  NodeLifecycle,
  NodeVerdict,
  Platform,
  SourceId,
  Tone,
} from './vocabulary';
import {
  CARRIER_KEYS,
  NODE_HEALTH_WORDS,
  NODE_LIFECYCLES,
  NODE_VERDICTS,
  PLATFORMS,
  SOURCE_IDS,
  TONES,
} from './vocabulary';
import type { JobDto } from './operations';
import { assertJob } from './operations';
import {
  arrayOf,
  bool,
  fields,
  int,
  measured,
  measuredArray,
  measuredInt,
  oneOf,
  optBool,
  optInt,
  optNum,
  optOneOf,
  optText,
  text,
  textList,
  violation,
} from './checkers';

/**
 * 客户 → 节点, per carrier, from client events.
 *
 * This is the direction that actually decides whether a customer can connect,
 * and the one the old console never had: it showed the node's CMIN2 label and
 * the node → 大陆 return path, then could not explain why 江苏移动 could not
 * reach Los Angeles while Tokyo worked.
 */
export interface ForwardPathDto {
  carrier: CarrierKey;
  successRate: number | null;
  medianTcpMs: number | null;
  topFailure: string | null;
  attempts: number;
  users: number;
}

/** 节点 → 大陆, per carrier, from the hub probes. Good here does not imply the forward path works. */
export interface ReturnPathDto {
  carrier: CarrierKey;
  latencyMs: number | null;
  lossPct: number | null;
  samples: number;
}

export const QUOTA_LEVELS = ['ok', 'chore', 'warn', 'severe'] as const;
export type QuotaLevel = (typeof QUOTA_LEVELS)[number];

export const QUOTA_CYCLE_KINDS = ['calendar_day', 'anniversary', 'rolling_30d', 'manual'] as const;
export type QuotaCycleKind = (typeof QUOTA_CYCLE_KINDS)[number];

/** Which counter the provider bills on; the three disagree by a factor of two. */
export const QUOTA_COUNTS = ['in', 'out', 'in_out'] as const;
export type QuotaCounts = (typeof QUOTA_COUNTS)[number];

/**
 * 本周期流量. `pct` and `projectedExhaustAt` are derived server-side so the
 * card, the table and the chore all quote the same number (R4).
 */
export interface NodeQuotaDto {
  quota: number | null;
  used: number | null;
  pct: number | null;
  projectedExhaustAt: number | null;
  level: QuotaLevel;
  cycleKind: QuotaCycleKind;
  cycleStart: number | null;
  cycleEnd: number | null;
  counts: QuotaCounts;
}

/** The five places a node must be registered. A missing tick is a chore, never an incident. */
export interface NodeBindingsDto {
  catalog: boolean;
  exitToken: boolean;
  komari: boolean;
  identitySync: boolean;
  metering: boolean;
  asOfSec: number | null;
}

export interface NodeFactsDto {
  publicIp: string | null;
  os: string | null;
  region: string | null;
  provider: string | null;
  providerAccountId: string | null;
  /** Hand-confirmed CN2GIA / CMIN2 / 9929 labels, shown beside the probed ones. */
  lineTags: string[];
  port: number | null;
  price: number | null;
  currency: string | null;
  billingCycle: number | null;
  renewsAt: number | null;
  expiresAt: number | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NodeOccupantDto {
  userId: string;
  email: string;
  deviceId: string | null;
  platform: Platform | null;
  appVersion: string | null;
  online: boolean;
  lastSeenAt: number;
}

/** One day of one Xray error category, from the hourly `xray_error_digest` job. */
export interface NodeErrorRowDto {
  dayAt: number;
  category: string;
  count: number;
  sample: string | null;
}

/**
 * Where one line of the 可售验收单 stands.
 *
 * `unknown` and `fail` are not the same answer and must never be collapsed:
 * "no customer has ever connected from 大陆" is a thing nobody has measured,
 * while "every customer who tried failed" is a thing that was measured and
 * came back bad. `pending` is the third: work is already queued that will
 * answer the question, so the operator should wait rather than override.
 */
export const ACCEPTANCE_STATES = ['pass', 'fail', 'unknown', 'pending'] as const;
export type AcceptanceState = (typeof ACCEPTANCE_STATES)[number];

/**
 * One check on the sheet, with the fact it was decided on.
 *
 * `evidence` is the sentence an operator can act on — never a rule name, and
 * never a number without its unit — and `source`/`asOfSec` say who measured it
 * and when, so a green tick from a sweep that last ran a week ago cannot read
 * as a green tick from this morning.
 */
export interface AcceptanceItemDto {
  key: string;
  label: string;
  state: AcceptanceState;
  evidence: string | null;
  asOfSec: number | null;
  source: SourceId;
}

/**
 * 这台机器能不能卖，以及还差什么.
 *
 * `blockers` is the item keys standing between this node and the catalog, so
 * `sellable === (blockers.length === 0)` — the checker enforces the pair,
 * because a sheet that says 可以上架 while listing three blockers is worse
 * than no sheet.
 */
export interface NodeAcceptanceDto {
  items: AcceptanceItemDto[];
  sellable: boolean;
  blockers: string[];
  asOfSec: number | null;
}

/** Appended only when the verdict changes, so the row count is the incident count. */
export interface NodeHistoryEntryDto {
  at: number;
  verdict: NodeVerdict;
  health: NodeHealthWord;
  tone: Tone;
  reason: string | null;
  source: SourceId;
  rulesVersion: number;
}

/** One card, one row. Six cells and nothing else; the rest lives in the detail page. */
export interface NodeSummaryDto {
  name: string;
  verdict: NodeVerdict;
  health: NodeHealthWord;
  tone: Tone;
  /** 凭什么 (R7): one operator sentence, no implementation words. */
  reason: string | null;
  lifecycle: NodeLifecycle;
  catalogListed: boolean | null;
  region: string | null;
  provider: string | null;
  occupancy: Measured<number>;
  quota: Measured<NodeQuotaDto>;
  /** The carrier that looks worst right now — the number the card shows. */
  forwardWorst: Measured<ForwardPathDto | null>;
  returnWorst: Measured<ReturnPathDto | null>;
  renewsAt: number | null;
  expiresAt: number | null;
  choreCount: number;
  incidentCount: number;
  updatedAt: number;
}

export interface NodeDetailDto {
  name: string;
  verdict: NodeVerdict;
  health: NodeHealthWord;
  tone: Tone;
  reason: string | null;
  lifecycle: NodeLifecycle;
  catalogListed: boolean | null;
  facts: NodeFactsDto;
  bindings: NodeBindingsDto;
  forwardPath: Measured<ForwardPathDto[]>;
  returnPath: Measured<ReturnPathDto[]>;
  occupancy: Measured<NodeOccupantDto[]>;
  quota: Measured<NodeQuotaDto>;
  recentErrors: Measured<NodeErrorRowDto[]>;
  jobs: JobDto[];
  history: NodeHistoryEntryDto[];
  updatedAt: number;
}

const FORWARD_KEYS = ['carrier', 'successRate', 'medianTcpMs', 'topFailure', 'attempts', 'users'];

export function assertForwardPath(value: unknown, path = 'forwardPath'): ForwardPathDto {
  const row = fields(value, path, FORWARD_KEYS);
  return {
    carrier: oneOf<CarrierKey>(row, path, 'carrier', CARRIER_KEYS),
    successRate: optNum(row, path, 'successRate'),
    medianTcpMs: optInt(row, path, 'medianTcpMs'),
    topFailure: optText(row, path, 'topFailure'),
    attempts: int(row, path, 'attempts'),
    users: int(row, path, 'users'),
  };
}

const RETURN_KEYS = ['carrier', 'latencyMs', 'lossPct', 'samples'];

export function assertReturnPath(value: unknown, path = 'returnPath'): ReturnPathDto {
  const row = fields(value, path, RETURN_KEYS);
  return {
    carrier: oneOf<CarrierKey>(row, path, 'carrier', CARRIER_KEYS),
    latencyMs: optInt(row, path, 'latencyMs'),
    lossPct: optNum(row, path, 'lossPct'),
    samples: int(row, path, 'samples'),
  };
}

const QUOTA_KEYS = [
  'quota', 'used', 'pct', 'projectedExhaustAt', 'level',
  'cycleKind', 'cycleStart', 'cycleEnd', 'counts',
];

export function assertNodeQuota(value: unknown, path = 'quota'): NodeQuotaDto {
  const row = fields(value, path, QUOTA_KEYS);
  return {
    quota: optInt(row, path, 'quota'),
    used: optInt(row, path, 'used'),
    pct: optNum(row, path, 'pct'),
    projectedExhaustAt: optInt(row, path, 'projectedExhaustAt'),
    level: oneOf<QuotaLevel>(row, path, 'level', QUOTA_LEVELS),
    cycleKind: oneOf<QuotaCycleKind>(row, path, 'cycleKind', QUOTA_CYCLE_KINDS),
    cycleStart: optInt(row, path, 'cycleStart'),
    cycleEnd: optInt(row, path, 'cycleEnd'),
    counts: oneOf<QuotaCounts>(row, path, 'counts', QUOTA_COUNTS),
  };
}

const BINDINGS_KEYS = ['catalog', 'exitToken', 'komari', 'identitySync', 'metering', 'asOfSec'];

export function assertNodeBindings(value: unknown, path = 'bindings'): NodeBindingsDto {
  const row = fields(value, path, BINDINGS_KEYS);
  return {
    catalog: bool(row, path, 'catalog'),
    exitToken: bool(row, path, 'exitToken'),
    komari: bool(row, path, 'komari'),
    identitySync: bool(row, path, 'identitySync'),
    metering: bool(row, path, 'metering'),
    asOfSec: optInt(row, path, 'asOfSec'),
  };
}

const FACTS_KEYS = [
  'publicIp', 'os', 'region', 'provider', 'providerAccountId', 'lineTags', 'port',
  'price', 'currency', 'billingCycle', 'renewsAt', 'expiresAt', 'notes', 'createdAt', 'updatedAt',
];

export function assertNodeFacts(value: unknown, path = 'facts'): NodeFactsDto {
  const row = fields(value, path, FACTS_KEYS);
  return {
    publicIp: optText(row, path, 'publicIp'),
    os: optText(row, path, 'os'),
    region: optText(row, path, 'region'),
    provider: optText(row, path, 'provider'),
    providerAccountId: optText(row, path, 'providerAccountId'),
    lineTags: textList(row, path, 'lineTags'),
    port: optInt(row, path, 'port'),
    price: optNum(row, path, 'price'),
    currency: optText(row, path, 'currency'),
    billingCycle: optInt(row, path, 'billingCycle'),
    renewsAt: optInt(row, path, 'renewsAt'),
    expiresAt: optInt(row, path, 'expiresAt'),
    notes: optText(row, path, 'notes'),
    createdAt: int(row, path, 'createdAt'),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

const OCCUPANT_KEYS = ['userId', 'email', 'deviceId', 'platform', 'appVersion', 'online', 'lastSeenAt'];

export function assertNodeOccupant(value: unknown, path = 'occupant'): NodeOccupantDto {
  const row = fields(value, path, OCCUPANT_KEYS);
  return {
    userId: text(row, path, 'userId'),
    email: text(row, path, 'email'),
    deviceId: optText(row, path, 'deviceId'),
    platform: optOneOf<Platform>(row, path, 'platform', PLATFORMS),
    appVersion: optText(row, path, 'appVersion'),
    online: bool(row, path, 'online'),
    lastSeenAt: int(row, path, 'lastSeenAt'),
  };
}

const ERROR_ROW_KEYS = ['dayAt', 'category', 'count', 'sample'];

export function assertNodeErrorRow(value: unknown, path = 'error'): NodeErrorRowDto {
  const row = fields(value, path, ERROR_ROW_KEYS);
  return {
    dayAt: int(row, path, 'dayAt'),
    category: text(row, path, 'category'),
    count: int(row, path, 'count'),
    sample: optText(row, path, 'sample'),
  };
}

const ACCEPTANCE_ITEM_KEYS = ['key', 'label', 'state', 'evidence', 'asOfSec', 'source'];

export function assertAcceptanceItem(value: unknown, path = 'acceptanceItem'): AcceptanceItemDto {
  const row = fields(value, path, ACCEPTANCE_ITEM_KEYS);
  const asOfSec = optInt(row, path, 'asOfSec');
  // Same rule as `Measured`: a zero here reads as "measured in 1970".
  if (asOfSec !== null && asOfSec <= 0) violation(`${path}.asOfSec`);
  return {
    key: text(row, path, 'key'),
    label: text(row, path, 'label'),
    state: oneOf<AcceptanceState>(row, path, 'state', ACCEPTANCE_STATES),
    evidence: optText(row, path, 'evidence'),
    asOfSec,
    source: oneOf<SourceId>(row, path, 'source', SOURCE_IDS),
  };
}

const ACCEPTANCE_KEYS = ['items', 'sellable', 'blockers', 'asOfSec'];

export function assertNodeAcceptance(value: unknown, path = 'nodeAcceptance'): NodeAcceptanceDto {
  const row = fields(value, path, ACCEPTANCE_KEYS);
  const items = arrayOf(row, path, 'items', assertAcceptanceItem);
  const blockers = textList(row, path, 'blockers');
  const sellable = bool(row, path, 'sellable');
  const asOfSec = optInt(row, path, 'asOfSec');
  if (asOfSec !== null && asOfSec <= 0) violation(`${path}.asOfSec`);
  const keys = new Set(items.map((item) => item.key));
  if (keys.size !== items.length) violation(`${path}.items`);
  // A blocker nobody can point at on the sheet, or a verdict that disagrees
  // with its own list, is a bug on the far side rather than a page to render.
  for (const key of blockers) if (!keys.has(key)) violation(`${path}.blockers`);
  if (sellable !== (blockers.length === 0)) violation(`${path}.sellable`);
  return { items, sellable, blockers, asOfSec };
}

const HISTORY_KEYS = ['at', 'verdict', 'health', 'tone', 'reason', 'source', 'rulesVersion'];

export function assertNodeHistoryEntry(value: unknown, path = 'nodeHistoryEntry'): NodeHistoryEntryDto {
  const row = fields(value, path, HISTORY_KEYS);
  return {
    at: int(row, path, 'at'),
    verdict: oneOf<NodeVerdict>(row, path, 'verdict', NODE_VERDICTS),
    health: oneOf<NodeHealthWord>(row, path, 'health', NODE_HEALTH_WORDS),
    tone: oneOf<Tone>(row, path, 'tone', TONES),
    reason: optText(row, path, 'reason'),
    source: oneOf<SourceId>(row, path, 'source', SOURCE_IDS),
    rulesVersion: int(row, path, 'rulesVersion'),
  };
}

const SUMMARY_KEYS = [
  'name', 'verdict', 'health', 'tone', 'reason', 'lifecycle', 'catalogListed',
  'region', 'provider', 'occupancy', 'quota', 'forwardWorst', 'returnWorst',
  'renewsAt', 'expiresAt', 'choreCount', 'incidentCount', 'updatedAt',
];

export function assertNodeSummary(value: unknown, path = 'nodeSummary'): NodeSummaryDto {
  const row = fields(value, path, SUMMARY_KEYS);
  return {
    name: text(row, path, 'name'),
    verdict: oneOf<NodeVerdict>(row, path, 'verdict', NODE_VERDICTS),
    health: oneOf<NodeHealthWord>(row, path, 'health', NODE_HEALTH_WORDS),
    tone: oneOf<Tone>(row, path, 'tone', TONES),
    reason: optText(row, path, 'reason'),
    lifecycle: oneOf<NodeLifecycle>(row, path, 'lifecycle', NODE_LIFECYCLES),
    catalogListed: optBool(row, path, 'catalogListed'),
    region: optText(row, path, 'region'),
    provider: optText(row, path, 'provider'),
    occupancy: measured(row, path, 'occupancy', measuredInt),
    quota: measured(row, path, 'quota', assertNodeQuota),
    forwardWorst: measured(row, path, 'forwardWorst', (v, at) => (v === null ? null : assertForwardPath(v, at))),
    returnWorst: measured(row, path, 'returnWorst', (v, at) => (v === null ? null : assertReturnPath(v, at))),
    renewsAt: optInt(row, path, 'renewsAt'),
    expiresAt: optInt(row, path, 'expiresAt'),
    choreCount: int(row, path, 'choreCount'),
    incidentCount: int(row, path, 'incidentCount'),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

const DETAIL_KEYS = [
  'name', 'verdict', 'health', 'tone', 'reason', 'lifecycle', 'catalogListed',
  'facts', 'bindings', 'forwardPath', 'returnPath', 'occupancy', 'quota',
  'recentErrors', 'jobs', 'history', 'updatedAt',
];

export function assertNodeDetail(value: unknown, path = 'nodeDetail'): NodeDetailDto {
  const row = fields(value, path, DETAIL_KEYS);
  return {
    name: text(row, path, 'name'),
    verdict: oneOf<NodeVerdict>(row, path, 'verdict', NODE_VERDICTS),
    health: oneOf<NodeHealthWord>(row, path, 'health', NODE_HEALTH_WORDS),
    tone: oneOf<Tone>(row, path, 'tone', TONES),
    reason: optText(row, path, 'reason'),
    lifecycle: oneOf<NodeLifecycle>(row, path, 'lifecycle', NODE_LIFECYCLES),
    catalogListed: optBool(row, path, 'catalogListed'),
    facts: assertNodeFacts(row.facts, `${path}.facts`),
    bindings: assertNodeBindings(row.bindings, `${path}.bindings`),
    forwardPath: measured(row, path, 'forwardPath', measuredArray(assertForwardPath)),
    returnPath: measured(row, path, 'returnPath', measuredArray(assertReturnPath)),
    occupancy: measured(row, path, 'occupancy', measuredArray(assertNodeOccupant)),
    quota: measured(row, path, 'quota', assertNodeQuota),
    recentErrors: measured(row, path, 'recentErrors', measuredArray(assertNodeErrorRow)),
    jobs: arrayOf(row, path, 'jobs', assertJob),
    history: arrayOf(row, path, 'history', assertNodeHistoryEntry),
    updatedAt: int(row, path, 'updatedAt'),
  };
}
