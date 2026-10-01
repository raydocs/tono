-- One row per telemetry window already added to customer_activity_hours.
-- The upload hook and the cron projection both see every window; the
-- activity-hour upsert adds only when this marker was claimed in the same
-- batch, so a window is counted once whichever pass reaches it first.
CREATE TABLE customer_activity_windows (
  window_id TEXT PRIMARY KEY,
  claim TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX customer_activity_windows_received ON customer_activity_windows(received_at);
