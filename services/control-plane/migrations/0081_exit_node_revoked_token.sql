-- Retirement rotates an exit node's token so the node can never be re-enabled
-- with the old one. Keep that old hash, answer-only, so the control plane can
-- tell the still-running exit agent "this node is disabled" (403) instead of an
-- ambiguous 401 that it must treat as a transient failure. It never
-- authenticates anything.
ALTER TABLE exit_nodes ADD COLUMN revoked_token_hash TEXT
  CHECK(revoked_token_hash IS NULL OR length(revoked_token_hash) = 43);
