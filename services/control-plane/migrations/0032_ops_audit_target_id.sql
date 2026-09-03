-- Two indexes for the same log, both about paging it.
--
-- A second is not a unique key: one PATCH can write two rows in it, so the log
-- pages on (at, id) and the tiebreaker has to be in the index or every page is
-- a full scan and a sort. (at DESC) is a prefix of the replacement, so nothing
-- that used it loses anything.
DROP INDEX ops_audit_at;
CREATE INDEX ops_audit_at_recent
  ON ops_audit(at DESC, id DESC);

-- Following one customer or one node back through the log is a filter on
-- `target_id` alone — the console never sends a target type — which the
-- composite index added in 0030 cannot serve: it leads with a column the query
-- does not constrain.
CREATE INDEX ops_audit_target_recent
  ON ops_audit(target_id, at DESC, id DESC);
