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
