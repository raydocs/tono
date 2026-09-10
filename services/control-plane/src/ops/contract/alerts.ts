// 告警：规则和投递记录，谁在什么时候被推了什么。

import type {
  AlertChannel,
  AlertTemplate,
  Severity,
} from './vocabulary';
import {
  ALERT_CHANNELS,
  ALERT_TEMPLATES,
  SEVERITIES,
} from './vocabulary';
import {
  bool,
  fields,
  int,
  oneOf,
  optInt,
  optText,
  text,
} from './checkers';

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
