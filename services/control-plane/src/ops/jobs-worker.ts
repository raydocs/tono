// Worker-side executor for JOB_TYPES with executor='worker' (catalog
// publish, not a node SSH operation). Hub jobs stay on the hub.

import { ApiError } from '../errors';
import { type Env, id } from '../env';
import { completeJob, leaseJobs, type NodeJob } from './jobs';
import { operationsRetirePreview, relistFleetNode, retireFleetNode } from './reads/fleet';

const SUMMARY_MAX = 500;

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function clip(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).slice(0, SUMMARY_MAX);
}

async function recordIncidentJob(
  e: Env,
  job: NodeJob,
  nowSec: number,
  summary: string,
): Promise<void> {
  if (!job.incidentId) return;
  try {
    await e.DB.prepare(
      `INSERT INTO ops_incident_events(id, incident_id, at, type, actor, detail, data_json)
       VALUES(?, ?, ?, 'job', ?, ?, NULL)`,
    ).bind(id(), job.incidentId, nowSec, job.requestedBy, summary.slice(0, 1000)).run();
  } catch (error) {
    if (!missingTable(error)) {
      console.error('ops jobs-worker: incident event failed', clip(error));
    }
  }
}

async function finish(
  e: Env,
  job: NodeJob,
  leaseId: string,
  nowSec: number,
  ok: boolean,
  summary: string,
  resultJson?: unknown,
): Promise<void> {
  const text = clip(summary);
  await completeJob(
    e.DB,
    job.id,
    leaseId,
    { status: ok ? 'ok' : 'error', summary: text, resultJson },
    nowSec,
  );
  await recordIncidentJob(e, job, nowSec, text);
}

async function executeCatalogRetire(e: Env, job: NodeJob): Promise<{ summary: string; resultJson: unknown }> {
  const reason = typeof job.params.reason === 'string' && job.params.reason.trim()
    ? job.params.reason.trim().slice(0, 500)
    : 'catalog_retire';
  const preview = await operationsRetirePreview(e, job.nodeName);
  const result = await retireFleetNode(e, job.requestedBy, job.nodeName, {
    expectedRevision: preview.expectedRevision,
    confirmation: job.nodeName,
    reason,
  });
  return { summary: `retired ${job.nodeName}`, resultJson: { revision: result.revision } };
}

async function executeCatalogRelist(e: Env, job: NodeJob): Promise<{ summary: string; resultJson: unknown }> {
  const block = typeof job.params.block === 'string' ? job.params.block : undefined;
  const expectedRevision = Number.isSafeInteger(job.params.expectedRevision)
    ? Number(job.params.expectedRevision)
    : undefined;
  const result = await relistFleetNode(e, job.requestedBy, job.nodeName, {
    ...(expectedRevision != null ? { expectedRevision } : {}),
    ...(block ? { block } : {}),
  });
  return {
    summary: result.alreadyListed ? `already listed ${job.nodeName}` : `relisted ${job.nodeName}`,
    resultJson: { revision: result.revision, alreadyListed: result.alreadyListed },
  };
}

async function executeOne(e: Env, job: NodeJob, leaseId: string, nowSec: number): Promise<void> {
  try {
    if (job.type === 'catalog_retire') {
      const result = await executeCatalogRetire(e, job);
      await finish(e, job, leaseId, nowSec, true, result.summary, result.resultJson);
      return;
    }
    if (job.type === 'catalog_relist') {
      const result = await executeCatalogRelist(e, job);
      await finish(e, job, leaseId, nowSec, true, result.summary, result.resultJson);
      return;
    }
    await finish(e, job, leaseId, nowSec, false, `unknown worker job type: ${job.type}`);
  } catch (error) {
    const summary = error instanceof ApiError ? error.message : clip(error);
    try {
      await finish(e, job, leaseId, nowSec, false, summary);
    } catch (completeError) {
      console.error('ops jobs-worker: complete failed', clip(completeError));
    }
  }
}

export async function runWorkerJobs(e: Env, nowSec: number, max = 3): Promise<number> {
  try {
    const claimed = await leaseJobs(e.DB, 'worker', max, nowSec);
    for (const job of claimed.jobs) {
      await executeOne(e, job, claimed.leaseId, nowSec);
    }
    return claimed.jobs.length;
  } catch (error) {
    if (missingTable(error)) return 0;
    console.error('ops jobs-worker: run failed', clip(error));
    return 0;
  }
}
