// Collector-facing job lease/heartbeat/result. Same token as the snapshot
// ingest route; this file is the whole HTTP surface so index.ts stays a
// two-line delegation.

import { type Env, now, str } from '../env';
import { ApiError } from '../errors';
import { privileged } from '../auth';
import { body, rejectUnexpectedKeys } from '../request';
import { completeJob, heartbeatJob, leaseJobs } from './jobs';

function requireCollector(req: Request, e: Env): Promise<void> {
  if (typeof e.OPS_COLLECTOR_TOKEN !== 'string' || e.OPS_COLLECTOR_TOKEN.length < 32) {
    throw new ApiError(503, 'OPS_INGEST_UNCONFIGURED', 'Collector ingest is not configured');
  }
  return privileged(req, e.OPS_COLLECTOR_TOKEN);
}

function jobId(raw: string): string {
  return str(raw, 'id', 1, 200);
}

export async function opsIngestRoutes(
  req: Request,
  e: Env,
  p: string,
  m: string,
): Promise<Response | null> {
  if (p === '/api/v1/ops-ingest/jobs' && m === 'GET') {
    await requireCollector(req, e);
    const q = new URL(req.url).searchParams;
    const executor = q.get('executor') ?? '';
    const maxRaw = q.get('max');
    const max = maxRaw == null || maxRaw === '' ? 50 : Number(maxRaw);
    if (!Number.isSafeInteger(max) || max < 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid max');
    }
    const leased = await leaseJobs(e.DB, executor, max, now());
    return Response.json(leased);
  }

  const heartbeat = p.match(/^\/api\/v1\/ops-ingest\/jobs\/([^/]+)\/heartbeat$/);
  if (heartbeat && m === 'POST') {
    await requireCollector(req, e);
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['leaseId']);
    const leaseId = str(b.leaseId, 'leaseId', 1, 200);
    const job = await heartbeatJob(e.DB, jobId(heartbeat[1]), leaseId, now());
    return Response.json({ job });
  }

  const result = p.match(/^\/api\/v1\/ops-ingest\/jobs\/([^/]+)\/result$/);
  if (result && m === 'POST') {
    await requireCollector(req, e);
    const b = await body(req, 16 * 1024);
    rejectUnexpectedKeys(b, ['leaseId', 'status', 'summary', 'resultJson']);
    const leaseId = str(b.leaseId, 'leaseId', 1, 200);
    const job = await completeJob(
      e.DB,
      jobId(result[1]),
      leaseId,
      {
        status: b.status as 'ok' | 'error' | 'timeout',
        summary: b.summary == null ? undefined : String(b.summary),
        resultJson: b.resultJson,
      },
      now(),
    );
    return Response.json({ job });
  }

  return null;
}
