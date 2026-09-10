// 事故、任务、发布、告警：今天页和客户端页读的东西。

import type {
  AlertChannel,
  AlertTemplate,
  IncidentClosure,
  IncidentStatus,
  JobExecutor,
  JobStatus,
  JobType,
  Measured,
  Platform,
  RangeKey,
  ReleaseChannel,
  Severity,
  SourceId,
  SubjectType,
  Tone,
} from './vocabulary';
import {
  ALERT_CHANNELS,
  ALERT_TEMPLATES,
  INCIDENT_CLOSURES,
  INCIDENT_STATUSES,
  JOB_EXECUTORS,
  JOB_STATUSES,
  JOB_TYPES,
  PLATFORMS,
  RANGE_KEYS,
  RELEASE_CHANNELS,
  SEVERITIES,
  SOURCE_IDS,
  SUBJECT_TYPES,
  TONES,
} from './vocabulary';
import type { ListDto } from './checkers';
import {
  arrayOf,
  assertList,
  bool,
  enumList,
  fields,
  int,
  oneOf,
  optInt,
  optOneOf,
  optText,
  text,
  violation,
} from './checkers';

/**
 * One labelled measurement backing an incident — the 凭什么 line (R7).
 *
 * It is a `Measured<string>` with a label rather than a free-text blob so the
 * drawer can render "大陆三网探测 · 3 分钟前 · collector" without parsing prose.
 */
export interface IncidentEvidenceDto extends Measured<string> {
  label: string;
}

export interface IncidentDto {
  id: string;
  dedupeKey: string;
  kind: string;
  subjectType: SubjectType;
  subjectId: string | null;
  severity: Severity;
  status: IncidentStatus;
  tone: Tone;
  /** 主语先行说结论. One line, operator language, no implementation words. */
  title: string;
  summary: string | null;
  /** Set when this rolls up under a node incident, so thirty customers push once. */
  parentIncidentId: string | null;
  rulesVersion: number;
  impactCount: number;
  evidence: IncidentEvidenceDto[];
  openedAt: number;
  lastSeenAt: number;
  ackedAt: number | null;
  snoozedUntil: number | null;
  resolvedAt: number | null;
  nextCheckAt: number | null;
  /** Null until an operator closes it; engine recovery leaves this null. */
  closure: IncidentClosure | null;
}

export const INCIDENT_EVENT_TYPES = [
  'opened',
  'escalated',
  'deescalated',
  'acked',
  'snoozed',
  'note',
  'job',
  'alert',
  'resolved',
] as const;
export type IncidentEventType = (typeof INCIDENT_EVENT_TYPES)[number];

/** Written only on a state change, so the timeline is the history, not a re-derivation. */
export interface IncidentEventDto {
  id: string;
  incidentId: string;
  at: number;
  type: IncidentEventType;
  actor: string | null;
  note: string | null;
}

export interface IncidentDetailDto {
  incident: IncidentDto;
  events: ListDto<IncidentEventDto>;
  jobs: ListDto<JobDto>;
  deliveries: ListDto<AlertDeliveryDto>;
}

/** Job parameters stay scalar (plus string lists): the hub's handlers take no nested objects. */
export type JobParamValue = string | number | boolean | string[] | null;
export type JobParamsDto = Record<string, JobParamValue>;

