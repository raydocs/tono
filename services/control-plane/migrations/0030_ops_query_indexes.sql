-- Point lookups the console actually issues. Per-user product history and
-- per-target audit trails otherwise scan their whole tables: the events table
-- only had an (account_id, at) index and ops_audit only (at).
CREATE INDEX product_account_events_user
  ON product_account_events(user_id, at DESC);
CREATE INDEX ops_audit_target
  ON ops_audit(target_type, target_id, at DESC);
