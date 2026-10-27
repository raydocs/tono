-- Candidate only. Not a migration.
-- Do not copy this file into services/control-plane/migrations/ until it has
-- been rehearsed on a staging copy of production D1 (ops plan: preview first).
-- retention.ts already LIMITs each housekeeping DELETE to 500 rows. These
-- indexes are what keep that inner SELECT off a full table scan.
-- Checked against migrations/0093_client_diagnostics.sql on main 322f48c6f:
-- none of these six columns is indexed today.
-- diagnostics_reports(received_at), telemetry_windows(received_at) and
-- failure_alert_sends(sent_at) already have indexes. Leave them alone.

CREATE INDEX client_sessions_received
  ON client_sessions(received_at);

CREATE INDEX chain_hops_received
  ON chain_hops(received_at);

CREATE INDEX session_exit_observations_received
  ON session_exit_observations(received_at);

CREATE INDEX dns_checks_received
  ON dns_checks(received_at);

CREATE INDEX ai_service_routes_received
  ON ai_service_routes(received_at);

CREATE INDEX failure_clusters_opened
  ON failure_clusters(opened_at);

-- Optional, separate from the diagnostics tables above.
-- rate_limits is deleted by window_start and its only index is the key primary
-- key (migrations/0004_identity_and_rate_limit.sql). The DELETE is now batched.
-- CREATE INDEX rate_limits_window ON rate_limits(window_start);

-- 2026-10-27 additions (CP-CRON-UNINDEXED-SCANS). Measured on local D1
-- (miniflare, migrations 0001-0104) with 20,000 synthetic rows per table and
-- one full scheduled() tick: rows read per tick fell from 274,100 to 174,100.
-- Per statement, before -> after:
--   stale pending device scan        20,000 -> 1
--   ops_incident_events retention    40,003 -> (not in top; index used)
--   customer_activity_hours retention 20,002 -> index used
--   service_usage_daily retention    20,001 -> index used
--   direct_candidate_daily retention 20,001 -> index used
--   client_sessions retention        20,001 -> index used (first block above)
-- Not fixed by an index: loadRollups' MAX(bucket_at) join (59,999) and the
-- failure_cluster_members retention join (20,001). Production tables are far
-- smaller today; rehearse on the preview D1 before any migration.

CREATE INDEX devices_pending_expiry
  ON devices(pending_expires_at) WHERE status = 'pending';

CREATE INDEX ops_incident_events_at
  ON ops_incident_events(at);

CREATE INDEX customer_activity_hours_hour
  ON customer_activity_hours(hour_at);

CREATE INDEX service_usage_daily_day
  ON service_usage_daily(day_at);

CREATE INDEX direct_candidate_daily_day
  ON direct_candidate_daily(day_at);