export interface JobDto {
  id: string;
  type: JobType;
  executor: JobExecutor;
  status: JobStatus;
  subjectType: SubjectType;
  subjectId: string | null;
  params: JobParamsDto;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  requestedBy: string | null;
  incidentId: string | null;
  notBefore: number | null;
  expiresAt: number | null;
  leasedUntil: number | null;
  resultSummary: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export interface ReleaseDto {
  id: string;
  platform: Platform;
  channel: ReleaseChannel;
  version: string;
  build: string | null;
  r2Key: string | null;
  sha256: string | null;
  notes: string | null;
  /** Drives the 版本过旧 chore; null means nothing is too old yet. */
  minSupportedVersion: string | null;
  publishedAt: number | null;
  withdrawnAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export const ADOPTION_BUCKETS = ['current', 'behind_one', 'behind_more', 'unreported'] as const;
export type AdoptionBucket = (typeof ADOPTION_BUCKETS)[number];

export interface AdoptionCellDto {
  platform: Platform;
  bucket: AdoptionBucket;
  users: number;
  devices: number;
}

/**
 * 平台 × 版本档.
 *
 * `released` is the platforms that have ever published a build. A platform
 * absent from it renders 未发布 rather than a column of zeros — a zero there
 * would read as "nobody upgraded" when the truth is "nothing shipped".
 */
export interface AdoptionMatrixDto {
  range: RangeKey;
  released: Platform[];
  cells: AdoptionCellDto[];
  updatedAt: number;
}

export const ALERT_FIRE_ON = ['open', 'open_resolve'] as const;
export type AlertFireOn = (typeof ALERT_FIRE_ON)[number];

export interface AlertRuleDto {
  id: string;
  name: string;
  enabled: boolean;
  matchKind: string | null;
  matchSubjectType: string | null;
  matchSubjectId: string | null;
  minSeverity: Severity;
  minImpact: number;
  fireOn: AlertFireOn;
  /** 90 秒的抖动不推: nothing leaves before an incident has survived this long. */
  delaySeconds: number;
  cooldownSeconds: number;
  channel: AlertChannel;
  target: string;
  template: AlertTemplate;
  /** The name of a Worker secret. Credentials never enter the database. */
  secretRef: string | null;
  lastFiredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export const DELIVERY_STATUSES = ['pending', 'sent', 'failed', 'suppressed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_TRANSITIONS = ['open', 'escalate', 'resolve', 'test'] as const;
export type DeliveryTransition = (typeof DELIVERY_TRANSITIONS)[number];

/** A cooled-down alert is recorded as `suppressed`, not dropped — silence must be explainable. */
export interface AlertDeliveryDto {
  id: string;
  ruleId: string;
  incidentId: string | null;
  dedupeKey: string;
  transition: DeliveryTransition;
  status: DeliveryStatus;
  channel: AlertChannel;
  target: string;
  attempts: number;
  error: string | null;
  at: number;
  deliveredAt: number | null;
}

const EVIDENCE_KEYS = ['label', 'value', 'asOfSec', 'source'];

export function assertIncidentEvidence(value: unknown, path = 'evidence'): IncidentEvidenceDto {
  const row = fields(value, path, EVIDENCE_KEYS);
  const asOfSec = optInt(row, path, 'asOfSec');
  if (asOfSec !== null && asOfSec <= 0) violation(`${path}.asOfSec`);
  return {
    label: text(row, path, 'label'),
    value: text(row, path, 'value'),
    asOfSec,
    source: oneOf<SourceId>(row, path, 'source', SOURCE_IDS),
  };
}

const INCIDENT_KEYS = [
  'id', 'dedupeKey', 'kind', 'subjectType', 'subjectId', 'severity', 'status', 'tone',
  'title', 'summary', 'parentIncidentId', 'rulesVersion', 'impactCount', 'evidence',
  'openedAt', 'lastSeenAt', 'ackedAt', 'snoozedUntil', 'resolvedAt',
  'nextCheckAt', 'closure',
];

export function assertIncident(value: unknown, path = 'incident'): IncidentDto {
  const row = fields(value, path, INCIDENT_KEYS);
  return {
    id: text(row, path, 'id'),
    dedupeKey: text(row, path, 'dedupeKey'),
    kind: text(row, path, 'kind'),
    subjectType: oneOf<SubjectType>(row, path, 'subjectType', SUBJECT_TYPES),
    subjectId: optText(row, path, 'subjectId'),
    severity: oneOf<Severity>(row, path, 'severity', SEVERITIES),
    status: oneOf<IncidentStatus>(row, path, 'status', INCIDENT_STATUSES),
    tone: oneOf<Tone>(row, path, 'tone', TONES),
    title: text(row, path, 'title'),
    summary: optText(row, path, 'summary'),
    parentIncidentId: optText(row, path, 'parentIncidentId'),
    rulesVersion: int(row, path, 'rulesVersion'),
    impactCount: int(row, path, 'impactCount'),
    evidence: arrayOf(row, path, 'evidence', assertIncidentEvidence),
    openedAt: int(row, path, 'openedAt'),
    lastSeenAt: int(row, path, 'lastSeenAt'),
    ackedAt: optInt(row, path, 'ackedAt'),
    snoozedUntil: optInt(row, path, 'snoozedUntil'),
    resolvedAt: optInt(row, path, 'resolvedAt'),
    nextCheckAt: optInt(row, path, 'nextCheckAt'),
    closure: optOneOf<IncidentClosure>(row, path, 'closure', INCIDENT_CLOSURES),
  };
}

const INCIDENT_EVENT_KEYS = ['id', 'incidentId', 'at', 'type', 'actor', 'note'];

export function assertIncidentEvent(value: unknown, path = 'incidentEvent'): IncidentEventDto {
  const row = fields(value, path, INCIDENT_EVENT_KEYS);
  return {
    id: text(row, path, 'id'),
    incidentId: text(row, path, 'incidentId'),
    at: int(row, path, 'at'),
    type: oneOf<IncidentEventType>(row, path, 'type', INCIDENT_EVENT_TYPES),
    actor: optText(row, path, 'actor'),
    note: optText(row, path, 'note'),
  };
}

const INCIDENT_DETAIL_KEYS = ['incident', 'events', 'jobs', 'deliveries'];

export function assertIncidentDetail(value: unknown, path = 'incidentDetail'): IncidentDetailDto {
  const row = fields(value, path, INCIDENT_DETAIL_KEYS);
  return {
    incident: assertIncident(row.incident, `${path}.incident`),
    events: assertList(row.events, assertIncidentEvent, `${path}.events`),
    jobs: assertList(row.jobs, assertJob, `${path}.jobs`),
    deliveries: assertList(row.deliveries, assertAlertDelivery, `${path}.deliveries`),
  };
}

const JOB_KEYS = [
  'id', 'type', 'executor', 'status', 'subjectType', 'subjectId', 'params', 'attempts',
  'maxAttempts', 'idempotencyKey', 'requestedBy', 'incidentId', 'notBefore', 'expiresAt',
  'leasedUntil', 'resultSummary', 'createdAt', 'updatedAt', 'finishedAt',
];

function jobParams(value: unknown, path: string): JobParamsDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) violation(path);
  const params: JobParamsDto = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const at = `${path}.${key}`;
    if (entry === null) {
      params[key] = null;
      continue;
    }
    const kind = typeof entry;
    if (kind === 'string' || kind === 'boolean') {
      params[key] = entry as string | boolean;
      continue;
    }
    if (kind === 'number') {
      if (!Number.isFinite(entry as number)) violation(at);
      params[key] = entry as number;
      continue;
    }
    if (Array.isArray(entry) && entry.every((item) => typeof item === 'string')) {
      params[key] = entry as string[];
      continue;
    }
    violation(at);
  }
  return params;
}

export function assertJob(value: unknown, path = 'job'): JobDto {
  const row = fields(value, path, JOB_KEYS);
  return {
    id: text(row, path, 'id'),
    type: oneOf<JobType>(row, path, 'type', JOB_TYPES),
    executor: oneOf<JobExecutor>(row, path, 'executor', JOB_EXECUTORS),
    status: oneOf<JobStatus>(row, path, 'status', JOB_STATUSES),
    subjectType: oneOf<SubjectType>(row, path, 'subjectType', SUBJECT_TYPES),
    subjectId: optText(row, path, 'subjectId'),
    params: jobParams(row.params, `${path}.params`),
    attempts: int(row, path, 'attempts'),
    maxAttempts: int(row, path, 'maxAttempts'),
    idempotencyKey: text(row, path, 'idempotencyKey'),
    requestedBy: optText(row, path, 'requestedBy'),
    incidentId: optText(row, path, 'incidentId'),
    notBefore: optInt(row, path, 'notBefore'),
    expiresAt: optInt(row, path, 'expiresAt'),
    leasedUntil: optInt(row, path, 'leasedUntil'),
    resultSummary: optText(row, path, 'resultSummary'),
    createdAt: int(row, path, 'createdAt'),
    updatedAt: int(row, path, 'updatedAt'),
    finishedAt: optInt(row, path, 'finishedAt'),
  };
}

const RELEASE_KEYS = [
  'id', 'platform', 'channel', 'version', 'build', 'r2Key', 'sha256', 'notes',
  'minSupportedVersion', 'publishedAt', 'withdrawnAt', 'createdAt', 'updatedAt',
];

export function assertRelease(value: unknown, path = 'release'): ReleaseDto {
  const row = fields(value, path, RELEASE_KEYS);
  return {
    id: text(row, path, 'id'),
    platform: oneOf<Platform>(row, path, 'platform', PLATFORMS),
    channel: oneOf<ReleaseChannel>(row, path, 'channel', RELEASE_CHANNELS),
    version: text(row, path, 'version'),
    build: optText(row, path, 'build'),
    r2Key: optText(row, path, 'r2Key'),
    sha256: optText(row, path, 'sha256'),
    notes: optText(row, path, 'notes'),
    minSupportedVersion: optText(row, path, 'minSupportedVersion'),
    publishedAt: optInt(row, path, 'publishedAt'),
    withdrawnAt: optInt(row, path, 'withdrawnAt'),
    createdAt: int(row, path, 'createdAt'),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

const ADOPTION_CELL_KEYS = ['platform', 'bucket', 'users', 'devices'];

export function assertAdoptionCell(value: unknown, path = 'adoptionCell'): AdoptionCellDto {
  const row = fields(value, path, ADOPTION_CELL_KEYS);
  return {
    platform: oneOf<Platform>(row, path, 'platform', PLATFORMS),
    bucket: oneOf<AdoptionBucket>(row, path, 'bucket', ADOPTION_BUCKETS),
    users: int(row, path, 'users'),
    devices: int(row, path, 'devices'),
  };
}

const ADOPTION_KEYS = ['range', 'released', 'cells', 'updatedAt'];

export function assertAdoptionMatrix(value: unknown, path = 'adoption'): AdoptionMatrixDto {
  const row = fields(value, path, ADOPTION_KEYS);
  return {
    range: oneOf<RangeKey>(row, path, 'range', RANGE_KEYS),
    released: enumList<Platform>(row, path, 'released', PLATFORMS),
    cells: arrayOf(row, path, 'cells', assertAdoptionCell),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

const ALERT_RULE_KEYS = [
  'id', 'name', 'enabled', 'matchKind', 'matchSubjectType', 'matchSubjectId',
  'minSeverity', 'minImpact', 'fireOn',
  'delaySeconds', 'cooldownSeconds', 'channel', 'target', 'template', 'secretRef',
  'lastFiredAt', 'createdAt', 'updatedAt',
];

export function assertAlertRule(value: unknown, path = 'alertRule'): AlertRuleDto {
  const row = fields(value, path, ALERT_RULE_KEYS);
  return {
    id: text(row, path, 'id'),
    name: text(row, path, 'name'),
    enabled: bool(row, path, 'enabled'),
    matchKind: optText(row, path, 'matchKind'),
    matchSubjectType: optText(row, path, 'matchSubjectType'),
    matchSubjectId: optText(row, path, 'matchSubjectId'),
    minSeverity: oneOf<Severity>(row, path, 'minSeverity', SEVERITIES),
    minImpact: int(row, path, 'minImpact'),
    fireOn: oneOf<AlertFireOn>(row, path, 'fireOn', ALERT_FIRE_ON),
    delaySeconds: int(row, path, 'delaySeconds'),
    cooldownSeconds: int(row, path, 'cooldownSeconds'),
    channel: oneOf<AlertChannel>(row, path, 'channel', ALERT_CHANNELS),
    target: text(row, path, 'target'),
    template: oneOf<AlertTemplate>(row, path, 'template', ALERT_TEMPLATES),
    secretRef: optText(row, path, 'secretRef'),
    lastFiredAt: optInt(row, path, 'lastFiredAt'),
    createdAt: int(row, path, 'createdAt'),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

const DELIVERY_KEYS = [
  'id', 'ruleId', 'incidentId', 'dedupeKey', 'transition', 'status',
  'channel', 'target', 'attempts', 'error', 'at', 'deliveredAt',
];

export function assertAlertDelivery(value: unknown, path = 'alertDelivery'): AlertDeliveryDto {
  const row = fields(value, path, DELIVERY_KEYS);
  return {
    id: text(row, path, 'id'),
    ruleId: text(row, path, 'ruleId'),
    incidentId: optText(row, path, 'incidentId'),
    dedupeKey: text(row, path, 'dedupeKey'),
    transition: oneOf<DeliveryTransition>(row, path, 'transition', DELIVERY_TRANSITIONS),
    status: oneOf<DeliveryStatus>(row, path, 'status', DELIVERY_STATUSES),
    channel: oneOf<AlertChannel>(row, path, 'channel', ALERT_CHANNELS),
    target: text(row, path, 'target'),
    attempts: int(row, path, 'attempts'),
    error: optText(row, path, 'error'),
    at: int(row, path, 'at'),
    deliveredAt: optInt(row, path, 'deliveredAt'),
  };
}
