-- Periodic diagnostic timeline windows (testing default-on client upload).
-- Separate from diagnostics_reports (support reference codes / manual upload).
PRAGMA foreign_keys = ON;

CREATE TABLE telemetry_windows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  received_at INTEGER NOT NULL,
  window_start_ms INTEGER NOT NULL,
  window_end_ms INTEGER NOT NULL,
  client_version TEXT NOT NULL CHECK(length(client_version) BETWEEN 1 AND 40),
  os_version TEXT NOT NULL CHECK(length(os_version) BETWEEN 1 AND 80),
  -- Canonicalised, whitelisted payload. Refuse oversized rather than truncate.
  payload_json TEXT NOT NULL CHECK(length(payload_json) <= 65536)
);

CREATE INDEX telemetry_windows_user_recent
  ON telemetry_windows(user_id, received_at DESC);
CREATE INDEX telemetry_windows_retention
  ON telemetry_windows(received_at);

CREATE TRIGGER telemetry_windows_immutable_update
BEFORE UPDATE ON telemetry_windows
BEGIN
  SELECT RAISE(ABORT, 'TELEMETRY_WINDOW_IMMUTABLE');
END;
