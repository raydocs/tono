-- Daily SLO rollup per (day_at, platform, carrier, node).
-- Computed daily by cron for the previous day.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ops_daily_slo (
  day_at INTEGER NOT NULL,
  platform TEXT NOT NULL,
  carrier TEXT NOT NULL,
  node TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  successes INTEGER NOT NULL,
  p50_ms INTEGER,
  verified_outage_min INTEGER NOT NULL,
  unmeasured_min INTEGER NOT NULL,
  rules_version INTEGER NOT NULL,
  PRIMARY KEY (day_at, platform, carrier, node)
);

CREATE INDEX IF NOT EXISTS ops_daily_slo_range ON ops_daily_slo(day_at DESC);
CREATE INDEX IF NOT EXISTS ops_daily_slo_node  ON ops_daily_slo(node, day_at DESC);
