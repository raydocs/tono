-- Continuous network-log ingest for the test programme.
--
-- Distinct from `diagnostics_reports`, which is a 16 KiB redacted snapshot the
-- user reads a code out for. These rows index raw audit-log segments — the same
-- JSONL the Support page reveals, carrying hostnames, process paths, rules and
-- routes — uploaded on a timer while the client runs. The payload lives in R2
-- because it is megabytes per hour per device and the whole D1 database is
-- single-digit megabytes; only the index is here.
--
-- This is a short-lived troubleshooting artifact, not an account record. The
-- scheduled cleanup deletes rows past retention and the R2 objects with them,
-- and deleting a user removes their index rows. Nothing rewrites a row.
PRAGMA foreign_keys = ON;

CREATE TABLE diagnostics_log_objects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Nullable: the access token carries a device only after enrolment, and a
  -- segment uploaded before that is still worth keeping.
  device_id TEXT,
  -- Client-side run identifier. Segments of one run share it, so triage can
  -- reassemble a session in sequence order without guessing from timestamps.
  session_id TEXT NOT NULL CHECK(length(session_id) BETWEEN 1 AND 64),
  -- Monotonic within a session, starting at 0. The UNIQUE constraint below is
  -- what makes a retried upload idempotent instead of duplicating a segment.
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  r2_key TEXT NOT NULL UNIQUE CHECK(length(r2_key) BETWEEN 1 AND 512),
  -- Size of the stored gzip object, not of the decompressed text. Bounded by
  -- the Worker before the object is written; this is the storage backstop.
  byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 2097152),
  -- Advisory count the client reports for its own segment. Never trusted for
  -- anything but display, so it carries no relationship to `byte_size`.
  line_count INTEGER NOT NULL CHECK(line_count >= 0),
  received_at INTEGER NOT NULL,
  client_version TEXT NOT NULL CHECK(length(client_version) BETWEEN 1 AND 40),
  os_version TEXT NOT NULL CHECK(length(os_version) BETWEEN 1 AND 80),
  UNIQUE(user_id, session_id, sequence)
);

CREATE INDEX diagnostics_log_objects_user_recent
  ON diagnostics_log_objects(user_id, received_at DESC);
CREATE INDEX diagnostics_log_objects_retention
  ON diagnostics_log_objects(received_at);

-- Same posture as 0006 and 0015: an accepted segment is immutable evidence.
-- Retention deletes; nothing rewrites. Keep the compound statement on one line
-- because remote D1 migration ingestion cannot parse multiline trigger bodies.
CREATE TRIGGER diagnostics_log_objects_immutable_update BEFORE UPDATE ON diagnostics_log_objects BEGIN SELECT RAISE(ABORT, 'DIAGNOSTICS_LOG_IMMUTABLE'); END;
