-- Metering moved from one collector to one meter per exit, and MAX() cannot add.
--
-- `usage_reported_bytes` was folded with MAX() over every report, which was
-- right while a single collector held SSH to every node and reported one
-- fleet-wide total per account. With a meter on each exit reporting its own
-- node-local counter, MAX() bills the largest exit instead of the sum: an
-- account spread over three of them was counted at roughly a third, so quota
-- enforcement never fired.
--
-- Each reporter now names itself and keeps its own cumulative figure, and an
-- account's counter is the SUM of them.
ALTER TABLE usage_reports ADD COLUMN source_id TEXT NOT NULL DEFAULT '';

CREATE TABLE usage_report_sources (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  -- The last cumulative figure this source reported, and everything it has
  -- contributed. The two differ once a node is rebuilt: its counter starts again
  -- from zero and the pre-reset amount is carried in `accumulated_bytes`, so a
  -- rebuild neither forgives what was used nor waits for the counter to climb
  -- back past where it was.
  last_total_bytes INTEGER NOT NULL CHECK(last_total_bytes >= 0),
  accumulated_bytes INTEGER NOT NULL CHECK(accumulated_bytes >= 0),
  observed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, source_id)
);

-- A report that names no source lands in this one, which keeps the contract it
-- was written against: MAX, never carried forward. The collector's figure is an
-- aggregate over a changing set of nodes, so it falls when a node leaves the
-- fleet — reading that fall as a counter reset would bill the account twice.
--
-- Existing accounts already carry the collector's cumulative total, so seeding
-- the legacy source with it makes the first report after this land exactly where
-- the last one did instead of adding the whole figure again.
INSERT INTO usage_report_sources(
  user_id, source_id, last_total_bytes, accumulated_bytes, observed_at, updated_at
)
SELECT id, '', usage_reported_bytes, usage_reported_bytes, 0, updated_at
FROM users
WHERE usage_reported_bytes > 0;

-- A report id stays an immutable idempotency key, now including the source it
-- was reported for: the same id under a different source would otherwise be
-- kept, silently, as the row that was already there.
DROP TRIGGER usage_reports_immutable_insert;
CREATE TRIGGER usage_reports_immutable_insert
BEFORE INSERT ON usage_reports
WHEN EXISTS (
  SELECT 1
  FROM usage_reports
  WHERE report_id = NEW.report_id
    AND (
      user_id != NEW.user_id
      OR source_id != NEW.source_id
      OR total_bytes != NEW.total_bytes
      OR observed_at != NEW.observed_at
    )
)
BEGIN
  SELECT RAISE(ABORT, 'USAGE_REPORT_CONFLICT');
END;
