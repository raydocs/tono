-- Daily destination and service-family rollups from uploaded traffic-audit
-- segments, plus a queue of domestic names still leaving through the cloud
-- exit (candidates for the DIRECT overlay). Additive; 0041–0044 belong to
-- other briefs.

CREATE TABLE traffic_destination_daily (
  user_id TEXT NOT NULL, device_id TEXT, day_at INTEGER NOT NULL,
  etld1 TEXT NOT NULL CHECK(length(etld1) BETWEEN 1 AND 253),
  route TEXT NOT NULL CHECK(route IN ('cloud','residential','direct','reject','unknown')),
  node TEXT NOT NULL DEFAULT '',
  connections INTEGER NOT NULL DEFAULT 0, bytes_up INTEGER NOT NULL DEFAULT 0, bytes_down INTEGER NOT NULL DEFAULT 0,
  top_process TEXT CHECK(top_process IS NULL OR length(top_process) <= 512),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id, day_at, etld1, route, node)
);
CREATE INDEX traffic_destination_daily_user ON traffic_destination_daily(user_id, day_at DESC);
CREATE INDEX traffic_destination_daily_etld ON traffic_destination_daily(etld1, day_at DESC);
CREATE TABLE service_usage_daily (
  user_id TEXT NOT NULL, day_at INTEGER NOT NULL,
  family TEXT NOT NULL, route TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0, sessions INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day_at, family, route)
);
CREATE INDEX service_usage_daily_user ON service_usage_daily(user_id, day_at DESC);
CREATE TABLE direct_candidates (
  etld1 TEXT PRIMARY KEY CHECK(length(etld1) BETWEEN 1 AND 253),
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  users INTEGER NOT NULL DEFAULT 0, bytes_30d INTEGER NOT NULL DEFAULT 0, connections_30d INTEGER NOT NULL DEFAULT 0,
  country_hint TEXT, status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','accepted','rejected','already_direct')),
  decided_by TEXT, decided_at INTEGER, notes TEXT CHECK(notes IS NULL OR length(notes) <= 500)
);
CREATE INDEX direct_candidates_status ON direct_candidates(status, bytes_30d DESC);
