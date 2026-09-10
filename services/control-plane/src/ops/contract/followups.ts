// Follow-ups and the morning digest. Lives apart from operations.ts so that
// file stays under the 500-line ops budget after IncidentDto grew.

import type { FollowupKind, FollowupSubjectType } from './vocabulary';
import { FOLLOWUP_KINDS, FOLLOWUP_SUBJECT_TYPES } from './vocabulary';
import type { IncidentDto } from './operations';
import { assertIncident } from './operations';
import {
  arrayOf,
  assertList,
  fields,
  int,
  oneOf,
  optInt,
  optText,
  text,
} from './checkers';

export interface FollowupDto {
  id: string;
  subjectType: FollowupSubjectType;
  subjectId: string;
  kind: FollowupKind;
  body: string;
  dueAt: number | null;
  doneAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DigestDto {
  day: string;
  overnight: {
    resolved: IncidentDto[];
    opened: IncidentDto[];
  };
  open: IncidentDto[];
  due: {
    followups: FollowupDto[];
    checks: IncidentDto[];
  };
  updatedAt: number;
}

const FOLLOWUP_KEYS = [
  'id', 'subjectType', 'subjectId', 'kind', 'body',
  'dueAt', 'doneAt', 'createdBy', 'createdAt', 'updatedAt',
];

export function assertFollowup(value: unknown, path = 'followup'): FollowupDto {
  const row = fields(value, path, FOLLOWUP_KEYS);
  return {
    id: text(row, path, 'id'),
    subjectType: oneOf<FollowupSubjectType>(row, path, 'subjectType', FOLLOWUP_SUBJECT_TYPES),
    subjectId: text(row, path, 'subjectId'),
    kind: oneOf<FollowupKind>(row, path, 'kind', FOLLOWUP_KINDS),
    body: text(row, path, 'body'),
    dueAt: optInt(row, path, 'dueAt'),
    doneAt: optInt(row, path, 'doneAt'),
    createdBy: optText(row, path, 'createdBy'),
    createdAt: int(row, path, 'createdAt'),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

export const assertFollowupList = (value: unknown) => assertList(value, assertFollowup);

const DIGEST_KEYS = ['day', 'overnight', 'open', 'due', 'updatedAt'];
const OVERNIGHT_KEYS = ['resolved', 'opened'];
const DUE_KEYS = ['followups', 'checks'];

export function assertDigest(value: unknown, path = 'digest'): DigestDto {
  const row = fields(value, path, DIGEST_KEYS);
  const overnight = fields(row.overnight, `${path}.overnight`, OVERNIGHT_KEYS);
  const due = fields(row.due, `${path}.due`, DUE_KEYS);
  return {
    day: text(row, path, 'day'),
    overnight: {
      resolved: arrayOf(overnight, `${path}.overnight`, 'resolved', assertIncident),
      opened: arrayOf(overnight, `${path}.overnight`, 'opened', assertIncident),
    },
    open: arrayOf(row, path, 'open', assertIncident),
    due: {
      followups: arrayOf(due, `${path}.due`, 'followups', assertFollowup),
      checks: arrayOf(due, `${path}.due`, 'checks', assertIncident),
    },
    updatedAt: int(row, path, 'updatedAt'),
  };
}
