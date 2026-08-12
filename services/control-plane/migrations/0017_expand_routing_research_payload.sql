PRAGMA foreign_keys = ON;

-- Migration 0016 may already be applied. Rebuild the immutable child table so
-- schema-v2's bounded component aggregates can use up to 8 KiB without editing
-- the historical migration or losing existing schema-v1 snapshots.
CREATE TABLE routing_research_snapshots_v2 (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL CHECK(length(snapshot_id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  received_at INTEGER NOT NULL,
  observed_since INTEGER NOT NULL CHECK(observed_since >= 0),
  observed_until INTEGER NOT NULL
    CHECK(observed_until = observed_since + 21600),
  app_version TEXT NOT NULL CHECK(length(app_version) BETWEEN 1 AND 40),
  build TEXT NOT NULL
    CHECK(length(build) BETWEEN 1 AND 10
      AND build NOT GLOB '*[^0-9]*'),
  os_version TEXT NOT NULL CHECK(length(os_version) BETWEEN 3 AND 12),
  architecture TEXT NOT NULL CHECK(architecture IN ('arm64', 'x86_64')),
  aggregate_json TEXT NOT NULL CHECK(length(aggregate_json) <= 8192),
  UNIQUE(device_id, snapshot_id)
);

INSERT INTO routing_research_snapshots_v2(
  id, snapshot_id, user_id, device_id, received_at, observed_since,
  observed_until, app_version, build, os_version, architecture, aggregate_json
)
SELECT id, snapshot_id, user_id, device_id, received_at, observed_since,
       observed_until, app_version, build, os_version, architecture,
       aggregate_json
FROM routing_research_snapshots;

DROP TRIGGER routing_research_snapshots_immutable_update;
DROP TABLE routing_research_snapshots;
ALTER TABLE routing_research_snapshots_v2 RENAME TO routing_research_snapshots;

CREATE INDEX routing_research_retention
  ON routing_research_snapshots(received_at);
CREATE INDEX routing_research_build_recent
  ON routing_research_snapshots(build, received_at DESC);
CREATE INDEX routing_research_recent
  ON routing_research_snapshots(received_at DESC);

CREATE TRIGGER routing_research_snapshots_immutable_update
BEFORE UPDATE ON routing_research_snapshots
BEGIN
  SELECT RAISE(ABORT, 'ROUTING_RESEARCH_SNAPSHOT_IMMUTABLE');
END;
