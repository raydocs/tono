// 事故：今天页上那条线，以及点进去的时间线。

import type {
  IncidentClosure,
  IncidentStatus,
  Measured,
  Severity,
  SourceId,
  SubjectType,
  Tone,
} from './vocabulary';
import {
  INCIDENT_CLOSURES,
  INCIDENT_STATUSES,
  SEVERITIES,
  SOURCE_IDS,
  SUBJECT_TYPES,
  TONES,
} from './vocabulary';
import type { ListDto } from './checkers';
import {
  arrayOf,
  assertList,
  fields,
  int,
  oneOf,
  optInt,
  optOneOf,
  optText,
  text,
  violation,
} from './checkers';
import type { JobDto } from './jobs';
import { assertJob } from './jobs';
import type { AlertDeliveryDto } from './alerts';
import { assertAlertDelivery } from './alerts';

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
