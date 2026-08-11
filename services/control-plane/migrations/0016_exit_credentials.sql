-- Per-user exit credentials.
--
-- Until now every account received the same published catalog, so every account
-- presented the same VLESS identity at the exit. That is why no usage has ever
-- been recorded for anyone who does not reach the exit over Tailscale: the exit
-- can count bytes, but it cannot say whose. `enforceAll` has always been ready
-- to act on it — it selects users whose `usage_bytes` has passed `quota_bytes` —
-- and the number it reads was never going to arrive.
--
-- One row per user, one identity. Deleted with the user, because a credential
-- that outlives the account it belongs to is a credential nobody is watching.
-- Revocation is deleting the row and withdrawing the identity from the exits;
-- there is deliberately no `revoked_at`, so a revoked user who returns is issued
-- something new rather than resuming a credential that may have been shared.
PRAGMA foreign_keys = ON;

CREATE TABLE exit_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Canonical lowercase UUID, the form the proxy configuration expects. Unique
  -- across users: two accounts sharing one identity is the state this table
  -- exists to make impossible, so the database refuses it rather than trusting
  -- the code that writes here.
  client_uuid TEXT NOT NULL UNIQUE
    CHECK(length(client_uuid) = 36
      AND client_uuid NOT GLOB '*[^0-9a-f-]*'
      AND substr(client_uuid, 9, 1) = '-'
      AND substr(client_uuid, 14, 1) = '-'
      AND substr(client_uuid, 19, 1) = '-'
      AND substr(client_uuid, 24, 1) = '-'),
  created_at INTEGER NOT NULL
);
