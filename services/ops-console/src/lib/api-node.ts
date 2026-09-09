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
  RangeKey,
} from '@contract';
import { getJson, postJson } from './api';

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

  enqueueJob: (name: string, request: NodeJobRequest) =>
    postJson<JobDto>(nodePath(name, '/jobs'), request),
  cancelJob: (id: string) =>
    postJson<JobDto>(`jobs/${encodeURIComponent(id)}/cancel`, {}),

  retirePreview: (name: string, signal?: AbortSignal) =>
    getJson<RetirePreviewDto>(`fleet-nodes/${encodeURIComponent(name)}/retire-preview`, signal),
  retire: (name: string, request: RetireRequest) =>
    postJson<unknown>(`fleet-nodes/${encodeURIComponent(name)}/retire`, request),
};
