-- Persist probe_unreachable (mainland sweep down, Komari agent still alive).
-- SQLite cannot ALTER a CHECK; rebuild the status row with the expanded enum.
CREATE TABLE ops_node_status_new (
  node_name TEXT PRIMARY KEY,
  verdict TEXT NOT NULL CHECK(verdict IN (
    'down','blocked','no_probe','degraded','probe_unreachable','pressure','unknown','ok'
  )),
  label TEXT NOT NULL, reason TEXT, quality_status TEXT,
  agent_status TEXT CHECK(agent_status IS NULL OR agent_status IN ('online','stale','missing')),
  catalog_listed INTEGER, occupancy INTEGER,
  candidate_verdict TEXT, candidate_streak INTEGER NOT NULL DEFAULT 0,
  last_quality_sweep_at INTEGER, last_customer_ok_at INTEGER,
  rules_version INTEGER NOT NULL, evaluated_at INTEGER NOT NULL, changed_at INTEGER NOT NULL,
  evidence_json TEXT CHECK(evidence_json IS NULL OR length(evidence_json) <= 4096),
  candidate_since INTEGER
);

INSERT INTO ops_node_status_new(
  node_name, verdict, label, reason, quality_status, agent_status,
  catalog_listed, occupancy, candidate_verdict, candidate_streak,
  last_quality_sweep_at, last_customer_ok_at, rules_version,
  evaluated_at, changed_at, evidence_json, candidate_since
)
SELECT
  node_name, verdict, label, reason, quality_status, agent_status,
  catalog_listed, occupancy, candidate_verdict, candidate_streak,
  last_quality_sweep_at, last_customer_ok_at, rules_version,
  evaluated_at, changed_at, evidence_json, candidate_since
FROM ops_node_status;

DROP TABLE ops_node_status;
ALTER TABLE ops_node_status_new RENAME TO ops_node_status;
