// 任务：排队、租约、结果，今天页和节点页读的东西。

import type {
  JobExecutor,
  JobStatus,
  JobType,
  SubjectType,
} from './vocabulary';
import {
  JOB_EXECUTORS,
  JOB_STATUSES,
  JOB_TYPES,
  SUBJECT_TYPES,
} from './vocabulary';
import {
  fields,
  int,
  oneOf,
  optInt,
  optText,
  text,
  violation,
} from './checkers';

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
