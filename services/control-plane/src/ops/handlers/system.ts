import { envInt } from '../../env';
import { CONTRACT_VERSION, SOURCE_IDS, assertSystemHealth, type BackfillHealthDto, type CronStepsHealthDto, type SourceHealthDto, type SourceId, type SourceState, type SystemHealthDto } from '../contract';
import { storedLiveSnapshot } from '../live';
import { OPS_CRON_STEPS, parseLastReport } from '../cron';
import {
  Env,
  Row,
  entityJson,
  missingTable,
  now,
  nullInt,
  nullText,
  weakEtag,
} from './common';

const TELEMETRY_RETENTION_DEFAULT = 30 * 86_400;

const STALE: Record<SourceId, number> = {
  collector: 20 * 60,
  komari: 15 * 60,
  telemetry: 40 * 60,
  catalog: 24 * 3600,
  profile: 7 * 24 * 3600,
  engine: 20 * 60,
  jobs: 24 * 3600,
  manual: 7 * 24 * 3600,
};

function stateOf(asOf: number | null, staleAfter: number, t: number, hadError: boolean): SourceState {
  if (hadError) return 'error';
  if (asOf == null || asOf <= 0) return 'missing';
  if (t - asOf > staleAfter) return 'stale';
  return 'ready';
}

async function sourceAsOf(e: Env, source: SourceId, live: Awaited<ReturnType<typeof storedLiveSnapshot>>): Promise<{ asOf: number | null; error: boolean }> {
  try {
    if (source === 'collector') return { asOf: nullInt(live?.quality_updated_at), error: false };
    if (source === 'komari') return { asOf: nullInt(live?.agents_updated_at), error: false };
    if (source === 'telemetry') {
      const row = await e.DB.prepare('SELECT MAX(received_at) AS at FROM telemetry_windows').first<Row>();
      return { asOf: nullInt(row?.at), error: false };
    }
    if (source === 'catalog') {
      const row = await e.DB.prepare(
        'SELECT updated_at FROM managed_exit_catalog WHERE singleton_id = 1',
      ).first<Row>();
      return { asOf: nullInt(row?.updated_at), error: false };
    }
    if (source === 'profile') {
      const row = await e.DB.prepare('SELECT MAX(updated_at) AS at FROM ops_node_profiles').first<Row>();
      return { asOf: nullInt(row?.at), error: false };
    }
    if (source === 'engine') {
      const row = await e.DB.prepare('SELECT MAX(evaluated_at) AS at FROM ops_node_status').first<Row>();
      return { asOf: nullInt(row?.at), error: false };
    }
    if (source === 'jobs') {
      const row = await e.DB.prepare('SELECT MAX(updated_at) AS at FROM ops_node_jobs').first<Row>();
      return { asOf: nullInt(row?.at), error: false };
    }
    const row = await e.DB.prepare('SELECT MAX(at) AS at FROM ops_audit').first<Row>();
    return { asOf: nullInt(row?.at), error: false };
  } catch (error) {
    if (missingTable(error)) return { asOf: null, error: false };
    return { asOf: null, error: true };
  }
}

async function backfillHealth(e: Env, t: number): Promise<BackfillHealthDto | null> {
  try {
    const cutoff = t - envInt(e, 'TELEMETRY_RETENTION_SECONDS', TELEMETRY_RETENTION_DEFAULT);
    const row = await e.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM telemetry_windows WHERE received_at > ?) AS windowsTotal,
         (SELECT COUNT(*) FROM telemetry_windows tw
            JOIN ops_flatten_cursor c ON c.singleton_id = 1
            WHERE tw.received_at > ?
              AND (tw.received_at < c.last_received_at
                OR (tw.received_at = c.last_received_at AND tw.id <= c.last_window_id))) AS windowsFlattened,
         (SELECT COUNT(*) FROM telemetry_windows tw
            JOIN ops_customer_projection_cursor c ON c.singleton_id = 1
            WHERE tw.received_at > ?
              AND (tw.received_at < c.last_received_at
                OR (tw.received_at = c.last_received_at AND tw.id <= c.last_window_id))) AS windowsProjected`,
    ).bind(cutoff, cutoff, cutoff).first<Row>();
    const windowsTotal = Number(row?.windowsTotal ?? 0);
    const windowsFlattened = Number(row?.windowsFlattened ?? 0);
    const windowsProjected = Number(row?.windowsProjected ?? 0);
    if (windowsTotal === 0 || (windowsFlattened >= windowsTotal && windowsProjected >= windowsTotal)) {
      return null;
    }
    return { windowsTotal, windowsFlattened, windowsProjected };
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

export async function getSystemHealth(req: Request, e: Env): Promise<Response> {
  const t = now();
  const live = await storedLiveSnapshot(e);
  const sources: SourceHealthDto[] = [];
  for (const source of SOURCE_IDS) {
    const { asOf, error } = await sourceAsOf(e, source, live);
    sources.push({
      source,
      state: stateOf(asOf, STALE[source], t, error),
      asOfSec: asOf != null && asOf > 0 ? asOf : null,
      message: error ? 'read failed' : null,
    });
  }
  let cronLastRunAt: number | null = null;
  let cronLastDurationMs: number | null = null;
  let cronLastError: string | null = null;
  let cronSteps: CronStepsHealthDto | null = null;
  try {
    const cron = await e.DB.prepare(
      "SELECT ran_at, payload FROM ops_cron_state WHERE key = 'last_report'",
    ).first<Row>();
    cronLastRunAt = nullInt(cron?.ran_at);
    const parsed = parseLastReport(cron?.payload);
    if (parsed) {
      cronSteps = parsed;
      let total = 0;
      for (const name of OPS_CRON_STEPS) {
        total += parsed[name].ms;
        if (cronLastError == null && parsed[name].error) cronLastError = parsed[name].error;
      }
      cronLastDurationMs = total;
    }
  } catch (error) {
    if (!missingTable(error) && !String(error).includes('no such column')) {
      // Table is optional; any missing-object error is treated as "no cron yet".
    }
  }
  const dto: SystemHealthDto = {
    ok: sources.every((source) => source.state === 'ready' || source.state === 'stale'),
    buildSha: nullText((e as Env & { BUILD_SHA?: string }).BUILD_SHA),
    contractVersion: CONTRACT_VERSION,
    sources,
    cronLastRunAt,
    cronLastDurationMs,
    cronLastError,
    cronSteps,
    backfill: await backfillHealth(e, t),
    updatedAt: t,
  };
  // A missing source is not ok — the 死人开关.
  dto.ok = sources.every((source) => source.state === 'ready');
  return entityJson(e, req, dto, weakEtag([t, dto.ok ? 1 : 0, sources.map((s) => s.state).join(',')]), assertSystemHealth);
}
