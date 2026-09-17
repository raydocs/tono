// 变更回执: 每个运维动作都有做之前、做之后、客户端确认了吗、回退了吗。

import {
  fields,
  int,
  oneOf,
  optText,
  text,
} from './checkers';

export const CHANGE_RECEIPT_KINDS = [
  'catalog_retire',
  'catalog_relist',
  'identity_sync',
  'catalog_publish',
  'policy_publish',
  'xray_restart',
] as const;
export type ChangeReceiptKind = (typeof CHANGE_RECEIPT_KINDS)[number];

export interface ChangeReceiptDto {
  id: string;
  kind: ChangeReceiptKind;
  subjectType: string;
  subjectId: string;
  incidentId: string | null;
  jobId: string | null;
  before: unknown;
  after: unknown;
  clientAcks: number;
  rollbackOf: string | null;
  actor: string | null;
  at: number;
}

const CHANGE_RECEIPT_KEYS = [
  'id',
  'kind',
  'subjectType',
  'subjectId',
  'incidentId',
  'jobId',
  'before',
  'after',
  'clientAcks',
  'rollbackOf',
  'actor',
  'at',
];

export function assertChangeReceipt(value: unknown, path = 'changeReceipt'): ChangeReceiptDto {
  const row = fields(value, path, CHANGE_RECEIPT_KEYS);
  return {
    id: text(row, path, 'id'),
    kind: oneOf<ChangeReceiptKind>(row, path, 'kind', CHANGE_RECEIPT_KINDS),
    subjectType: text(row, path, 'subjectType'),
    subjectId: text(row, path, 'subjectId'),
    incidentId: optText(row, path, 'incidentId'),
    jobId: optText(row, path, 'jobId'),
    before: row.before === undefined ? null : row.before,
    after: row.after === undefined ? null : row.after,
    clientAcks: int(row, path, 'clientAcks'),
    rollbackOf: optText(row, path, 'rollbackOf'),
    actor: optText(row, path, 'actor'),
    at: int(row, path, 'at'),
  };
}
