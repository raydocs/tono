-- The per-customer and per-node halves of a closed month, frozen at close.
--
-- `ops_month_close` already stores the four totals the operator signs off on;
-- everything under them — each customer's allocated cost, each node's ¥/GB,
-- and which of them were still unreconciled — was recomputed live on every
-- read, so metering that lands after the close silently rewrote a signed month.
-- This column holds that half as it stood at close.
--
-- NULL means "no snapshot": a month closed before this migration, or one whose
-- snapshot did not fit. Those months still answer, from live rows, and say so.

ALTER TABLE ops_month_close ADD COLUMN summary_json TEXT CHECK (summary_json IS NULL OR length(summary_json) <= 65536);
