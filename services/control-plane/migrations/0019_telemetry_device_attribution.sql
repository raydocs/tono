-- Attribute telemetry windows to the uploading device (from the session), so
-- operations can tell apart how many distinct devices are actively in use.
-- Nullable: windows written before this migration simply have no device.
ALTER TABLE telemetry_windows ADD COLUMN device_id TEXT;

CREATE INDEX telemetry_windows_device_recent
  ON telemetry_windows(device_id, received_at DESC);
