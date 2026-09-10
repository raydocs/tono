import type { IncidentDto, ListDto, Severity, WorthwhileDto } from '@contract';
import { getJson, patchJson, postJson } from './api';

/**
 * 跟进 and the two incident fields that go with it.
 *
 * These types are written here rather than imported from `@contract` because
 * the Worker is growing them at the same time as this page: the shapes below
 * are the agreed wire contract, and when the Worker's checkers land they
 * become the imported ones. Keeping them in the console meanwhile is what lets
 * the fixture dev server serve the exact endpoints the pages call, instead of
 * the pages being written against nothing.
 *
 * The console never patches its own copy after one of these writes. A followup
 * marked done, an incident closed as 误报 — the hub owns both records, and what
 * the next read says is the only version worth showing.
 */

export const FOLLOWUP_KINDS = ['reply', 'await_customer', 'callback', 'verified', 'note'] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];

export type FollowupSubjectType = 'user' | 'incident' | 'node';

export type FollowupDto = {
  id: string;
  subjectType: FollowupSubjectType;
  subjectId: string;
  kind: FollowupKind;
  body: string;
  /** When somebody promised to come back. Null is "no date was given". */
  dueAt: number | null;
  /** Null while the followup is still owed; a stamp once it was finished. */
  doneAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * How an incident ended, which is not the same question as whether it ended.
 *
 * `verified` is the only one that means a customer can use the thing again;
 * `false_positive` says the engine was wrong and must never be counted as a
 * recovery; `manual` says the operator stopped following it, which is an
 * honest thing to record and a dishonest thing to render as 已恢复.
 */
export const INCIDENT_CLOSURES = ['verified', 'false_positive', 'manual'] as const;
export type IncidentClosure = (typeof INCIDENT_CLOSURES)[number];

/** The two fields the incident record gains, read off a row that may not carry them yet. */
export type IncidentHandling = {
  nextCheckAt: number | null;
  closure: IncidentClosure | null;
};

export function handlingOf(incident: IncidentDto): IncidentHandling {
  const row = incident as unknown as Partial<IncidentHandling>;
  const closure = row.closure;
  return {
    nextCheckAt: typeof row.nextCheckAt === 'number' ? row.nextCheckAt : null,
    closure: closure && INCIDENT_CLOSURES.includes(closure) ? closure : null,
  };
}

/** One incident on the morning read: enough to name it and say how it ended. */
export type DigestIncidentDto = {
  id: string;
  title: string;
  severity: Severity;
  closure: IncidentClosure | null;
};

/**
 * The hub's shape (contract/followups.ts): full rows, not counts, so a line
 * can link to its own drawer and the block can count without a second read.
 */
export type DigestDto = {
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
  /** 本周最值得做的 ≤3 件事，D5 填内容；现在恒为空。 */
  worthwhile?: WorthwhileDto;
  updatedAt: number;
};

export type FollowupDue = 'today' | 'overdue' | 'open';

const id = (value: string) => encodeURIComponent(value);

export const followupApi = {
  /** Every open followup in the fleet — what the 客户 list's 跟进 column reads. */
  due: (due: FollowupDue, signal?: AbortSignal) =>
    getJson<ListDto<FollowupDto>>('followups', signal, { due }),

  forCustomer: (userId: string, signal?: AbortSignal) =>
    getJson<ListDto<FollowupDto>>(`customers/${id(userId)}/followups`, signal),

  forIncident: (incidentId: string, signal?: AbortSignal) =>
    getJson<ListDto<FollowupDto>>(`incidents/${id(incidentId)}/followups`, signal),

  addForCustomer: (userId: string, input: { kind: FollowupKind; body: string; dueAt?: number | null }) =>
    postJson<FollowupDto>(`customers/${id(userId)}/followups`, input),

  addForIncident: (incidentId: string, input: { kind: FollowupKind; body: string; dueAt?: number | null }) =>
    postJson<FollowupDto>(`incidents/${id(incidentId)}/followups`, input),

  /** `done: true` stamps `doneAt`; the hub decides with which clock. */
  patch: (followupId: string, patch: { done?: boolean; body?: string; dueAt?: number | null }) =>
    patchJson<FollowupDto>(`followups/${id(followupId)}`, patch),

  digest: (signal?: AbortSignal, day?: string) =>
    getJson<DigestDto>('digest', signal, day === undefined ? undefined : { day }),

  /**
   * Closing an incident. `closure` is required by the hub — a resolve with no
   * word for how it ended is exactly the write this whole card exists to stop.
   */
  resolve: (incidentId: string, closure: IncidentClosure, note?: string) =>
    postJson<IncidentDto>(
      `incidents/${id(incidentId)}/resolve`,
      note === undefined ? { closure } : { closure, note },
    ),

  setNextCheck: (incidentId: string, nextCheckAt: number) =>
    patchJson<IncidentDto>(`incidents/${id(incidentId)}`, { nextCheckAt }),
};
