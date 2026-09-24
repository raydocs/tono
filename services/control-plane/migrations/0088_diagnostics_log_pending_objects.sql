-- Write-ahead record for raw log uploads.
--
-- The upload writes the R2 object before its `diagnostics_log_objects` index
-- row, and retention only finds objects through that index. If the index
-- insert never lands (a D1 error, a cancelled request), nothing would point at
-- the object and it would be kept forever, in the one bucket holding
-- unredacted hostnames. The upload records the key here before writing the
-- object; the index insert clears it by trigger; the scheduled sweep deletes
-- the object for any row left behind.
CREATE TABLE diagnostics_log_pending_objects (
  r2_key TEXT PRIMARY KEY CHECK(length(r2_key) BETWEEN 1 AND 512),
  created_at INTEGER NOT NULL
);

CREATE INDEX diagnostics_log_pending_objects_age
  ON diagnostics_log_pending_objects(created_at);

-- One line: remote D1 migration ingestion cannot parse multiline trigger bodies.
CREATE TRIGGER diagnostics_log_objects_clear_pending AFTER INSERT ON diagnostics_log_objects BEGIN DELETE FROM diagnostics_log_pending_objects WHERE r2_key = NEW.r2_key; END;
