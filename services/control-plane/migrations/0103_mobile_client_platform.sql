-- `devices.client_platform` accepts the mobile clients. 0092 added the column
-- with a column CHECK limited to ('macos', 'windows'), so an Android or iOS
-- build sending `X-Tono-Client: android/<version>` was dropped by the header
-- parser and, had it got through, the UPDATE would have failed the CHECK.
--
-- SQLite cannot alter a CHECK in place. The column CHECK belongs to the column
-- itself and no index, view or trigger reads it, so the column is replaced
-- without rebuilding `devices` (and its foreign keys and triggers): copy into a
-- widened column, drop the old one, rename the new one into place. The values
-- are observability only and are re-stamped on the next sign-in, refresh or
-- catalog fetch anyway. Additive for readers: same name, same type, NULL allowed.

ALTER TABLE devices ADD COLUMN client_platform_v2 TEXT
  CHECK (client_platform_v2 IS NULL OR client_platform_v2 IN ('macos', 'windows', 'android', 'ios'));
UPDATE devices SET client_platform_v2 = client_platform WHERE client_platform IS NOT NULL;
ALTER TABLE devices DROP COLUMN client_platform;
ALTER TABLE devices RENAME COLUMN client_platform_v2 TO client_platform;
