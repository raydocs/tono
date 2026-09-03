-- Migration 0034: Device-scoped exit credentials.
-- Provides distinct VLESS identities per active device so that revoking a device
-- immediately withdraws its specific identity from exit rosters without affecting
-- sibling devices or allowing revoked devices to reuse shared credentials.
PRAGMA foreign_keys = ON;

CREATE TABLE device_exit_credentials (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_uuid TEXT NOT NULL UNIQUE
    CHECK(length(client_uuid) = 36
      AND client_uuid NOT GLOB '*[^0-9a-f-]*'
      AND substr(client_uuid, 9, 1) = '-'
      AND substr(client_uuid, 14, 1) = '-'
      AND substr(client_uuid, 19, 1) = '-'
      AND substr(client_uuid, 24, 1) = '-'),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_device_exit_credentials_user ON device_exit_credentials(user_id);
