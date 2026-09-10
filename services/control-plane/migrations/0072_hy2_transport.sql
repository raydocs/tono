-- Hysteria2 backup transport beside VLESS Reality.
-- hy2_port / fingerprint / obfs live on the node profile (one row per base
-- catalog name). connection_events.transport is tcp|hy2 when the client
-- reports it; omitted on older clients. udp_ok is a quality-sample flag so
-- a mainland UDP probe can be stored without inventing a second sample table.

PRAGMA foreign_keys = ON;

ALTER TABLE ops_node_profiles ADD COLUMN hy2_port INTEGER;
ALTER TABLE ops_node_profiles ADD COLUMN hy2_fingerprint TEXT;
ALTER TABLE ops_node_profiles ADD COLUMN hy2_obfs_ref TEXT;

ALTER TABLE connection_events ADD COLUMN transport TEXT
  CHECK(transport IS NULL OR transport IN ('tcp', 'hy2'));

ALTER TABLE operations_quality_samples ADD COLUMN udp_ok INTEGER
  CHECK(udp_ok IS NULL OR udp_ok IN (0, 1));
