-- Server-side ops verdicts and the durable incident board they drive.
-- Additive: existing ops_audit columns stay; actor/request columns join them.
PRAGMA foreign_keys = ON;

CREATE TABLE ops_node_status (
  node_name TEXT PRIMARY KEY,
  verdict TEXT NOT NULL CHECK(verdict IN ('down','blocked','no_probe','degraded','pressure','unknown','ok')),
  label TEXT NOT NULL, reason TEXT, quality_status TEXT,
  agent_status TEXT CHECK(agent_status IS NULL OR agent_status IN ('online','stale','missing')),
  catalog_listed INTEGER, occupancy INTEGER,
  candidate_verdict TEXT, candidate_streak INTEGER NOT NULL DEFAULT 0,
  last_quality_sweep_at INTEGER, last_customer_ok_at INTEGER,
  rules_version INTEGER NOT NULL, evaluated_at INTEGER NOT NULL, changed_at INTEGER NOT NULL,
  evidence_json TEXT CHECK(evidence_json IS NULL OR length(evidence_json) <= 4096)
);

CREATE TABLE ops_node_status_history (
  id TEXT PRIMARY KEY, node_name TEXT NOT NULL, at INTEGER NOT NULL,
  from_verdict TEXT, to_verdict TEXT NOT NULL, reason TEXT, rules_version INTEGER NOT NULL,
  evidence_json TEXT CHECK(evidence_json IS NULL OR length(evidence_json) <= 4096)
);

CREATE INDEX ops_node_status_history_node ON ops_node_status_history(node_name, at DESC, id DESC);
CREATE INDEX ops_node_status_history_at   ON ops_node_status_history(at DESC, id DESC);

CREATE TABLE ops_incidents (
  id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL, kind TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('node','user','home_exit','fleet')),
  subject_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('severe','warn','notice')),
  status TEXT NOT NULL CHECK(status IN ('open','acked','resolved')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  detail TEXT CHECK(detail IS NULL OR length(detail) <= 1000),
  cause TEXT, parent_incident_id TEXT REFERENCES ops_incidents(id) ON DELETE SET NULL,
  rules_version INTEGER NOT NULL, opened_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  acked_at INTEGER, acked_by TEXT, snoozed_until INTEGER, resolved_at INTEGER, resolve_reason TEXT,
  impact_count INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT CHECK(evidence_json IS NULL OR length(evidence_json) <= 4096),
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX ops_incidents_live_unique ON ops_incidents(dedupe_key) WHERE status <> 'resolved';
CREATE INDEX ops_incidents_board   ON ops_incidents(status, severity, opened_at DESC);
CREATE INDEX ops_incidents_subject ON ops_incidents(subject_type, subject_id, opened_at DESC);
CREATE INDEX ops_incidents_changed ON ops_incidents(updated_at DESC, id DESC);

CREATE TABLE ops_incident_events (
  id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES ops_incidents(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('opened','escalated','deescalated','acked','snoozed','note','job','alert','resolved')),
  actor TEXT, detail TEXT CHECK(detail IS NULL OR length(detail) <= 1000),
  data_json TEXT CHECK(data_json IS NULL OR length(data_json) <= 4096)
);

CREATE INDEX ops_incident_events_incident ON ops_incident_events(incident_id, at DESC, id DESC);

ALTER TABLE ops_audit ADD COLUMN actor_type TEXT;
ALTER TABLE ops_audit ADD COLUMN actor_role TEXT;
ALTER TABLE ops_audit ADD COLUMN request_id TEXT;
CREATE INDEX ops_audit_actor_recent ON ops_audit(actor_email, at DESC, id DESC);
