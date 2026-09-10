-- Counting semantics for adoption and DIRECT candidates.
--
-- Three additive tables; nothing is dropped or altered.
--
-- ops_client_version_device_daily: one row per (UTC day, device) carrying the
-- version that device last reported that day. Adoption asks "how many devices
-- are on which version", which the per-day/per-version counts in
-- ops_client_version_daily cannot answer over a range: summing them turns one
-- device seen on thirty days into thirty devices.
--
-- direct_candidate_daily: per (user, UTC day, etld1) traffic behind a DIRECT
-- candidate, so users / bytes_30d / connections_30d on direct_candidates can be
-- a rolling 30-day recompute rather than a lifetime additive counter.
--
-- ops_traffic_segments: the ledger of parsed log segments. Its primary key is
-- what makes parsing a segment twice write nothing the second time. Existing
-- objects are seeded as already parsed: their counts are in the old tables
-- already, and re-parsing them would double them.

CREATE TABLE IF NOT EXISTS ops_client_version_device_daily (
  day_at INTEGER NOT NULL, platform TEXT NOT NULL, device_id TEXT NOT NULL,
  user_id TEXT NOT NULL, app_version TEXT NOT NULL, last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (day_at, device_id)
);
CREATE INDEX IF NOT EXISTS ops_cvdd_platform_day ON ops_client_version_device_daily(platform, day_at DESC);
CREATE TABLE IF NOT EXISTS direct_candidate_daily (
  user_id TEXT NOT NULL, day_at INTEGER NOT NULL, etld1 TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0, connections INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day_at, etld1)
);
CREATE INDEX IF NOT EXISTS direct_candidate_daily_etld1_day ON direct_candidate_daily(etld1, day_at DESC);
CREATE TABLE IF NOT EXISTS ops_traffic_segments (
  segment_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT, received_at INTEGER NOT NULL,
  parsed_at INTEGER NOT NULL, lines INTEGER NOT NULL DEFAULT 0, connection_rows INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ops_traffic_segments_parsed ON ops_traffic_segments(parsed_at);
INSERT OR IGNORE INTO ops_traffic_segments(segment_id, user_id, device_id, received_at, parsed_at, lines, connection_rows)
  SELECT id, user_id, device_id, received_at, received_at, COALESCE(line_count, 0), 0 FROM diagnostics_log_objects;
