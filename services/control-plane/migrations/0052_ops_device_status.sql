-- Per-device live status, then customer rows are derived from it so one
-- person's Mac cannot overwrite their Windows. attempt_id lets a failure
-- POST and the later window that contains the same try share one
-- connection_events row (INSERT OR IGNORE on both paths).
PRAGMA foreign_keys = ON;

CREATE TABLE ops_device_status (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT, app_version TEXT, os_version TEXT,
  selected_server TEXT,
  connected INTEGER NOT NULL DEFAULT 0, connected_since INTEGER,
  last_seen_at INTEGER, last_window_id TEXT,
  exit_delay_ms INTEGER, tcp_delay_ms INTEGER,
  last_fail_at INTEGER, last_fail_code TEXT, last_fail_node TEXT,
  fails_30m INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX ops_device_status_seen ON ops_device_status(user_id, last_seen_at DESC);

ALTER TABLE connection_events ADD COLUMN attempt_id TEXT;
CREATE UNIQUE INDEX connection_events_attempt
  ON connection_events(user_id, attempt_id) WHERE attempt_id IS NOT NULL;
