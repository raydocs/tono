-- Alert rules, per-incident cooldown state, and the delivery outbox.
-- Additive: nothing in the Worker reads these tables until a later brief
-- wires planning/sending into the scheduled pass. incident_id is a plain
-- TEXT column because the incidents table arrives in another migration;
-- a FK here would refuse to apply.
--
-- D1 keeps foreign_keys off unless a migration turns them on; CASCADE
-- from rules onto state/deliveries is the cleanup path when a rule is
-- deleted from the console, so this file has to opt in.

PRAGMA foreign_keys = ON;

CREATE TABLE ops_alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  enabled INTEGER NOT NULL DEFAULT 1,
  match_kind TEXT,
  match_subject_type TEXT,
  match_subject_id TEXT,
  min_severity TEXT NOT NULL DEFAULT 'warn'
    CHECK(min_severity IN ('severe', 'warn', 'notice')),
  min_impact INTEGER NOT NULL DEFAULT 0,
  fire_on TEXT NOT NULL DEFAULT 'open'
    CHECK(fire_on IN ('open', 'open_resolve')),
  delay_seconds INTEGER NOT NULL DEFAULT 0,
  cooldown_seconds INTEGER NOT NULL DEFAULT 3600,
  channel TEXT NOT NULL CHECK(channel IN ('webhook', 'email')),
  target TEXT NOT NULL CHECK(length(target) BETWEEN 3 AND 500),
  template TEXT NOT NULL DEFAULT 'generic'
    CHECK(template IN ('generic', 'telegram', 'feishu', 'slack')),
  secret_ref TEXT CHECK(secret_ref IS NULL OR secret_ref GLOB '[A-Z][A-Z0-9_]*'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX ops_alert_rules_enabled ON ops_alert_rules(enabled);

CREATE TABLE ops_alert_rule_state (
  rule_id TEXT NOT NULL REFERENCES ops_alert_rules(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  last_sent_at INTEGER NOT NULL,
  suppressed_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rule_id, dedupe_key)
);

CREATE TABLE ops_alert_deliveries (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES ops_alert_rules(id) ON DELETE CASCADE,
  incident_id TEXT,
  dedupe_key TEXT NOT NULL,
  transition TEXT NOT NULL CHECK(transition IN ('open', 'escalate', 'resolve', 'test')),
  status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'failed', 'suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  next_attempt_at INTEGER,
  sent_at INTEGER,
  response_code INTEGER,
  error TEXT CHECK(error IS NULL OR length(error) <= 300),
  payload_sha256 TEXT
);

CREATE UNIQUE INDEX ops_alert_deliveries_dedupe ON ops_alert_deliveries(dedupe_key);
CREATE INDEX ops_alert_deliveries_pending ON ops_alert_deliveries(status, next_attempt_at);
CREATE INDEX ops_alert_deliveries_recent ON ops_alert_deliveries(created_at DESC, id DESC);
