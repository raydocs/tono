import { ApiError } from '../../errors';
import { assertJob } from '../contract';
import { JOB_EXECUTORS, JOB_STATUSES } from '../contract';
import { cancelJob, listJobs } from '../jobs';
import { jobDto } from './nodes-data';
import {
  Actor,
  Env,
  auditWrite,
  check,
  encodeCursor,
  jsonNoStore,
  listJson,
  now,
  pageParams,
  parseCursor,
  weakEtag,
} from './common';

export async function getJobs(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const executor = url.searchParams.get('executor');
  if (status != null && status !== '' && !(JOB_STATUSES as readonly string[]).includes(status)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
  }
  if (executor != null && executor !== '' && !(JOB_EXECUTORS as readonly string[]).includes(executor)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid executor');
  }
  const { cursor, limit } = pageParams(url);
  const listed = await listJobs(e.DB, {
    status: status || undefined,
    executor: executor || undefined,
    limit: 200,
  });
  const items = listed.jobs.map(jobDto).filter((job) => {
    if (!cursor) return true;
    return job.createdAt < Number(cursor.sortKey)
      || (job.createdAt === Number(cursor.sortKey) && job.id < cursor.id);
  });
  const page = items.slice(0, limit + 1);
  const sliced = page.length > limit ? page.slice(0, limit) : page;
  const last = sliced[sliced.length - 1];
  const nextCursor = page.length > limit && last ? encodeCursor(String(last.createdAt), last.id) : null;
  const updatedAt = sliced[0]?.updatedAt ?? now();
  return listJson(
    e, req, sliced, nextCursor, updatedAt,
    weakEtag([updatedAt, items.length, status, executor]),
    assertJob,
  );
}

export async function postJobCancel(req: Request, e: Env, jobId: string, actor: Actor): Promise<Response> {
  void req;
  const job = await cancelJob(e.DB, jobId, actor.email, now());
  await auditWrite(e, actor.email, 'job.cancel', 'node_job', jobId, `cancelled ${job.type}`);
  const dto = jobDto(job);
  check(e, () => { assertJob(dto); });
  return jsonNoStore(dto);
}

export { parseCursor };
