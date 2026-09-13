// 本周最值得做的三件事.
//
// The digest already says what happened; this says what to do about it, and
// refuses to say more than three. The DTO carries no sentences on purpose:
// `kind` + `subjectLabel` + a number is everything the console needs to write
// the line itself, and a sentence built in the Worker is a sentence the copy
// lint rule cannot see and the console cannot re-word.

import { bool, fields, int, num, oneOf, optInt, optText, text, violation } from './checkers';

export const WORTHWHILE_KINDS = [
  'idle_node',
  'quota_exhausting',
  'node_renewal',
  'line_renewal',
  'repeat_repair',
  'route_direct',
  'followup_overdue',
  'month_unclosed',
] as const;
export type WorthwhileKind = (typeof WORTHWHILE_KINDS)[number];

export const WORTHWHILE_SUBJECT_TYPES = ['node', 'user', 'home_exit', 'etld1', 'followup', 'month'] as const;
export type WorthwhileSubjectType = (typeof WORTHWHILE_SUBJECT_TYPES)[number];

/** `cny` is minor units (fen), so a payoff never arrives as a float. */
export const PAYOFF_KINDS = ['cny', 'hours', 'customers'] as const;
export type PayoffKind = (typeof PAYOFF_KINDS)[number];

export const METRIC_KINDS = ['incidents', 'days', 'bytes', 'customers', 'cnyMinor'] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** Where 去处理 lands. One of the four pages the console actually has. */
export const WORTHWHILE_PAGES = ['today', 'nodes', 'customers', 'settings'] as const;
export type WorthwhilePage = (typeof WORTHWHILE_PAGES)[number];

/** `isEstimate` is never dropped: an estimated yuan and a measured one read alike. */
export interface PayoffDto {
  kind: PayoffKind;
  value: number;
  isEstimate: boolean;
}

export interface MetricDto {
  kind: MetricKind;
  value: number;
}

export interface WorthwhileActionDto {
  page: WorthwhilePage;
  section: string | null;
  subjectId: string | null;
}

export interface WorthwhilePickDto {
  /** `${kind}:${subjectType}:${subjectId}:${weekOf}` — stable within a week. */
  id: string;
  kind: WorthwhileKind;
  subjectType: WorthwhileSubjectType;
  subjectId: string;
  /**
   * Display-safe label: node catalog name, home line name, etld1, follow-up
   * title, month string. For users this is the user id — the console resolves
   * and masks it, because masking is a rendering decision, not a wire one.
   */
  subjectLabel: string;
  /** The fact behind the pick (incidents: 3, days: 5, bytes: 5e10). */
  metric: MetricDto | null;
  /** null = cannot be estimated. */
  payoff: PayoffDto | null;
  confidence: ConfidenceLevel;
  /** Renewal / exhaustion / due time when there is one. */
  deadlineSec: number | null;
  evidenceAsOfSec: number | null;
  action: WorthwhileActionDto;
}

export interface WorthwhileDto {
  /** Monday of the week, Asia/Shanghai, `YYYY-MM-DD`. */
  weekOf: string;
  computedAt: number;
  picks: WorthwhilePickDto[];
  considered: number;
}

/** Three is the whole point: a fourth line is a list, and a list is not a plan. */
const MAX_PICKS = 3;
const WEEK_OF_RE = /^\d{4}-\d{2}-\d{2}$/;

const PAYOFF_KEYS = ['kind', 'value', 'isEstimate'];
const METRIC_KEYS = ['kind', 'value'];
const ACTION_KEYS = ['page', 'section', 'subjectId'];
const PICK_KEYS = [
  'id', 'kind', 'subjectType', 'subjectId', 'subjectLabel', 'metric', 'payoff',
  'confidence', 'deadlineSec', 'evidenceAsOfSec', 'action',
];
const WORTHWHILE_KEYS = ['weekOf', 'computedAt', 'picks', 'considered'];

function assertPayoff(value: unknown, path: string): PayoffDto | null {
  if (value === null) return null;
  const row = fields(value, path, PAYOFF_KEYS);
  return {
    kind: oneOf<PayoffKind>(row, path, 'kind', PAYOFF_KINDS),
    value: num(row, path, 'value'),
    isEstimate: bool(row, path, 'isEstimate'),
  };
}

function assertMetric(value: unknown, path: string): MetricDto | null {
  if (value === null) return null;
  const row = fields(value, path, METRIC_KEYS);
  return {
    kind: oneOf<MetricKind>(row, path, 'kind', METRIC_KINDS),
    value: num(row, path, 'value'),
  };
}

function assertAction(value: unknown, path: string): WorthwhileActionDto {
  const row = fields(value, path, ACTION_KEYS);
  return {
    page: oneOf<WorthwhilePage>(row, path, 'page', WORTHWHILE_PAGES),
    section: optText(row, path, 'section'),
    subjectId: optText(row, path, 'subjectId'),
  };
}

export function assertWorthwhilePick(value: unknown, path = 'worthwhilePick'): WorthwhilePickDto {
  const row = fields(value, path, PICK_KEYS);
  const deadlineSec = optInt(row, path, 'deadlineSec');
  if (deadlineSec !== null && deadlineSec <= 0) violation(`${path}.deadlineSec`);
  const evidenceAsOfSec = optInt(row, path, 'evidenceAsOfSec');
  if (evidenceAsOfSec !== null && evidenceAsOfSec <= 0) violation(`${path}.evidenceAsOfSec`);
  return {
    id: text(row, path, 'id'),
    kind: oneOf<WorthwhileKind>(row, path, 'kind', WORTHWHILE_KINDS),
    subjectType: oneOf<WorthwhileSubjectType>(row, path, 'subjectType', WORTHWHILE_SUBJECT_TYPES),
    subjectId: text(row, path, 'subjectId'),
    subjectLabel: text(row, path, 'subjectLabel'),
    metric: assertMetric(row.metric, `${path}.metric`),
    payoff: assertPayoff(row.payoff, `${path}.payoff`),
    confidence: oneOf<ConfidenceLevel>(row, path, 'confidence', CONFIDENCE_LEVELS),
    deadlineSec,
    evidenceAsOfSec,
    action: assertAction(row.action, `${path}.action`),
  };
}

export function assertWorthwhile(value: unknown, path = 'worthwhile'): WorthwhileDto {
  const row = fields(value, path, WORTHWHILE_KEYS);
  const weekOf = text(row, path, 'weekOf');
  if (!WEEK_OF_RE.test(weekOf)) violation(`${path}.weekOf`);
  const raw = row.picks;
  if (!Array.isArray(raw)) violation(`${path}.picks`);
  if ((raw as unknown[]).length > MAX_PICKS) violation(`${path}.picks`);
  return {
    weekOf,
    computedAt: int(row, path, 'computedAt'),
    picks: (raw as unknown[]).map((entry, index) => assertWorthwhilePick(entry, `${path}.picks[${index}]`)),
    considered: int(row, path, 'considered'),
  };
}
