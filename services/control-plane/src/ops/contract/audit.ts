// 操作记录：谁在什么时候动了什么。

import {
  arrayOf,
  bool,
  fields,
  int,
  optInt,
  optOneOf,
  optText,
  text,
} from './checkers';

export const ACTOR_TYPES = ['access_admin', 'token_admin', 'collector', 'exit_node', 'system'] as const;
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
  actorType: ActorType | null;
  actorRole: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string | null;
  requestId: string | null;
}

/**
 * Shared-admin's audit page, not the standard list envelope: it pages on
 * `(at, id)` with `before`/`beforeId` rather than a cursor string.
 */
export interface AuditListDto {
  entries: AuditEntryDto[];
  hasMore: boolean;
  nextBefore: number | null;
  nextBeforeId: string | null;
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
    actorType: optOneOf<ActorType>(row, path, 'actorType', ACTOR_TYPES),
    actorRole: optText(row, path, 'actorRole'),
    action: text(row, path, 'action'),
    targetType: text(row, path, 'targetType'),
    targetId: optText(row, path, 'targetId'),
    summary: optText(row, path, 'summary'),
    requestId: optText(row, path, 'requestId'),
  };
}

const AUDIT_LIST_KEYS = ['entries', 'hasMore', 'nextBefore', 'nextBeforeId'];

export function assertAuditList(value: unknown, path = 'audit'): AuditListDto {
  const row = fields(value, path, AUDIT_LIST_KEYS);
  return {
    entries: arrayOf(row, path, 'entries', assertAuditEntry),
    hasMore: bool(row, path, 'hasMore'),
    nextBefore: optInt(row, path, 'nextBefore'),
    nextBeforeId: optText(row, path, 'nextBeforeId'),
  };
}
