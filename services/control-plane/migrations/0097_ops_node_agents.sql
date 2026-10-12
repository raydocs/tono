-- Node self-registration v1 (backlog A20, decision D7-A): one row per node
-- name, keyed on the same catalog name as ops_node_profiles.catalog_name,
-- ops_node_status.node_name and ops_node_identity.name.
--
-- The token columns hold a per-node heartbeat credential issued by an owner
-- (POST /api/v1/ops/nodes/{name}/agent-token). Only a salted SHA-256 of the
-- secret part is kept; the token is shown once. It authenticates the
-- heartbeat route and nothing else: no roster, no catalog, no other node.
-- Re-issuing replaces token_id and the hash in place, so the old token is
-- dead at once; revoking stamps token_revoked_at.
--
-- The heartbeat columns are what the node said about itself plus the address
-- Cloudflare saw (CF-Connecting-IP). Nothing reads them to route, list or
-- publish a node: catalog membership and ops_node_profiles.public_ip are
-- untouched by a heartbeat.
--
-- 0096 is allocated to a concurrent task (A5); this number is fixed.

CREATE TABLE IF NOT EXISTS ops_node_agents (
  node_name TEXT PRIMARY KEY CHECK(length(node_name) BETWEEN 1 AND 200),
  token_id TEXT NOT NULL UNIQUE CHECK(length(token_id) = 16),
  token_salt TEXT NOT NULL CHECK(length(token_salt) = 22),
  token_hash TEXT NOT NULL CHECK(length(token_hash) = 43),
  token_issued_at INTEGER NOT NULL,
  token_revoked_at INTEGER,
  reported_ip TEXT CHECK(reported_ip IS NULL OR length(reported_ip) BETWEEN 2 AND 45),
  observed_ip TEXT CHECK(observed_ip IS NULL OR length(observed_ip) BETWEEN 2 AND 45),
  roles TEXT CHECK(roles IS NULL OR length(roles) <= 40),
  agent_version TEXT CHECK(agent_version IS NULL OR length(agent_version) BETWEEN 1 AND 40),
  first_heartbeat_at INTEGER,
  last_heartbeat_at INTEGER
);
