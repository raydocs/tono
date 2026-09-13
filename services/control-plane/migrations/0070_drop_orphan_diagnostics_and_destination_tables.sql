-- Production d1_migrations records five 0026–0030 names that never entered
-- git (applied 2026-08-20/21 from an uncommitted tree; the repo reused those
-- numbers for unrelated files). The leftover objects exist only in databases
-- restored from production dumps: four tables and eight indexes. Zero
-- triggers, zero views. 0030_destination_blocked_route created no new object
-- (inference: it rebuilt the two destination tables to widen route CHECK to
-- include 'blocked'). Indexes are dropped first, then tables. Dropping these
-- objects makes a schema-only rebuild from migrations/ produce the same
-- database as a dump restore. Production still holds rows in them (1 / 30 /
-- 1211 / 1229 on 2026-09-10); after this they survive only in older backups.

DROP INDEX IF EXISTS diagnostics_failure_index_recent;
DROP INDEX IF EXISTS diagnostics_failure_index_class_recent;
DROP INDEX IF EXISTS diagnostics_failure_index_server_recent;
DROP INDEX IF EXISTS diagnostics_log_failures_recent;
DROP INDEX IF EXISTS diagnostics_log_failures_class_recent;
DROP INDEX IF EXISTS diagnostics_log_failures_object;
DROP INDEX IF EXISTS destination_stats_recent;
DROP INDEX IF EXISTS destination_flow_stats_recent;
DROP TABLE IF EXISTS diagnostics_failure_index;
DROP TABLE IF EXISTS diagnostics_log_failures;
DROP TABLE IF EXISTS destination_stats;
DROP TABLE IF EXISTS destination_flow_stats;
