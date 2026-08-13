-- Latest Komari inventory + quality/block report, pushed by the VPS collector.
-- Replaces live GETs to ops.afk.ccwu.cc / quality.afk.ccwu.cc so the admin
-- console can absorb those hostnames. Descriptive telemetry only; probe-agent
-- addresses and Komari tokens are stripped before insert.
CREATE TABLE operations_live_snapshot (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  quality_json TEXT,
  agents_json TEXT,
  quality_updated_at INTEGER,
  agents_updated_at INTEGER,
  updated_at INTEGER NOT NULL
);
