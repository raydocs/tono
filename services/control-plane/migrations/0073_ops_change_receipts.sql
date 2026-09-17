CREATE TABLE ops_change_receipts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('catalog_retire','catalog_relist','identity_sync','catalog_publish','policy_publish','xray_restart')),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  incident_id TEXT,
  job_id TEXT,
  before_json TEXT CHECK(before_json IS NULL OR length(before_json) <= 4096),
  after_json TEXT CHECK(after_json IS NULL OR length(after_json) <= 4096),
  client_acks INTEGER NOT NULL DEFAULT 0,
  rollback_of TEXT,
  actor TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX ops_change_receipts_subject ON ops_change_receipts(subject_type, subject_id, at DESC);
CREATE INDEX ops_change_receipts_incident ON ops_change_receipts(incident_id, at DESC);
