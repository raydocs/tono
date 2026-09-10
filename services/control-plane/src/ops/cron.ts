// Scheduled ops pass: flatten, project, verdicts, alerts, job expiry,
// hourly quota, daily rollups, retention. Each step is isolated so one
// failure cannot skip the rest of the tick.

import { type Env } from '../env';
import { flattenBacklog, retainConnectionDaily, retainConnectionEvents, rollupConnectionDaily } from './flatten';
import { projectBacklog, retainActivityHours, retainSessions } from './customers';
import { retainDeliveries } from './alerts';
import { expireStaleJobs } from './jobs';
import { readAgentNetCounters, rollAllNodeCycles } from './quota';
import { retainClientVersionDaily, rollupClientVersionsDaily } from './releases';
import { retainHomeLineUsage } from './home-lines';
import { retainTrafficDaily } from './traffic-parse';
import { planAndSendAlerts, runVerdictPass } from './verdict-run';

const DAY = 86_400;
const HOUR = 3_600;
const DAILY_SETTLE_SECONDS = 2 * HOUR;
const RETAIN_LIMIT = 500;

export type OpsCronStep<T extends Record<string, unknown> = {}> = {
  ok: boolean;
  ms: number;
  error?: string;
} & T;

export type OpsCronReport = {
  flatten: OpsCronStep<{ windows: number; rows: number }>;
  project: OpsCronStep<{ windows: number; hours: number }>;
  verdicts: OpsCronStep<{ nodes: number; transitions: number }>;
  alerts: OpsCronStep<{ planned: number; sent: number; failed: number }>;
  jobs: OpsCronStep<{ expired: number }>;
  quota: OpsCronStep<{ ran: boolean; rolled: number; skipped: number }>;
  daily: OpsCronStep<{ ran: boolean }>;
  retention: OpsCronStep;
};

export const OPS_CRON_STEPS = [
  'flatten', 'project', 'verdicts', 'alerts', 'jobs', 'quota', 'daily', 'retention',
] as const;
export type OpsCronStepName = (typeof OPS_CRON_STEPS)[number];

export type OpsCronPersistedStep = { ok: boolean; ms: number; error: string | null };
export type OpsCronPersistedReport = Record<OpsCronStepName, OpsCronPersistedStep>;

const LAST_REPORT_KEY = 'last_report';
const LAST_REPORT_MAX = 4096;

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function utcDay(sec: number): number {
  return Math.floor(sec / DAY) * DAY;
}

async function step<T extends Record<string, unknown> = {}>(
  name: string,
  fallback: T,
  run: () => Promise<T>,
): Promise<OpsCronStep<T>> {
  const started = Date.now();
  try {
    const extra = await run();
    return { ok: true, ms: Date.now() - started, ...extra };
  } catch (error) {
    console.error(`ops cron: ${name} failed`, error instanceof Error ? error.message : String(error));
    return { ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error), ...fallback };
  }
}

async function lastRun(db: D1Database, key: string): Promise<number | null> {
  try {
    const row = await db.prepare('SELECT ran_at FROM ops_cron_state WHERE key = ?').bind(key).first<{ ran_at: number }>();
    return row ? Number(row.ran_at) : null;
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

function compactReport(report: OpsCronReport): OpsCronPersistedReport {
  const compact = {} as OpsCronPersistedReport;
  for (const name of OPS_CRON_STEPS) {
    const step = report[name];
    compact[name] = { ok: step.ok, ms: step.ms, error: step.error ?? null };
  }
  return compact;
}

function encodeLastReport(report: OpsCronReport): string {
  const compact = compactReport(report);
  let payload = JSON.stringify(compact);
  if (payload.length <= LAST_REPORT_MAX) return payload;
  for (const name of OPS_CRON_STEPS) compact[name].error = null;
  payload = JSON.stringify(compact);
  return payload.length <= LAST_REPORT_MAX ? payload : payload.slice(0, LAST_REPORT_MAX);
}

export function parseLastReport(raw: unknown): OpsCronPersistedReport | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    const out = {} as OpsCronPersistedReport;
    for (const name of OPS_CRON_STEPS) {
      const step = row[name];
      if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
      const rec = step as Record<string, unknown>;
      if (typeof rec.ok !== 'boolean' || typeof rec.ms !== 'number' || !Number.isSafeInteger(rec.ms)) {
        return null;
      }
      const error = rec.error == null ? null : typeof rec.error === 'string' ? rec.error : null;
      out[name] = { ok: rec.ok, ms: rec.ms, error };
    }
    return out;
  } catch {
    return null;
  }
}

