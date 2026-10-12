-- Last end-to-end check of each Tono-owned API relay (decision 077), reported
-- by the relay node itself: a full HTTPS request through its own :2053 to the
-- Cloudflare-fronted API with default certificate verification. One row per
-- relay, keyed `host:port` like `api_relay_probes`; `node_id` is the exit node
-- whose token signed the report. `observed_at` is the node's clock for the
-- probe, `received_at` the Worker's. `ok_since` / `failing_since` start the
-- current run of successes or failures. New table; nothing existing changes.

CREATE TABLE IF NOT EXISTS api_relay_reports (
  relay TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  http_status INTEGER,
  latency_ms INTEGER,
  error TEXT CHECK (error IS NULL OR length(error) <= 200),
  ok_since INTEGER,
  failing_since INTEGER
);
