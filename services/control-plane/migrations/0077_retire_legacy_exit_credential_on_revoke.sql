-- Revoking a device must revoke its exit access. During the dual rollout a
-- device may have been served the account-wide legacy UUID, and the control
-- plane does not know which one. The first revocation of any device of the
-- account therefore retires that shared credential for good.
--
-- It is retired, not rotated: exit agents key the legacy client by the label
-- `u:<userId>`, so a new UUID under the same label would never replace the
-- one Xray already holds. Dropping the label from the roster is what removes
-- it. Remaining devices move to their own per-device credential. The revision
-- bump lets clients that enforce revision monotonicity install the new UUID,
-- and refresh_catalog asks them to fetch it now rather than at the next poll.
--
-- A trigger covers every revocation path (explicit revoke, ops action, LRU
-- rotation, pending expiry) inside that path's own batch. The revision bump
-- and the refresh actions hang off the retirement itself, so the one-time
-- backfill below gets them too.
--
-- One statement per trigger, each on one line: remote D1 migration ingestion
-- cannot parse multiline trigger bodies (see 0015, 0021).

ALTER TABLE exit_credentials ADD COLUMN retired_at INTEGER;

CREATE TRIGGER exit_credentials_retire_on_device_revoke AFTER UPDATE OF status ON devices WHEN NEW.status = 'revoked' AND OLD.status IN ('pending', 'active') BEGIN UPDATE exit_credentials SET retired_at = NEW.updated_at WHERE user_id = NEW.user_id AND retired_at IS NULL; END;

CREATE TRIGGER exit_credentials_retired_bump_catalog AFTER UPDATE OF retired_at ON exit_credentials WHEN OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL BEGIN UPDATE managed_exit_catalog SET revision = revision + 1, updated_at = NEW.retired_at WHERE singleton_id = 1; END;

CREATE TRIGGER exit_credentials_retired_refresh_devices AFTER UPDATE OF retired_at ON exit_credentials WHEN OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL BEGIN INSERT INTO device_actions(id, user_id, device_id, action, status, created_at, expires_at) SELECT lower(hex(randomblob(16))), user_id, id, 'refresh_catalog', 'pending', NEW.retired_at, NEW.retired_at + 300 FROM devices WHERE user_id = NEW.user_id AND status IN ('pending', 'active'); END;

-- Revocations made before this migration never retired anything, so a device
-- revoked then may still hold the shared UUID. Any account with a revoked
-- device is retired now, whether or not it still has a live device: the
-- roster withholds the shared UUID only while the account has devices and
-- none are live, and it comes back the moment a new device signs in.
-- Idempotent (only rows not yet retired); the triggers above bump the
-- revision and queue refresh_catalog for the surviving devices.
UPDATE exit_credentials SET retired_at = unixepoch()
WHERE retired_at IS NULL
  AND user_id IN (SELECT user_id FROM devices WHERE status = 'revoked');
