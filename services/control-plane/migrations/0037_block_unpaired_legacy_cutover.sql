-- Legacy silence does not prove that named traffic has already been billed.
-- Keep existing v2 installations unchanged; prevent new lossy transitions.
CREATE TRIGGER usage_metering_rollout_requires_handoff
BEFORE UPDATE OF phase ON usage_metering_rollout
WHEN NEW.phase = 'v2_required' AND OLD.phase = 'dual' AND (
  OLD.legacy_last_seen_at > 0
  OR NEW.legacy_last_seen_at > 0
  OR EXISTS (SELECT 1 FROM usage_report_sources WHERE source_id = '')
)
BEGIN
  SELECT RAISE(ABORT, 'USAGE_METERING_ROLLOUT_NOT_READY');
END;
