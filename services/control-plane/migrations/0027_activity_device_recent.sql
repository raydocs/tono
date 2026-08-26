-- The operations activity endpoint reads the most recent heartbeat for every
-- device, not merely the last device that happened to report for a user. This
-- index supports its deterministic per-(user, device) ranking. NULL is the
-- legacy pre-0019 device bucket and still yields one latest row per user.
CREATE INDEX telemetry_windows_user_device_recent
  ON telemetry_windows(user_id, device_id, received_at DESC, id DESC);
