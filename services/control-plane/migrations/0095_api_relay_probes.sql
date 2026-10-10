-- Last TCP reachability check of each Tono-owned API relay (decision 077),
-- written by the five-minute cron. One row per relay, keyed `host:port`.
-- `ok_since` is when the current run of successes began (NULL while failing);
-- `failing_since` is when the current run of failures began (NULL while ok).
-- A Worker cannot set SNI on a raw socket, so this proves the port is open,
-- not that the TLS pass-through works. New table; nothing existing changes.
-- Renumber at merge if 0095 is taken by then.

CREATE TABLE IF NOT EXISTS api_relay_probes (
  relay TEXT PRIMARY KEY,
  checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  latency_ms INTEGER,
  error TEXT CHECK (error IS NULL OR length(error) <= 200),
  ok_since INTEGER,
  failing_since INTEGER
);
