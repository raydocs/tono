-- A permanently failing batch must not monopolize every scheduled drain.
ALTER TABLE revocation_jobs ADD COLUMN last_attempt_at INTEGER NOT NULL DEFAULT 0;
DROP INDEX revocation_jobs_pending;
CREATE INDEX revocation_jobs_pending
  ON revocation_jobs(completed_at, last_attempt_at, created_at, id);
