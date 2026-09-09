-- 0048's ops_cron_state is only (key, ran_at), which cannot hold the last
-- OpsCronReport. payload is JSON, capped at 4 KiB, for key 'last_report'.
ALTER TABLE ops_cron_state ADD COLUMN payload TEXT
  CHECK(payload IS NULL OR length(payload) <= 4096);
