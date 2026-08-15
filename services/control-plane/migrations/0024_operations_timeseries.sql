-- Minute-level machine telemetry and home-probe history.
-- The live snapshot table is still the "now" row; this is what used to be
-- thrown away on every collector push.
--
-- Retention (enforced in the scheduled worker, not here):
--   samples: 48h at 1 minute
--   rollups 300s: 7 days
--   rollups 3600s: 90 days
--   home probes / quality samples: 90 days

CREATE TABLE operations_agent_samples (
  node_name TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  cpu REAL,
  cpu_cores REAL,
  mem_total INTEGER,
  mem_used INTEGER,
  disk_total INTEGER,
  disk_used INTEGER,
  net_in INTEGER,
  net_out INTEGER,
  load1 REAL,
  load5 REAL,
  load15 REAL,
  swap_total INTEGER,
  swap_used INTEGER,
  tcp_connections INTEGER,
  processes INTEGER,
  uptime INTEGER,
  PRIMARY KEY (node_name, observed_at)
);

CREATE INDEX operations_agent_samples_observed
  ON operations_agent_samples(observed_at);

CREATE TABLE operations_agent_rollups (
  node_name TEXT NOT NULL,
  resolution_seconds INTEGER NOT NULL,
  bucket_at INTEGER NOT NULL,
  samples INTEGER NOT NULL,
  cpu_avg REAL,
  mem_used_avg REAL,
  mem_total INTEGER,
  disk_used_avg REAL,
  disk_total INTEGER,
  load1_avg REAL,
  net_in_last INTEGER,
  net_out_last INTEGER,
  swap_used_avg REAL,
  tcp_avg REAL,
  PRIMARY KEY (node_name, resolution_seconds, bucket_at)
);

CREATE INDEX operations_agent_rollups_bucket
  ON operations_agent_rollups(resolution_seconds, bucket_at);

CREATE TABLE operations_home_probe_samples (
  home_exit_id TEXT NOT NULL,
  probed_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('alive', 'dead')),
  PRIMARY KEY (home_exit_id, probed_at)
);

CREATE INDEX operations_home_probe_samples_probed
  ON operations_home_probe_samples(probed_at);

CREATE TABLE operations_quality_samples (
  node_name TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  quality TEXT,
  block_status TEXT,
  PRIMARY KEY (node_name, observed_at)
);

CREATE INDEX operations_quality_samples_observed
  ON operations_quality_samples(observed_at);