async function persistLastReport(db: D1Database, nowSec: number, report: OpsCronReport): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO ops_cron_state(key, ran_at, payload) VALUES(?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET ran_at = excluded.ran_at, payload = excluded.payload`,
    ).bind(LAST_REPORT_KEY, nowSec, encodeLastReport(report)).run();
  } catch (error) {
    if (missingTable(error) || String(error).includes('no such column')) return;
    console.error('ops cron: persist last_report failed', error instanceof Error ? error.message : String(error));
  }
}

async function markRun(db: D1Database, key: string, nowSec: number): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO ops_cron_state(key, ran_at) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET ran_at = excluded.ran_at`,
    ).bind(key, nowSec).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}

async function retainLimited(
  db: D1Database,
  table: string,
  column: string,
  cutoff: number,
  limit = RETAIN_LIMIT,
): Promise<void> {
  try {
    await db.prepare(
      `DELETE FROM ${table} WHERE rowid IN (
         SELECT rowid FROM ${table} WHERE ${column} <= ? ORDER BY ${column} ASC LIMIT ?
       )`,
    ).bind(cutoff, limit).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}

async function runRetention(db: D1Database, nowSec: number): Promise<void> {
  await retainConnectionEvents(db, nowSec, 30, RETAIN_LIMIT);
  await retainConnectionDaily(db, nowSec, 400, RETAIN_LIMIT);
  await retainDeliveries(db, nowSec, 90, RETAIN_LIMIT);
  await retainActivityHours(db, nowSec, 400, RETAIN_LIMIT);
  await retainSessions(db, nowSec, 400, RETAIN_LIMIT);
  await retainTrafficDaily(db, nowSec, 90, RETAIN_LIMIT);
  await retainHomeLineUsage(db, nowSec, 400, RETAIN_LIMIT);
  await retainClientVersionDaily(db, nowSec, 400, RETAIN_LIMIT);
  await retainLimited(db, 'ops_incident_events', 'at', nowSec - 180 * DAY);
  await retainLimited(db, 'ops_node_jobs', 'created_at', nowSec - 90 * DAY);
  await retainLimited(db, 'node_traffic_cycle_samples', 'at', nowSec - 60 * DAY);
}

export async function runOpsCron(e: Env, nowSec: number): Promise<OpsCronReport> {
  const flatten = await step('flatten', { windows: 0, rows: 0 }, () => flattenBacklog(e.DB, nowSec, 200));
  const project = await step('project', { windows: 0, hours: 0 }, () => projectBacklog(e.DB, nowSec, 200));

  let alertTransitions: Awaited<ReturnType<typeof runVerdictPass>>['transitions'] = [];
  const verdicts = await step('verdicts', { nodes: 0, transitions: 0 }, async () => {
    const result = await runVerdictPass(e, nowSec, 'all');
    alertTransitions = result.transitions;
    return { nodes: result.nodes, transitions: result.transitions.length };
  });

  const alerts = await step('alerts', { planned: 0, sent: 0, failed: 0 }, () =>
    planAndSendAlerts(e, alertTransitions, nowSec));

  const jobs = await step('jobs', { expired: 0 }, async () => ({
    expired: await expireStaleJobs(e.DB, nowSec),
  }));

  const quota = await step('quota', { ran: false, rolled: 0, skipped: 0 }, async () => {
    const previous = await lastRun(e.DB, 'hourly');
    if (previous != null && nowSec - previous < HOUR) {
      return { ran: false, rolled: 0, skipped: 0 };
    }
    const result = await rollAllNodeCycles(e.DB, nowSec, (node) => readAgentNetCounters(e.DB, node));
    await markRun(e.DB, 'hourly', nowSec);
    return { ran: true, rolled: result.rolled, skipped: result.skipped };
  });

  const daily = await step('daily', { ran: false }, async () => {
    const today = utcDay(nowSec);
    const previous = await lastRun(e.DB, 'daily');
    const ranToday = previous != null && utcDay(previous) >= today;
    // Yesterday keeps arriving after midnight: the flatten backlog drains
    // 200 windows a tick and a window may span six hours. Both rollups are
    // upserts that recompute the day, so for the first two hours they run
    // on every tick and the last one wins; after that, once is enough.
    const settling = nowSec - today < DAILY_SETTLE_SECONDS;
    if (ranToday && !settling) return { ran: false };
    const yesterday = today - DAY;
    await rollupConnectionDaily(e.DB, yesterday);
    await rollupClientVersionsDaily(e.DB, yesterday, ranToday);
    await markRun(e.DB, 'daily', nowSec);
    return { ran: true };
  });

  const retention = await step('retention', {}, async () => {
    await runRetention(e.DB, nowSec);
    return {};
  });

  const report = { flatten, project, verdicts, alerts, jobs, quota, daily, retention };
  await persistLastReport(e.DB, nowSec, report);
  return report;
}
