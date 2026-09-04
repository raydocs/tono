-- Explicit metering-v2 cutover and server-side raw-log consent.
PRAGMA foreign_keys = ON;

-- `dual` is a shadow phase: an account with a legacy source continues to bill
-- from that source while named reporters establish their own durable v2
-- watermarks. The operator is the only actor that can advance the phase.
CREATE TABLE usage_metering_rollout (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
  phase TEXT NOT NULL DEFAULT 'dual'
    CHECK(phase IN ('dual', 'v2_required')),
  -- Coarse collector liveness is separate from per-account watermarks. This is
  -- updated once per legacy request, not once per report row.
  legacy_last_seen_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- A migration over a database that already has legacy state must begin blocked,
-- even if the collector happens to be between polls while the migration runs.
INSERT INTO usage_metering_rollout(
  singleton_id, phase, legacy_last_seen_at, updated_at
)
SELECT 1,
       'dual',
       CASE WHEN EXISTS (
         SELECT 1 FROM usage_report_sources WHERE source_id = ''
       ) THEN unixepoch() ELSE 0 END,
       unixepoch();

-- Metering capability belongs to the node process, not to a user's traffic.
-- A v2 agent acknowledges successful durable metering independently of the
-- credential roster, allowing an
-- idle or empty exit to prove readiness without inventing a zero-byte report.
ALTER TABLE exit_nodes
  ADD COLUMN metering_protocol_version INTEGER NOT NULL DEFAULT 1
  CHECK(metering_protocol_version IN (1, 2));

ALTER TABLE exit_nodes
  ADD COLUMN metering_last_seen_at INTEGER NOT NULL DEFAULT 0;

-- At cutover, preserve the account's monotonic billing authority and snapshot
-- the current named sum. Only later named growth is added. This does NOT prove
-- matching coverage: traffic during legacy silence can be absorbed unbilled.
-- See EXIT_METERING.md; live lossless cutover remains deferred.
CREATE TABLE usage_metering_cutover_baselines (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reported_bytes INTEGER NOT NULL CHECK(reported_bytes >= 0),
  named_bytes INTEGER NOT NULL CHECK(named_bytes >= 0),
  cutover_at INTEGER NOT NULL
);

-- The database is the final race boundary. Application preflight makes these
-- failures readable, while this trigger prevents a legacy ingest racing the
-- phase change or an unverified active node from being cut off.
CREATE TRIGGER usage_metering_rollout_ready
BEFORE UPDATE OF phase ON usage_metering_rollout
WHEN NEW.phase = 'v2_required' AND OLD.phase = 'dual' AND (
  NOT EXISTS (SELECT 1 FROM exit_nodes WHERE status = 'active')
  OR EXISTS (
    SELECT 1
    FROM exit_nodes
    WHERE exit_nodes.status = 'active'
      AND (
        exit_nodes.metering_protocol_version != 2
        OR exit_nodes.metering_last_seen_at <= unixepoch() - 900
      )
  )
  -- Two observed 15-minute legacy collector cadences must pass with no request.
  -- The application updates this once per request rather than touching every
  -- unchanged account watermark.
  OR NEW.legacy_last_seen_at > unixepoch() - 1800
)
BEGIN
  SELECT RAISE(ABORT, 'USAGE_METERING_ROLLOUT_NOT_READY');
END;

-- Make even an unchanged legacy poll participate in the cutover ordering. The
-- application targets this trigger after v2 is required, while still skipping
-- the UPDATE entirely for sub-minute liveness refreshes during `dual`.
CREATE TRIGGER usage_metering_legacy_requires_dual
BEFORE UPDATE OF legacy_last_seen_at ON usage_metering_rollout
WHEN OLD.phase = 'v2_required'
BEGIN
  SELECT RAISE(ABORT, 'USAGE_METERING_V2_REQUIRED');
END;

-- Once v2 is required, a racing or direct legacy/v1 write cannot get past the
-- table boundary. Named v2 still uses the existing immutable watermark rules.
CREATE TRIGGER usage_reports_require_metering_v2
BEFORE INSERT ON usage_reports
WHEN EXISTS (
  SELECT 1 FROM usage_metering_rollout
  WHERE singleton_id = 1 AND phase = 'v2_required'
) AND (NEW.source_id = '' OR NEW.protocol_version != 2)
BEGIN
  SELECT RAISE(ABORT, 'USAGE_METERING_V2_REQUIRED');
END;

CREATE TRIGGER usage_report_sources_require_metering_v2_insert
BEFORE INSERT ON usage_report_sources
WHEN EXISTS (
  SELECT 1 FROM usage_metering_rollout
  WHERE singleton_id = 1 AND phase = 'v2_required'
) AND (NEW.source_id = '' OR NEW.protocol_version != 2)
BEGIN
  SELECT RAISE(ABORT, 'USAGE_METERING_V2_REQUIRED');
END;

CREATE TRIGGER usage_report_sources_require_metering_v2_update
BEFORE UPDATE ON usage_report_sources
WHEN EXISTS (
  SELECT 1 FROM usage_metering_rollout
  WHERE singleton_id = 1 AND phase = 'v2_required'
) AND (NEW.source_id = '' OR NEW.protocol_version != 2)
BEGIN
  SELECT RAISE(ABORT, 'USAGE_METERING_V2_REQUIRED');
END;

-- Raw network logs are denied unless an operator grants one authenticated
-- device a short troubleshooting window. One row per device is naturally
-- bounded by the device table; expired rows remain inert audit state until the
-- device or user is deleted.
CREATE TABLE diagnostics_log_access (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX diagnostics_log_access_user
  ON diagnostics_log_access(user_id, expires_at);

-- Keep the account/device pair sound even for direct operator SQL.
CREATE TRIGGER diagnostics_log_access_device_owner_insert
BEFORE INSERT ON diagnostics_log_access
WHEN NOT EXISTS (
  SELECT 1 FROM devices
  WHERE devices.id = NEW.device_id AND devices.user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'DIAGNOSTICS_LOG_DEVICE_OWNER_MISMATCH');
END;

CREATE TRIGGER diagnostics_log_access_device_owner_update
BEFORE UPDATE ON diagnostics_log_access
WHEN NEW.device_id != OLD.device_id
  OR NEW.user_id != OLD.user_id
  OR NOT EXISTS (
    SELECT 1 FROM devices
    WHERE devices.id = NEW.device_id AND devices.user_id = NEW.user_id
  )
BEGIN
  SELECT RAISE(ABORT, 'DIAGNOSTICS_LOG_DEVICE_OWNER_MISMATCH');
END;
