-- Residential (家宽) line commercial attributes, expiry, and per-source daily
-- metering. Existing home_exits rows stay valid: every new column is nullable.

ALTER TABLE home_exits ADD COLUMN provider_account_id TEXT;
ALTER TABLE home_exits ADD COLUMN isp TEXT;
ALTER TABLE home_exits ADD COLUMN region TEXT;
ALTER TABLE home_exits ADD COLUMN price REAL;
ALTER TABLE home_exits ADD COLUMN currency TEXT;
ALTER TABLE home_exits ADD COLUMN billing_kind TEXT CHECK(billing_kind IS NULL OR billing_kind IN ('monthly','per_gb','bundle'));
ALTER TABLE home_exits ADD COLUMN bundle_bytes INTEGER;
ALTER TABLE home_exits ADD COLUMN cycle_start INTEGER;
ALTER TABLE home_exits ADD COLUMN cycle_end INTEGER;
ALTER TABLE home_exits ADD COLUMN expires_at INTEGER;
ALTER TABLE home_exits ADD COLUMN meter_source TEXT CHECK(meter_source IS NULL OR meter_source IN ('client_route','node_stats','provider_api','manual'));

CREATE TABLE home_line_usage_daily (
  home_exit_id TEXT NOT NULL, day_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('client_route','node_stats','provider_api','manual')),
  bytes_up INTEGER NOT NULL DEFAULT 0, bytes_down INTEGER NOT NULL DEFAULT 0, users INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (home_exit_id, day_at, source)
);

CREATE INDEX home_line_usage_daily_line ON home_line_usage_daily(home_exit_id, day_at DESC);
