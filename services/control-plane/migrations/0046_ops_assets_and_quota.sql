-- Provider accounts, node profile extension, per-node traffic cycles, and
-- a daily error digest. Additive only; existing profile rows stay valid.

CREATE TABLE provider_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 80),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 120),
  cloud_kind TEXT NOT NULL DEFAULT 'vps'
    CHECK(cloud_kind IN ('vps', 'cloudflare', 'domain_registrar', 'residential', 'other')),
  login_email_masked TEXT,
  billing_url TEXT
    CHECK(billing_url IS NULL OR (length(billing_url) BETWEEN 8 AND 500 AND billing_url LIKE 'https://%')),
  balance_hint TEXT,
  renew_notes TEXT CHECK(renew_notes IS NULL OR length(renew_notes) <= 1000),
  secret_ref TEXT CHECK(secret_ref IS NULL OR length(secret_ref) <= 120),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE ops_node_profiles ADD COLUMN provider_account_id TEXT;
ALTER TABLE ops_node_profiles ADD COLUMN expires_at INTEGER;
ALTER TABLE ops_node_profiles ADD COLUMN os TEXT;
ALTER TABLE ops_node_profiles ADD COLUMN region TEXT;
ALTER TABLE ops_node_profiles ADD COLUMN line_tags_json TEXT;
ALTER TABLE ops_node_profiles ADD COLUMN quota_counts TEXT
  CHECK(quota_counts IS NULL OR quota_counts IN ('in', 'out', 'in_out'));
ALTER TABLE ops_node_profiles ADD COLUMN cycle_kind TEXT
  CHECK(cycle_kind IS NULL OR cycle_kind IN ('calendar_day', 'anniversary', 'rolling_30d', 'manual'));
ALTER TABLE ops_node_profiles ADD COLUMN cycle_anchor_day INTEGER;
ALTER TABLE ops_node_profiles ADD COLUMN auto_unlist_at_pct INTEGER
  CHECK(auto_unlist_at_pct IS NULL OR (auto_unlist_at_pct BETWEEN 1 AND 100));

CREATE TABLE node_traffic_cycles (
  id TEXT PRIMARY KEY,
  node_name TEXT NOT NULL,
  cycle_start INTEGER NOT NULL,
  cycle_end INTEGER NOT NULL,
  quota_bytes INTEGER,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  counter_in_start INTEGER,
  counter_out_start INTEGER,
  counter_in_last INTEGER,
  counter_out_last INTEGER,
  resets_detected INTEGER NOT NULL DEFAULT 0,
  peak_day_at INTEGER,
  peak_day_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  projected_exhaust_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX node_traffic_cycles_open ON node_traffic_cycles(node_name) WHERE status = 'open';
CREATE INDEX node_traffic_cycles_node ON node_traffic_cycles(node_name, cycle_start DESC);

-- Used-bytes snapshots for the 7-day exhaustion slope. Retention is 60 days,
-- enforced by the roller rather than a trigger.
CREATE TABLE node_traffic_cycle_samples (
  cycle_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  used_bytes INTEGER NOT NULL,
  PRIMARY KEY (cycle_id, at)
);

CREATE INDEX node_traffic_cycle_samples_at ON node_traffic_cycle_samples(at);

CREATE TABLE node_error_daily (
  node TEXT NOT NULL,
  day_at INTEGER NOT NULL,
  category TEXT NOT NULL
    CHECK(category IN ('dial_timeout', 'handshake_fail', 'auth_reject', 'upstream_reject', 'other')),
  count INTEGER NOT NULL DEFAULT 0,
  sample TEXT CHECK(sample IS NULL OR length(sample) <= 300),
  PRIMARY KEY (node, day_at, category)
);
