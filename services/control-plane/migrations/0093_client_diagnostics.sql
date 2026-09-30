-- Privacy-safe client diagnostics. No hostnames, URLs, emails, or full IPs.
-- Raw network logs stay behind diagnostics_log_access; this migration does
-- not open that gate. See docs/diagnostics-privacy.md.

ALTER TABLE connection_events ADD COLUMN bytes_up INTEGER;
ALTER TABLE connection_events ADD COLUMN bytes_down INTEGER;
ALTER TABLE connection_events ADD COLUMN app_build TEXT;
ALTER TABLE connection_events ADD COLUMN git_commit TEXT;
ALTER TABLE connection_events ADD COLUMN core_version TEXT;
ALTER TABLE connection_events ADD COLUMN channel TEXT;

CREATE INDEX connection_events_version
  ON connection_events(app_version, platform, kind, at_ms DESC);

-- One row per client session. id is "{user_id}:{client_session_id}" so two
-- accounts cannot overwrite each other by reusing a session id.
CREATE TABLE client_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  node TEXT,
  entry_node_id TEXT,
  residential_exit_id TEXT,
  bytes_up INTEGER NOT NULL DEFAULT 0,
  bytes_down INTEGER NOT NULL DEFAULT 0,
  outcome TEXT,
  reason TEXT,
  app_version TEXT NOT NULL,
  app_build TEXT,
  git_commit TEXT,
  platform TEXT,
  os_version TEXT,
  core_version TEXT,
  channel TEXT,
  log_excerpt TEXT,
  received_at INTEGER NOT NULL
);

CREATE INDEX client_sessions_user ON client_sessions(user_id, started_at_ms DESC);

CREATE TABLE chain_hops (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT,
  hop_index INTEGER NOT NULL,
  hop_role TEXT NOT NULL CHECK(hop_role IN ('entry', 'residential')),
  node_id TEXT,
  connected INTEGER NOT NULL CHECK(connected IN (0, 1)),
  handshake_ms INTEGER,
  failure_code TEXT,
  at_ms INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE INDEX chain_hops_user ON chain_hops(user_id, at_ms DESC);

-- Exit identity is a /24 prefix plus a hash. Never a full address.
CREATE TABLE session_exit_observations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT,
  at_ms INTEGER NOT NULL,
  ip_prefix TEXT,
  ip_hash TEXT,
  asn INTEGER,
  country TEXT,
  city TEXT,
  network_kind TEXT NOT NULL CHECK(network_kind IN ('residential', 'datacenter', 'unknown')),
  previous_asn INTEGER,
  previous_country TEXT,
  previous_city TEXT,
  received_at INTEGER NOT NULL
);

CREATE INDEX session_exit_observations_user
  ON session_exit_observations(user_id, at_ms DESC);

CREATE TABLE dns_checks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  session_id TEXT,
  at_ms INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  resolver TEXT NOT NULL CHECK(resolver IN ('system', 'tunnel', 'unknown')),
  leak_outside INTEGER NOT NULL CHECK(leak_outside IN (0, 1)),
  geo_matches_exit INTEGER CHECK(geo_matches_exit IN (0, 1)),
  mode TEXT NOT NULL CHECK(mode IN ('fake-ip', 'real-ip', 'unknown')),
  ipv6_leak INTEGER NOT NULL CHECK(ipv6_leak IN (0, 1)),
  resolver_asn INTEGER,
  resolver_country TEXT,
  exit_asn INTEGER,
  exit_country TEXT,
  app_version TEXT,
  app_build TEXT,
  git_commit TEXT,
  platform TEXT,
  os_version TEXT,
  core_version TEXT,
  channel TEXT
);

CREATE INDEX dns_checks_user ON dns_checks(user_id, at_ms DESC);

-- Allowlisted AI-service routing only (claude | openai). Consent is required
-- at ingest. Retention is 60 days in the housekeeping cron.
CREATE TABLE ai_service_routes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  bucket_start_ms INTEGER NOT NULL,
  service TEXT NOT NULL CHECK(service IN ('claude', 'openai')),
  exit_kind TEXT NOT NULL CHECK(exit_kind IN ('residential', 'datacenter', 'direct', 'unknown')),
  exit_id TEXT,
  exit_asn INTEGER,
  exit_country TEXT,
  exit_city TEXT,
  routing_leak INTEGER NOT NULL CHECK(routing_leak IN (0, 1)),
  exit_switched INTEGER NOT NULL CHECK(exit_switched IN (0, 1)),
  dns_ok INTEGER CHECK(dns_ok IN (0, 1)),
  tz_mismatch INTEGER CHECK(tz_mismatch IN (0, 1)),
  locale TEXT,
  app_version TEXT,
  app_build TEXT,
  git_commit TEXT,
  platform TEXT,
  os_version TEXT,
  core_version TEXT,
  channel TEXT,
  received_at INTEGER NOT NULL
);

CREATE INDEX ai_service_routes_user ON ai_service_routes(user_id, bucket_start_ms DESC);

-- One open row per outage key (code + stage + app version + platform + node).
CREATE TABLE failure_clusters (
  id TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,
  code TEXT NOT NULL,
  stage TEXT NOT NULL,
  app_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  node TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  user_count INTEGER NOT NULL,
  device_count INTEGER NOT NULL,
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL,
  sample_json TEXT,
  opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  alerted_at INTEGER,
  alert_count INTEGER NOT NULL DEFAULT 0,
  count_at_alert INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('open', 'quiet'))
);

CREATE UNIQUE INDEX failure_clusters_one_open
  ON failure_clusters(group_key) WHERE status = 'open';
CREATE INDEX failure_clusters_recent ON failure_clusters(last_seen_ms DESC);

CREATE TABLE failure_cluster_members (
  cluster_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  PRIMARY KEY (cluster_id, user_id, device_id)
);

CREATE TABLE failure_alert_sends (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  reason TEXT NOT NULL
);

CREATE INDEX failure_alert_sends_recent ON failure_alert_sends(sent_at);

-- Support SQL. Versions are columns, not a join through emails.
CREATE VIEW v_failure_by_version AS
SELECT app_version, app_build, channel, platform, core_version, kind, code,
       COUNT(*) AS failures
FROM connection_events
WHERE kind IN (
  'connectFail', 'signInFail', 'releaseFail', 'syncFail',
  'healthProbeFail', 'appCrash', 'killSwitchFail'
)
GROUP BY app_version, app_build, channel, platform, core_version, kind, code;

CREATE VIEW v_user_diagnostics AS
SELECT user_id, device_id, id AS session_id, started_at_ms, ended_at_ms,
       node, entry_node_id, residential_exit_id, outcome, reason,
       app_version, app_build, git_commit, platform, os_version, core_version, channel,
       bytes_up, bytes_down
FROM client_sessions;
