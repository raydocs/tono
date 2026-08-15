-- A billing figure that can be reset, without giving up the property the
-- ingest path depends on.
--
-- `usage_bytes` is written with MAX() and read in fourteen places to decide
-- whether an account is over quota. That made it monotonic with no way down:
-- once an account passed its quota it was suspended permanently, and no
-- endpoint could walk it back. Zeroing the column alone would not have worked
-- either — the collector holds a fleet-wide cumulative total and the next
-- report would raise it straight back.
--
-- So the monotonic counter moves to `usage_reported_bytes`, which is what the
-- collector's total lands in, and `usage_bytes` becomes the difference from a
-- baseline. Resetting a cycle sets the baseline to the counter. Every existing
-- read of `usage_bytes` keeps its meaning.
ALTER TABLE users ADD COLUMN usage_reported_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN usage_baseline_bytes INTEGER NOT NULL DEFAULT 0;

-- Existing rows already hold the collector's cumulative total, so seeding the
-- counter with it makes the first report after this land identically.
UPDATE users SET usage_reported_bytes = usage_bytes WHERE usage_bytes > 0;
