-- Node-side residential SOCKS5 dialing (RFC PR 1).
-- Additive only: preserves legacy_socks5 default and existing 0080 rotation triggers.
-- All CREATE TRIGGER bodies are kept single-line for remote D1 migration ingestion.

ALTER TABLE home_exits ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'legacy_socks5'
  CHECK(delivery_mode IN ('legacy_socks5', 'node_only'));
ALTER TABLE home_exits ADD COLUMN ever_served_plaintext_at INTEGER;
ALTER TABLE home_exits ADD COLUMN drain_required_generation TEXT;

ALTER TABLE exit_nodes ADD COLUMN node_home_capable INTEGER NOT NULL DEFAULT 0
  CHECK(node_home_capable IN (0, 1));
ALTER TABLE exit_nodes ADD COLUMN node_home_metering_version INTEGER NOT NULL DEFAULT 0
  CHECK(node_home_metering_version >= 0);
ALTER TABLE exit_nodes ADD COLUMN node_home_xray_version TEXT;
ALTER TABLE exit_nodes ADD COLUMN last_home_roster_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE device_home_credentials (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 64),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  home_exit_id TEXT NOT NULL REFERENCES home_exits(id) ON DELETE CASCADE,
  binding_generation TEXT NOT NULL CHECK(length(binding_generation) BETWEEN 1 AND 64),
  client_uuid TEXT NOT NULL UNIQUE CHECK(length(client_uuid) = 36),
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  retired_at INTEGER,
  retire_reason TEXT
);

CREATE UNIQUE INDEX device_home_credentials_active_unique
  ON device_home_credentials(device_id, home_exit_id)
  WHERE retired_at IS NULL;

CREATE INDEX device_home_credentials_active_user
  ON device_home_credentials(user_id, home_exit_id)
  WHERE retired_at IS NULL;

CREATE INDEX device_home_credentials_active_home
  ON device_home_credentials(home_exit_id)
  WHERE retired_at IS NULL;

CREATE TABLE home_exit_nodes (
  home_exit_id TEXT NOT NULL REFERENCES home_exits(id) ON DELETE CASCADE,
  exit_node_id TEXT NOT NULL REFERENCES exit_nodes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (home_exit_id, exit_node_id)
);

CREATE INDEX home_exit_nodes_by_node
  ON home_exit_nodes(exit_node_id);

CREATE TABLE home_exit_drain_acks (
  home_exit_id TEXT NOT NULL REFERENCES home_exits(id) ON DELETE CASCADE,
  retired_generation TEXT NOT NULL CHECK(length(retired_generation) BETWEEN 1 AND 64),
  node_id TEXT NOT NULL REFERENCES exit_nodes(id) ON DELETE CASCADE,
  admitted_at INTEGER NOT NULL,
  drained_at INTEGER,
  PRIMARY KEY (home_exit_id, retired_generation, node_id)
);

CREATE INDEX home_exit_drain_acks_pending
  ON home_exit_drain_acks(home_exit_id, retired_generation)
  WHERE drained_at IS NULL;

CREATE TABLE home_outbound_deliveries (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 64),
  node_id TEXT NOT NULL REFERENCES exit_nodes(id) ON DELETE CASCADE,
  observed_at INTEGER NOT NULL,
  home_exit_ids_json TEXT NOT NULL,
  identity_count INTEGER NOT NULL CHECK(identity_count >= 0),
  created_at INTEGER NOT NULL
);

CREATE INDEX home_outbound_deliveries_node_time
  ON home_outbound_deliveries(node_id, observed_at DESC);

