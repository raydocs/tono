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
-- rotation, pending expiry) inside that path's own batch.

ALTER TABLE exit_credentials ADD COLUMN retired_at INTEGER;

CREATE TRIGGER exit_credentials_retire_on_device_revoke
AFTER UPDATE OF status ON devices
WHEN NEW.status = 'revoked'
  AND OLD.status IN ('pending', 'active')
  AND EXISTS (
    SELECT 1 FROM exit_credentials
    WHERE user_id = NEW.user_id AND retired_at IS NULL
  )
BEGIN
  UPDATE exit_credentials SET retired_at = NEW.updated_at
  WHERE user_id = NEW.user_id AND retired_at IS NULL;
  UPDATE managed_exit_catalog SET revision = revision + 1, updated_at = NEW.updated_at
  WHERE singleton_id = 1;
  INSERT INTO device_actions(id, user_id, device_id, action, status, created_at, expires_at)
  SELECT lower(hex(randomblob(16))), user_id, id, 'refresh_catalog', 'pending',
         NEW.updated_at, NEW.updated_at + 300
  FROM devices
  WHERE user_id = NEW.user_id AND status IN ('pending', 'active');
END;
