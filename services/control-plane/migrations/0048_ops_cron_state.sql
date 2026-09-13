-- Last-run watermarks for the hourly quota roll and the UTC-day rollups so a
-- 5-minute tick does not redo them. key is a stable name ('hourly', 'daily');
-- ran_at is the unix second of the last successful run.
--
-- path_streak is the customer path-slow hysteresis the verdict engine hands
-- back; applyWindowToStatus does not touch it.
PRAGMA foreign_keys = ON;

CREATE TABLE ops_cron_state (
  key TEXT PRIMARY KEY,
  ran_at INTEGER NOT NULL
);

ALTER TABLE ops_customer_status ADD COLUMN path_streak INTEGER NOT NULL DEFAULT 0;
