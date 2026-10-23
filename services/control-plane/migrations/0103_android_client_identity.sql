-- Extend build metadata to the existing Android request header. Keep 0092
-- immutable and keep the device table (and its referencing rows) in place.
-- Apply all statements as one migration transaction: the copy must survive
-- before the old column is removed. No foreign-key disable or table rebuild.
ALTER TABLE devices ADD COLUMN client_platform_next TEXT
  CHECK (client_platform_next IS NULL OR client_platform_next IN ('macos', 'windows', 'android'));
UPDATE devices SET client_platform_next = client_platform;
ALTER TABLE devices DROP COLUMN client_platform;
ALTER TABLE devices RENAME COLUMN client_platform_next TO client_platform;
