-- Flattened connection events extracted from immutable telemetry windows
-- (and later from diagnostics / direct reports). telemetry_windows rejects
-- UPDATE, so flatten progress cannot live as a watermark column there; the
-- cursor is a singleton beside the events.
--
-- edge_* is the customer→edge hop (Cloudflare colo / client ISP at intake).
-- It must never be joined with node→mainland carrier data (Komari 三网,
-- quality probes, provider ASN): those are a different leg, and mixing them
-- attributes a mainland block to the user's access ISP or the reverse.
--
-- No user_id foreign key: node-level failure rates have to survive account
-- deletion, which already cascades the source windows.

CREATE TABLE connection_events (
  id TEXT PRIMARY KEY,                 -- '<window_id>:<json_each.key>' | 'dx:<report id>' | uuid
  at_ms INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('window','direct','diagnostics','failure')),
  window_id TEXT,
  user_id TEXT NOT NULL,
  device_id TEXT,
  platform TEXT CHECK(platform IS NULL OR platform IN ('windows','macos','linux','android','ios')),
  app_version TEXT, os_version TEXT, os_arch TEXT,
  kind TEXT NOT NULL CHECK(length(kind) BETWEEN 1 AND 40),
  node TEXT CHECK(node IS NULL OR length(node) <= 120),
  stage TEXT, outcome TEXT, code TEXT,
  error TEXT CHECK(error IS NULL OR length(error) <= 200),
  action TEXT, reason TEXT, from_node TEXT, to_node TEXT,
  elapsed_ms INTEGER, delay_ms INTEGER, exit_delay_ms INTEGER, tcp_delay_ms INTEGER,
  catalog_revision INTEGER,
  edge_asn INTEGER, edge_as_org TEXT CHECK(edge_as_org IS NULL OR length(edge_as_org) <= 120),
  edge_country TEXT, edge_region TEXT,
  edge_via_exit INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX connection_events_recent    ON connection_events(received_at DESC, id DESC);
CREATE INDEX connection_events_user      ON connection_events(user_id, at_ms DESC);
CREATE INDEX connection_events_node      ON connection_events(node, at_ms DESC);
CREATE INDEX connection_events_user_fail ON connection_events(user_id, at_ms DESC) WHERE kind = 'connectFail';
CREATE INDEX connection_events_node_fail ON connection_events(node, at_ms DESC) WHERE kind = 'connectFail';

CREATE TABLE ops_flatten_cursor (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
  last_received_at INTEGER NOT NULL, last_window_id TEXT NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE ops_connection_daily (
  day_at INTEGER NOT NULL, node TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL, code TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL, users INTEGER NOT NULL, p50_elapsed_ms INTEGER,
  PRIMARY KEY (day_at, node, platform, kind, code)
);
