import { CONTRACT_VERSION, SOURCE_IDS, assertSystemHealth, type SourceHealthDto, type SourceId, type SourceState, type SystemHealthDto } from '../contract';
import { storedLiveSnapshot } from '../live';
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
  try {
    const cron = await e.DB.prepare('SELECT * FROM ops_cron_state WHERE singleton_id = 1').first<Row>();
    if (cron) {
      cronLastRunAt = nullInt(cron.last_run_at ?? cron.updated_at);
      cronLastDurationMs = nullInt(cron.last_duration_ms);
      cronLastError = nullText(cron.last_error);
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
    updatedAt: t,
  };
  // A missing source is not ok — the 死人开关.
  dto.ok = sources.every((source) => source.state === 'ready');
  return entityJson(e, req, dto, weakEtag([t, dto.ok ? 1 : 0, sources.map((s) => s.state).join(',')]), assertSystemHealth);
}
