-- Customer 360 projections: current status, UTC activity hours, and
-- session/device lifecycle events. Additive; no foreign keys, so a
-- pre-migration worker can keep serving while this ships.
PRAGMA foreign_keys = ON;

CREATE TABLE ops_customer_status (
  user_id TEXT PRIMARY KEY,
  device_id TEXT, platform TEXT, app_version TEXT, os_version TEXT,
  ui_state TEXT, connected INTEGER NOT NULL DEFAULT 0, connected_since INTEGER,
  selected_server TEXT, catalog_revision INTEGER,
  last_seen_at INTEGER, last_window_id TEXT,
  edge_asn INTEGER, edge_as_org TEXT, edge_country TEXT, edge_region TEXT,
  last_fail_at INTEGER, last_fail_code TEXT, last_fail_node TEXT, fails_30m INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ops_customer_status_seen ON ops_customer_status(last_seen_at DESC);

CREATE TABLE customer_activity_hours (
  user_id TEXT NOT NULL, device_id TEXT NOT NULL DEFAULT '', hour_at INTEGER NOT NULL,
  online_minutes INTEGER NOT NULL DEFAULT 0, connected_minutes INTEGER NOT NULL DEFAULT 0,
  bytes_up INTEGER NOT NULL DEFAULT 0, bytes_down INTEGER NOT NULL DEFAULT 0,
  node TEXT, app_version TEXT, platform TEXT, windows INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, device_id, hour_at)
);
CREATE INDEX customer_activity_hours_user ON customer_activity_hours(user_id, hour_at DESC);

CREATE TABLE customer_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('login','logout','device_registered','device_revoked','credential_rotated','session_expired')),
  at INTEGER NOT NULL, source TEXT, detail TEXT CHECK(detail IS NULL OR length(detail) <= 300)
);
CREATE INDEX customer_sessions_user ON customer_sessions(user_id, at DESC, id DESC);

CREATE TABLE ops_customer_projection_cursor (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
  last_received_at INTEGER NOT NULL, last_window_id TEXT NOT NULL, updated_at INTEGER NOT NULL
);
