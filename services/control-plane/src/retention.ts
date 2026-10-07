import { type Env, envInt } from './env';
import { DIAGNOSTICS_DAY_SECONDS } from './diagnostics-limits';
import {
  DIAGNOSTICS_RETENTION_DEFAULT_SECONDS,
  sweepDiagnosticsLogs,
  TELEMETRY_RETENTION_DEFAULT_SECONDS,
  OPS_AUDIT_RETENTION_SECONDS,
} from './telemetry/routes';

// Retained legacy v1 report IDs are the replay evidence for the usage fold
// (`/api/v1/home/usage`). A retained report that a later-inserted report from
// the same account and source has superseded was already folded, or refused,
// when it first arrived. Folding its exact replay again lets the v1
// higher-counter exception read a pre-reset high-water figure as new growth
// (900 then 120 after a reset, replaying 900 bills 780 twice, GitHub #816).
// Insertion order is the rowid (`usage_reports` has a TEXT key, so it keeps an
// implicit rowid), not the sender's wall clock, so a genuinely new report whose
// clock stepped backwards is still the newest row and keeps that exception.
// Expects the fold's `usage_reports` row in scope under that name.
export const V1_USAGE_REPORT_NOT_SUPERSEDED = `NOT EXISTS (
  SELECT 1 FROM usage_reports later
  WHERE later.rowid > usage_reports.rowid
    AND later.user_id = usage_reports.user_id
    AND later.source_id = usage_reports.source_id
)`;

// Each cron step logs and continues. One failing statement must not skip the
// steps after it (retention, usage snapshots, the ops cron).
export async function cronStep(name: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (x) {
    console.error(`${name} failed`, x instanceof Error ? x.message : String(x));
  }
}

// Housekeeping deletes run by the five-minute cron after enforcement. Each is
// its own step, so one failing statement does not skip the rest.
export async function runHousekeepingRetention(e: Env, t: number) {
  const rateWindow = envInt(e, 'RATE_LIMIT_WINDOW_SECONDS', 900);
  // Diagnostics counters run on a day-long window, so pruning at twice the auth
  // window would silently reset the per-day cap every five minutes.
  const rateRetention = Math.max(rateWindow, DIAGNOSTICS_DAY_SECONDS) * 2;
  await cronStep('rate limit retention', () =>
    e.DB.prepare('DELETE FROM rate_limits WHERE window_start <= ?').bind(t - rateRetention).run());
  await cronStep('auth challenge retention', () => e.DB.prepare(
    `DELETE FROM auth_challenges
     WHERE expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at <= ?)`,
  ).bind(t - 86_400, t - 86_400).run());
  // Keep each retention branch indexable. The old OR made SQLite scan the whole
  // sessions table every five minutes even though both predicates had indexes.
  await cronStep('revoked session retention', () => e.DB.prepare(
    `DELETE FROM sessions WHERE id IN (
       SELECT id FROM sessions
       WHERE revoked_at IS NOT NULL AND revoked_at <= ?
       LIMIT 500
     )`,
  ).bind(t - 86_400).run());
  await cronStep('expired session retention', () => e.DB.prepare(
    `DELETE FROM sessions WHERE id IN (
       SELECT id FROM sessions
       WHERE revoked_at IS NULL AND expires_at <= ?
       LIMIT 500
     )`,
  ).bind(t).run());
  // Diagnostics uploads are troubleshooting artifacts, not account records.
  await cronStep('diagnostics report retention', () =>
    e.DB.prepare('DELETE FROM diagnostics_reports WHERE received_at <= ?')
      .bind(t - envInt(e, 'DIAGNOSTICS_RETENTION_SECONDS', DIAGNOSTICS_RETENTION_DEFAULT_SECONDS))
      .run());
  await cronStep('diagnostics log retention', () => sweepDiagnosticsLogs(e, t));
  await cronStep('telemetry retention', () =>
    e.DB.prepare('DELETE FROM telemetry_windows WHERE received_at <= ?')
      .bind(t - envInt(e, 'TELEMETRY_RETENTION_SECONDS', TELEMETRY_RETENTION_DEFAULT_SECONDS))
      .run());
  const diagnosticsKeep = t - 90 * 86_400;
  const aiKeep = t - 60 * 86_400;
  for (const table of ['client_sessions', 'chain_hops', 'session_exit_observations', 'dns_checks']) {
    await cronStep(`${table} retention`, () =>
      e.DB.prepare(`DELETE FROM ${table} WHERE received_at <= ?`).bind(diagnosticsKeep).run());
  }
  await cronStep('ai service route retention', () =>
    e.DB.prepare('DELETE FROM ai_service_routes WHERE received_at <= ?').bind(aiKeep).run());
  await cronStep('failure cluster retention', async () => {
    await e.DB.prepare(
      `DELETE FROM failure_cluster_members WHERE cluster_id IN (
         SELECT id FROM failure_clusters WHERE opened_at <= ?
       )`,
    ).bind(diagnosticsKeep).run();
    await e.DB.prepare('DELETE FROM failure_clusters WHERE opened_at <= ?').bind(diagnosticsKeep).run();
  });
  await cronStep('failure alert send retention', () =>
    e.DB.prepare('DELETE FROM failure_alert_sends WHERE sent_at <= ?').bind(diagnosticsKeep).run());
  // Individual report ids are bounded retry evidence, not the billing ledger.
  // usage_report_sources retains the monotonic per-node totals, so deleting old
  // ids cannot lower usage. A stale v2 replay is ignored by that source's
  // observed_at watermark. A legacy v1 replay is kept out of the fold by
  // V1_USAGE_REPORT_NOT_SUPERSEDED above only while the ids it needs are
  // retained; once pruned, a pre-reset v1 replay can be billed again (#816).
  await cronStep('usage report retention', () => e.DB.prepare(
    `DELETE FROM usage_reports WHERE report_id IN (
       SELECT report_id FROM usage_reports
       WHERE created_at <= ?
       ORDER BY created_at
       LIMIT 500
     )`,
  ).bind(t - 14 * 86_400).run());
  // The audit log had no retention at all — every operator action since
  // migration 0023, forever. Half a year is the whole useful life of "who
  // retired that node"; the LIMIT keeps the first sweep over an old backlog
  // from being one giant delete.
  await cronStep('ops audit retention', () => e.DB.prepare(
    `DELETE FROM ops_audit WHERE id IN (
       SELECT id FROM ops_audit WHERE at <= ? LIMIT 500
     )`,
  ).bind(t - OPS_AUDIT_RETENTION_SECONDS).run());
}
