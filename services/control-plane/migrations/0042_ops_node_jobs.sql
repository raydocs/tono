-- Operator-asked, agent-performed node jobs. Same shape as device_actions:
-- enqueue is the ask, lease/complete is the perform. Additive; nothing else
-- reads this table until the jobs module is wired.
PRAGMA foreign_keys = ON;

CREATE TABLE ops_node_jobs (
  id TEXT PRIMARY KEY, node_name TEXT NOT NULL,
  executor TEXT NOT NULL DEFAULT 'hub' CHECK(executor IN ('hub','exit_agent','worker')),
  type TEXT NOT NULL CHECK(type IN ('xray_dial_errors','xray_error_digest','collect_quality','node_probe','node_config_snapshot','xray_restart','identity_sync','agent_reinstall','catalog_retire','catalog_relist','home_line_probe')),
  params_json TEXT CHECK(params_json IS NULL OR length(params_json) <= 2048),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','leased','succeeded','failed','cancelled','expired')),
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
  idempotency_key TEXT NOT NULL, requested_by TEXT NOT NULL, incident_id TEXT,
  created_at INTEGER NOT NULL, not_before INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  lease_id TEXT, lease_expires_at INTEGER, leased_at INTEGER, completed_at INTEGER,
  result_status TEXT CHECK(result_status IS NULL OR result_status IN ('ok','error','timeout')),
  result_summary TEXT CHECK(result_summary IS NULL OR length(result_summary) <= 500),
  result_json TEXT CHECK(result_json IS NULL OR length(result_json) <= 16384),
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ops_node_jobs_idem   ON ops_node_jobs(idempotency_key);
CREATE INDEX ops_node_jobs_claim  ON ops_node_jobs(executor, status, not_before);
CREATE INDEX ops_node_jobs_node   ON ops_node_jobs(node_name, created_at DESC, id DESC);
CREATE INDEX ops_node_jobs_recent ON ops_node_jobs(created_at DESC, id DESC);
