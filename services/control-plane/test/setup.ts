import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';
import { beforeAll, beforeEach } from 'vitest';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

// The Vitest 4 Workers pool isolates storage per test file (rather than per
// individual test). Reset mutable rows explicitly so tests cannot pass or fail
// based on execution order. Ops tables: children before parents.
beforeEach(async () => {
  await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_activation').run();
  await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_retention').run();
  await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_session_authorization').run();
  await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_diagnostics_audit').run();
  await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_metering_audit').run();
  await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_flatten').run();

  await env.DB.prepare('DELETE FROM ops_alert_deliveries').run();
  await env.DB.prepare('DELETE FROM ops_alert_rule_state').run();
  await env.DB.prepare('DELETE FROM ops_alert_rules').run();
  await env.DB.prepare('DELETE FROM ops_incident_events').run();
  await env.DB.prepare('UPDATE ops_incidents SET parent_incident_id = NULL').run();
  await env.DB.prepare('DELETE FROM ops_incidents').run();
  await env.DB.prepare('DELETE FROM ops_node_jobs').run();
  await env.DB.prepare('DELETE FROM ops_node_status_history').run();
  await env.DB.prepare('DELETE FROM ops_node_status').run();
  await env.DB.prepare('DELETE FROM ops_node_profiles').run();
  await env.DB.prepare('DELETE FROM node_traffic_cycle_samples').run();
  await env.DB.prepare('DELETE FROM node_traffic_cycles').run();
  await env.DB.prepare('DELETE FROM node_error_daily').run();
  await env.DB.prepare('DELETE FROM connection_events').run();
  await env.DB.prepare('DELETE FROM ops_flatten_cursor').run();
  await env.DB.prepare('DELETE FROM ops_connection_daily').run();
  await env.DB.prepare('DELETE FROM traffic_destination_daily').run();
  await env.DB.prepare('DELETE FROM ops_traffic_segments').run();
  await env.DB.prepare('DELETE FROM service_usage_daily').run();
  await env.DB.prepare('DELETE FROM direct_candidate_daily').run();
  await env.DB.prepare('DELETE FROM direct_candidates').run();
  await env.DB.prepare('DELETE FROM home_line_usage_daily').run();
  await env.DB.prepare('DELETE FROM ops_client_version_daily').run();
  await env.DB.prepare('DELETE FROM ops_client_version_device_daily').run();
  await env.DB.prepare('DELETE FROM client_releases').run();
  await env.DB.prepare('DELETE FROM customer_activity_hours').run();
  await env.DB.prepare('DELETE FROM customer_sessions').run();
  await env.DB.prepare('DELETE FROM ops_device_status').run();
  await env.DB.prepare('DELETE FROM ops_customer_status').run();
  await env.DB.prepare('DELETE FROM ops_customer_projection_cursor').run();
  await env.DB.prepare('DELETE FROM ops_cron_state').run();
  await env.DB.prepare('DELETE FROM ops_ledger_entries').run();
  await env.DB.prepare('DELETE FROM ops_month_close').run();
  await env.DB.prepare('DELETE FROM ops_fx_rates').run();
  await env.DB.prepare('DELETE FROM ops_audit').run();
  await env.DB.prepare('DELETE FROM provider_accounts').run();

  await env.DB.prepare('DELETE FROM product_account_events').run();
  await env.DB.prepare('DELETE FROM product_accounts').run();
  await env.DB.prepare('DELETE FROM operations_live_snapshot').run();
  await env.DB.prepare('DELETE FROM operations_agent_samples').run();
  await env.DB.prepare('DELETE FROM operations_agent_rollups').run();
  await env.DB.prepare('DELETE FROM operations_home_probe_samples').run();
  await env.DB.prepare('DELETE FROM operations_quality_samples').run();
  await env.DB.prepare('DELETE FROM operations_catalog_revision_metadata').run();
  await env.DB.prepare('DELETE FROM operations_deployments').run();
  await env.DB.prepare('DELETE FROM operations_logical_nodes').run();
  await env.DB.prepare('DELETE FROM operations_servers').run();
  await env.DB.prepare('DELETE FROM routing_research_snapshots').run();
  await env.DB.prepare('DELETE FROM device_actions').run();
  await env.DB.prepare('DELETE FROM diagnostics_reports').run();
  await env.DB.prepare('DELETE FROM telemetry_windows').run();
  await env.DB.prepare('DELETE FROM sessions').run();
  await env.DB.prepare('DELETE FROM usage_reports').run();
  await env.DB.prepare('DELETE FROM revocation_jobs').run();
  await env.DB.prepare('DELETE FROM device_rotation_guards').run();
  await env.DB.prepare('DELETE FROM devices').run();
  await env.DB.prepare('DELETE FROM exit_nodes').run();
  await env.DB.prepare(
    "UPDATE exit_credential_rollout SET phase = 'dual', updated_at = unixepoch() WHERE singleton_id = 1",
  ).run();
  await env.DB.prepare('DELETE FROM usage_metering_cutover_baselines').run();
  await env.DB.prepare(
    `UPDATE usage_metering_rollout
     SET phase = 'dual', updated_at = unixepoch()
     WHERE singleton_id = 1`,
  ).run();
  await env.DB.prepare(
    `UPDATE usage_metering_rollout
     SET legacy_last_seen_at = 0, updated_at = unixepoch()
     WHERE singleton_id = 1`,
  ).run();
  await env.DB.prepare('DELETE FROM auth_challenges').run();
  await env.DB.prepare('DELETE FROM auth_identities').run();
  await env.DB.prepare('DELETE FROM invitations').run();
  await env.DB.prepare('DELETE FROM user_home_bindings').run();
  await env.DB.prepare('DELETE FROM home_exits').run();
  await env.DB.prepare('DELETE FROM signup_allowlist').run();
  await env.DB.prepare('DELETE FROM managed_exit_catalog').run();
  await env.DB.prepare('DELETE FROM managed_traffic_policy').run();
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare('DELETE FROM rate_limits').run();
});
