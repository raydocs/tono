-- Track closed TCP/UDP flows, stalled TCP attempts, and total flow duration
-- in daily destination rollups so operators can monitor slow or hanging sites.

ALTER TABLE traffic_destination_daily ADD COLUMN closed_connections INTEGER NOT NULL DEFAULT 0;
ALTER TABLE traffic_destination_daily ADD COLUMN stalled_connections INTEGER NOT NULL DEFAULT 0;
ALTER TABLE traffic_destination_daily ADD COLUMN duration_ms_sum INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_traffic_destination_daily_day_etld
  ON traffic_destination_daily(day_at DESC, etld1);
