-- Phase 1 read-only operations model. These tables contain descriptive state only:
-- no endpoint credentials, VLESS UUIDs, private keys, SSH material, or control-plane secrets.
-- managed_exit_catalog remains the sole writable catalog authority.
CREATE TABLE operations_servers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  region_code TEXT NOT NULL,
  provider TEXT,
  status TEXT NOT NULL CHECK(status IN ('planned','active','degraded','retired')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE operations_logical_nodes (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES operations_servers(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  region_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planned','active','degraded','retired')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(id, server_id)
);

CREATE TABLE operations_deployments (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES operations_servers(id) ON DELETE RESTRICT,
  logical_node_id TEXT,
  environment TEXT NOT NULL,
  release_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planned','deploying','active','failed','rolled_back','retired')),
  deployed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(logical_node_id, server_id)
    REFERENCES operations_logical_nodes(id, server_id) ON DELETE RESTRICT
);

CREATE TABLE operations_catalog_revision_metadata (
  revision INTEGER PRIMARY KEY CHECK(revision > 0),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
  published_at INTEGER NOT NULL,
  server_count INTEGER NOT NULL CHECK(server_count >= 0),
  logical_node_count INTEGER NOT NULL CHECK(logical_node_count >= 0),
  deployment_count INTEGER NOT NULL CHECK(deployment_count >= 0)
);

CREATE INDEX operations_logical_nodes_server ON operations_logical_nodes(server_id);
CREATE INDEX operations_deployments_server_created ON operations_deployments(server_id, created_at DESC);
CREATE INDEX operations_deployments_node_created ON operations_deployments(logical_node_id, created_at DESC);