CREATE TRIGGER device_home_credentials_retire_on_unbind AFTER DELETE ON user_home_bindings BEGIN UPDATE home_exits SET drain_required_generation = COALESCE((SELECT binding_generation FROM device_home_credentials WHERE user_id = OLD.user_id AND home_exit_id = OLD.home_exit_id AND retired_at IS NULL AND EXISTS (SELECT 1 FROM home_exit_drain_acks a WHERE a.home_exit_id = OLD.home_exit_id AND a.retired_generation = device_home_credentials.binding_generation AND a.drained_at IS NULL) LIMIT 1), drain_required_generation) WHERE id = OLD.home_exit_id AND kind = 'socks5'; UPDATE device_home_credentials SET retired_at = CAST(strftime('%s', 'now') AS INTEGER), retire_reason = 'unbind' WHERE user_id = OLD.user_id AND home_exit_id = OLD.home_exit_id AND retired_at IS NULL; END;

CREATE TRIGGER device_home_credentials_retire_on_rebind AFTER UPDATE OF home_exit_id ON user_home_bindings WHEN NEW.home_exit_id <> OLD.home_exit_id BEGIN UPDATE home_exits SET drain_required_generation = COALESCE((SELECT binding_generation FROM device_home_credentials WHERE user_id = OLD.user_id AND home_exit_id = OLD.home_exit_id AND retired_at IS NULL AND EXISTS (SELECT 1 FROM home_exit_drain_acks a WHERE a.home_exit_id = OLD.home_exit_id AND a.retired_generation = device_home_credentials.binding_generation AND a.drained_at IS NULL) LIMIT 1), drain_required_generation) WHERE id = OLD.home_exit_id AND kind = 'socks5'; UPDATE device_home_credentials SET retired_at = CAST(strftime('%s', 'now') AS INTEGER), retire_reason = 'rebind' WHERE user_id = OLD.user_id AND home_exit_id = OLD.home_exit_id AND retired_at IS NULL; END;

CREATE TRIGGER device_home_credentials_retire_on_device_revoke AFTER UPDATE OF status ON devices WHEN NEW.status = 'revoked' BEGIN UPDATE device_home_credentials SET retired_at = CAST(strftime('%s', 'now') AS INTEGER), retire_reason = 'device_revoked' WHERE device_id = NEW.id AND retired_at IS NULL; END;

CREATE TRIGGER device_home_credentials_retire_on_user_disable AFTER UPDATE OF status ON users WHEN OLD.status = 'active' AND NEW.status <> 'active' BEGIN UPDATE home_exits SET drain_required_generation = COALESCE((SELECT c.binding_generation FROM device_home_credentials c WHERE c.user_id = NEW.id AND c.home_exit_id = home_exits.id AND c.retired_at IS NULL AND EXISTS (SELECT 1 FROM home_exit_drain_acks a WHERE a.home_exit_id = c.home_exit_id AND a.retired_generation = c.binding_generation AND a.drained_at IS NULL) LIMIT 1), drain_required_generation) WHERE kind = 'socks5' AND id IN (SELECT home_exit_id FROM device_home_credentials WHERE user_id = NEW.id AND retired_at IS NULL); UPDATE device_home_credentials SET retired_at = CAST(strftime('%s', 'now') AS INTEGER), retire_reason = 'user_disabled' WHERE user_id = NEW.id AND retired_at IS NULL; END;

CREATE TRIGGER device_home_credentials_retire_on_home_inactive AFTER UPDATE OF status ON home_exits WHEN OLD.status = 'active' AND NEW.status <> 'active' BEGIN UPDATE home_exits SET drain_required_generation = COALESCE((SELECT c.binding_generation FROM device_home_credentials c WHERE c.home_exit_id = NEW.id AND c.retired_at IS NULL AND EXISTS (SELECT 1 FROM home_exit_drain_acks a WHERE a.home_exit_id = NEW.id AND a.retired_generation = c.binding_generation AND a.drained_at IS NULL) LIMIT 1), drain_required_generation) WHERE id = NEW.id AND kind = 'socks5'; UPDATE device_home_credentials SET retired_at = CAST(strftime('%s', 'now') AS INTEGER), retire_reason = 'home_inactive' WHERE home_exit_id = NEW.id AND retired_at IS NULL; END;
