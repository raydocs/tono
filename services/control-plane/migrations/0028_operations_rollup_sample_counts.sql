-- Keep enough denominator information to combine five-minute averages into an
-- exact hourly average when collector buckets contain different sample counts.
-- Existing rows predate these counters; treating a non-null average as having
-- `samples` observations preserves their previous value without inventing a
-- more precise historical denominator.
--
-- The two writer columns are also a rollout fence. The Worker that predates
-- this migration omits them from its INSERT ... ON CONFLICT statements. SQLite
-- runs BEFORE INSERT triggers before choosing the UPSERT conflict branch, so
-- that writer receives an error before it can update a rollup or reach the
-- separate DELETE of its source rows. New code writes version 2 explicitly.

ALTER TABLE operations_agent_rollups ADD COLUMN cpu_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_agent_rollups ADD COLUMN mem_used_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_agent_rollups ADD COLUMN disk_used_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_agent_rollups ADD COLUMN load1_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_agent_rollups ADD COLUMN swap_used_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_agent_rollups ADD COLUMN tcp_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_agent_rollups ADD COLUMN rollup_writer_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE operations_agent_rollups ADD COLUMN sample_counts_exact INTEGER NOT NULL DEFAULT 0;

UPDATE operations_agent_rollups SET
  cpu_samples = CASE WHEN cpu_avg IS NULL THEN 0 ELSE samples END,
  mem_used_samples = CASE WHEN mem_used_avg IS NULL THEN 0 ELSE samples END,
  disk_used_samples = CASE WHEN disk_used_avg IS NULL THEN 0 ELSE samples END,
  load1_samples = CASE WHEN load1_avg IS NULL THEN 0 ELSE samples END,
  swap_used_samples = CASE WHEN swap_used_avg IS NULL THEN 0 ELSE samples END,
  tcp_samples = CASE WHEN tcp_avg IS NULL THEN 0 ELSE samples END;

CREATE TRIGGER operations_agent_rollups_require_writer_v2
BEFORE INSERT ON operations_agent_rollups
WHEN NEW.rollup_writer_version < 2
BEGIN
  SELECT RAISE(ABORT, 'operations_agent_rollups requires rollup writer v2');
END;
