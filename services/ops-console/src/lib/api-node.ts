import type {
  ConnectionEventDto,
  JobDto,
  JobParamsDto,
  JobType,
  ListDto,
  Measured,
  NodeDetailDto,
  NodeErrorRowDto,
  NodeHistoryEntryDto,
  QuotaCounts,
  QuotaCycleKind,
  RangeKey,
} from '@contract';
import { getJson, patchJson, postJson } from './api';

/**
 * The 节点详情 page's own half of the wire.
 *
 * It sits beside `api.ts` rather than inside it because everything here is
 * asked for by one page, and because the two write paths below do not agree
 * with each other: new work goes through the job queue, while 退役 still runs
 * the older preview-then-confirm pair that edits the catalog in place. Keeping
 * that split visible in one file is better than hiding it behind a uniform
 * method name that would let a caller retire a node thinking it queued a job.
 */

function nodePath(name: string, tail = ''): string {
  return `nodes/${encodeURIComponent(name)}${tail}`;
}

/**
 * The Worker rejects a destructive type whose `confirmName` is not the node's
 * own name, so the field is not decoration: it is the same check the dialog
 * makes, made again by the side that owns the machine.
 */
export type NodeJobRequest = {
  type: JobType;
  params?: JobParamsDto;
  confirmName?: string;
  incidentId?: string | null;
  idempotencyKey?: string;
};

/** What 退役 costs, read before it is paid. `nextYaml` is not sent to the console. */
export type RetirePreviewDto = {
  expectedRevision: number;
  currentRevision: number;
  affectedUsers: Array<{ userId: string; lastSeenAt: number }>;
  warnings: string[];
  canRetire: boolean;
};

export type RetireRequest = {
  expectedRevision: number;
  confirmation: string;
  reason: string;
};

/**
 * The allowance as the 商家 sells it, which is four separate decisions: how
 * much, when the counter turns over, which day it turns over on, and which
 * direction is billed. The three counting rules disagree by a factor of two,
 * so none of them is a safe default to guess.
 */
export type NodeQuotaInput = {
  quotaBytes: number;
  cycleKind: QuotaCycleKind;
  cycleAnchorDay: number;
  counts: QuotaCounts;
};

/**
 * What the 这台机器 form sends.
 *
 * Every key is optional and the Worker refuses one it does not know, so the
 * form sends the fields it owns and nothing else — the measured half of the
 * page (the address, the system, the five registrations) is not in here
 * because nobody types it. `quota: null` is how an allowance is taken off
 * again; leaving the key out would mean "unchanged", which is a different
 * answer.
 */
export type NodeProfileInput = {
  provider?: string | null;
  providerAccountId?: string | null;
  region?: string | null;
  lineTags?: string[];
  port?: number | null;
  price?: number | null;
  currency?: string | null;
  /** Days in one billing period, the way it is written on the invoice. */
  billingCycle?: number | null;
  renewsAt?: number | null;
  expiresAt?: number | null;
  notes?: string | null;
  quota?: NodeQuotaInput | null;
};

export const nodeApi = {
  detail: (name: string, signal?: AbortSignal) =>
    getJson<NodeDetailDto>(nodePath(name), signal),
  connections: (name: string, signal?: AbortSignal) =>
    getJson<ListDto<ConnectionEventDto>>(nodePath(name, '/connections'), signal),
  errors: (name: string, range: RangeKey, signal?: AbortSignal) =>
    getJson<Measured<NodeErrorRowDto[]>>(nodePath(name, '/errors'), signal, { range }),
  history: (name: string, signal?: AbortSignal) =>
    getJson<ListDto<NodeHistoryEntryDto>>(nodePath(name, '/history'), signal),
  jobs: (name: string, signal?: AbortSignal) =>
    getJson<ListDto<JobDto>>(nodePath(name, '/jobs'), signal),

  /**
   * The hand-kept half of the node, written back. It answers with the whole
   * detail rather than the profile alone, so the page re-reads one response
   * instead of stitching a patch into what it already had.
   */
  saveProfile: (name: string, input: NodeProfileInput) =>
    patchJson<NodeDetailDto>(nodePath(name, '/profile'), input),

  enqueueJob: (name: string, request: NodeJobRequest) =>
    postJson<JobDto>(nodePath(name, '/jobs'), request),
  cancelJob: (id: string) =>
    postJson<JobDto>(`jobs/${encodeURIComponent(id)}/cancel`, {}),

  retirePreview: (name: string, signal?: AbortSignal) =>
    getJson<RetirePreviewDto>(`fleet-nodes/${encodeURIComponent(name)}/retire-preview`, signal),
  retire: (name: string, request: RetireRequest) =>
    postJson<unknown>(`fleet-nodes/${encodeURIComponent(name)}/retire`, request),
};
