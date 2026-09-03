-- Hourly snapshots of each active customer's billing-cycle usage counter.
-- Adjacent hours minus each other are transfer. A drop is a cycle reset, not
-- negative traffic. A missing hour is unmeasured, not zero.

CREATE TABLE operations_user_usage_hours (
  user_id TEXT NOT NULL,
  hour_at INTEGER NOT NULL,
  usage_bytes INTEGER NOT NULL,
  PRIMARY KEY (user_id, hour_at)
);

CREATE INDEX operations_user_usage_hours_hour
  ON operations_user_usage_hours(hour_at);
