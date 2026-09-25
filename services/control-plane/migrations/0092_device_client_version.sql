-- The client build last seen on each device, from the `X-Tono-Client:
-- <platform>/<version>` header on sign-in, token refresh and catalog fetch.
-- Recorded whatever the device's telemetry settings are; the header holds a
-- platform and a version string only. Additive. Renumber at merge if 0092 is
-- taken by then.

ALTER TABLE devices ADD COLUMN client_platform TEXT
  CHECK (client_platform IS NULL OR client_platform IN ('macos', 'windows'));
ALTER TABLE devices ADD COLUMN client_version TEXT
  CHECK (client_version IS NULL OR length(client_version) BETWEEN 1 AND 40);
