-- hy2 auto-switch permission (backlog A18, owner decision D1-C).
--
-- A client may fall back from a node's VLESS Reality block to the ` · hy2`
-- block of the SAME node on its own only when this permits it; manual choice
-- of the hy2 block is unaffected. Nothing here changes catalog membership.
--
-- users.internal_account: ops-set, marks a Tono-internal account. D1-C turns
--   auto-switch on for these first. Default 0: no existing account becomes
--   internal by this migration.
-- users.hy2_auto_switch: per-account override. NULL follows the default
--   (global switch, else internal_account); 'on' / 'off' win over both.
-- hy2_auto_switch_settings.all_accounts: the global switch ("two weeks later,
--   everyone"), flipped by an operator, never by a timer. Seeded off; who
--   flipped it is on the ops_audit row.

PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN internal_account INTEGER NOT NULL DEFAULT 0
  CHECK(internal_account IN (0, 1));

ALTER TABLE users ADD COLUMN hy2_auto_switch TEXT
  CHECK(hy2_auto_switch IS NULL OR hy2_auto_switch IN ('on', 'off'));

CREATE TABLE hy2_auto_switch_settings (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
  all_accounts INTEGER NOT NULL DEFAULT 0 CHECK(all_accounts IN (0, 1)),
  updated_at INTEGER NOT NULL
);

INSERT INTO hy2_auto_switch_settings(singleton_id, all_accounts, updated_at)
VALUES (1, 0, 0);
