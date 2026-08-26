-- Keep enough denominator information to combine five-minute averages into an
-- exact hourly average when collector buckets contain different sample counts.
-- Existing rows predate these counters; treating a non-null average as having
-- `samples` observations preserves their previous value without inventing a
-- more precise historical denominator.

ALTER TABLE operations_agent_rollups ADD COLUMN cpu_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_agent_rollups ADD COLUMN mem_used_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_agent_rollups ADD COLUMN disk_used_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_agent_rollups ADD COLUMN load1_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_agent_rollups ADD COLUMN swap_used_samples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_agent_rollups ADD COLUMN tcp_samples INTEGER NOT NULL DEFAULT 0;

UPDATE operations_agent_rollups SET
  cpu_samples = CASE WHEN cpu_avg IS NULL THEN 0 ELSE samples END,
  mem_used_samples = CASE WHEN mem_used_avg IS NULL THEN 0 ELSE samples END,
  disk_used_samples = CASE WHEN disk_used_avg IS NULL THEN 0 ELSE samples END,
  load1_samples = CASE WHEN load1_avg IS NULL THEN 0 ELSE samples END,
  swap_used_samples = CASE WHEN swap_used_avg IS NULL THEN 0 ELSE samples END,
  tcp_samples = CASE WHEN tcp_avg IS NULL THEN 0 ELSE samples END;
