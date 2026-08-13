-- Operator desk: Claude account ledger, VPS billing profiles, home-line
-- probes, and an append-only audit log. No payment columns. No secrets
-- beyond the socks5 fields that already live on home_exits.
PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN notes TEXT;
ALTER TABLE users ADD COLUMN contact TEXT;
ALTER TABLE users ADD COLUMN first_entitled_at INTEGER;

ALTER TABLE home_exits ADD COLUMN last_probed_at INTEGER;
ALTER TABLE home_exits ADD COLUMN probe_status TEXT
  CHECK(probe_status IS NULL OR probe_status IN ('alive', 'dead', 'untested'));

CREATE TABLE product_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  product TEXT NOT NULL DEFAULT 'claude_20x'
    CHECK(product IN ('claude_20x')),
  account_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pooled', 'assigned', 'banned', 'retired')),
  opened_at INTEGER,
  closed_at INTEGER,
  close_reason TEXT
    CHECK(close_reason IS NULL OR close_reason IN ('banned', 'rotated', 'expired', 'unused', 'other')),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(length(account_ref) BETWEEN 1 AND 200),
  CHECK(notes IS NULL OR length(notes) <= 2000),
  CHECK(status != 'assigned' OR user_id IS NOT NULL)
);

CREATE UNIQUE INDEX product_accounts_ref_unique ON product_accounts(account_ref);
CREATE UNIQUE INDEX product_accounts_one_assigned
  ON product_accounts(user_id) WHERE status = 'assigned';
CREATE INDEX product_accounts_user_status ON product_accounts(user_id, status);
CREATE INDEX product_accounts_status ON product_accounts(status);

CREATE TABLE product_account_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES product_accounts(id) ON DELETE CASCADE,
  user_id TEXT,
  type TEXT NOT NULL CHECK(type IN ('opened', 'assigned', 'banned', 'replaced', 'note')),
  at INTEGER NOT NULL,
  detail TEXT,
  replaced_by_account_id TEXT REFERENCES product_accounts(id) ON DELETE SET NULL,
  CHECK(detail IS NULL OR length(detail) <= 1000)
);

CREATE INDEX product_account_events_account
  ON product_account_events(account_id, at DESC);

CREATE TABLE ops_node_profiles (
  id TEXT PRIMARY KEY,
  catalog_name TEXT NOT NULL,
  public_ip TEXT,
  provider TEXT,
  billing_url TEXT,
  traffic_quota_bytes INTEGER,
  traffic_used_bytes INTEGER,
  traffic_cycle_start INTEGER,
  traffic_cycle_end INTEGER,
  cycle_net_in INTEGER,
  cycle_net_out INTEGER,
  renews_at INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'retired')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(length(catalog_name) BETWEEN 1 AND 200),
  CHECK(
    billing_url IS NULL
    OR (length(billing_url) BETWEEN 8 AND 500 AND billing_url LIKE 'https://%')
  ),
  CHECK(notes IS NULL OR length(notes) <= 2000)
);

CREATE UNIQUE INDEX ops_node_profiles_name ON ops_node_profiles(catalog_name);
CREATE INDEX ops_node_profiles_renews ON ops_node_profiles(renews_at);

CREATE TABLE ops_audit (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  summary TEXT NOT NULL,
  CHECK(length(actor_email) BETWEEN 1 AND 254),
  CHECK(length(action) BETWEEN 1 AND 80),
  CHECK(length(summary) BETWEEN 1 AND 500)
);

CREATE INDEX ops_audit_at ON ops_audit(at DESC);
