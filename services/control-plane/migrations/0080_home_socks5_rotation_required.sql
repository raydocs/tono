-- A kind='socks5' home exit carries its upstream username/password inside the
-- bound user's catalog. Removing the binding stops serving it, but the copy
-- already on that user's devices keeps working against the upstream until
-- the upstream password changes. Record that exposure on the home exit itself
-- so every binding-removal path (unbind, rebind, account close, cascade on
-- user delete) and every account disable marks it, and refuse to hand the
-- same credential to a different user until an operator stores a new one.

ALTER TABLE home_exits ADD COLUMN socks5_rotation_required_at INTEGER;

CREATE TRIGGER home_socks5_rotation_on_unbind
AFTER DELETE ON user_home_bindings
BEGIN
  UPDATE home_exits
  SET socks5_rotation_required_at = COALESCE(socks5_rotation_required_at, CAST(strftime('%s', 'now') AS INTEGER))
  WHERE id = OLD.home_exit_id AND kind = 'socks5';
END;

CREATE TRIGGER home_socks5_rotation_on_rebind
AFTER UPDATE OF home_exit_id ON user_home_bindings
WHEN NEW.home_exit_id <> OLD.home_exit_id
BEGIN
  UPDATE home_exits
  SET socks5_rotation_required_at = COALESCE(socks5_rotation_required_at, CAST(strftime('%s', 'now') AS INTEGER))
  WHERE id = OLD.home_exit_id AND kind = 'socks5';
END;

CREATE TRIGGER home_socks5_rotation_on_user_disable
AFTER UPDATE OF status ON users
WHEN OLD.status = 'active' AND NEW.status <> 'active'
BEGIN
  UPDATE home_exits
  SET socks5_rotation_required_at = COALESCE(socks5_rotation_required_at, CAST(strftime('%s', 'now') AS INTEGER))
  WHERE kind = 'socks5'
    AND id IN (SELECT home_exit_id FROM user_home_bindings WHERE user_id = NEW.id);
END;

-- Backstop for any write path that skips the API check: a flagged credential
-- cannot move to a new binding.
CREATE TRIGGER home_socks5_rotation_blocks_bind
BEFORE INSERT ON user_home_bindings
WHEN EXISTS (
  SELECT 1 FROM home_exits
  WHERE id = NEW.home_exit_id AND kind = 'socks5' AND socks5_rotation_required_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'SOCKS5_ROTATION_REQUIRED');
END;

CREATE TRIGGER home_socks5_rotation_blocks_rebind
BEFORE UPDATE OF home_exit_id ON user_home_bindings
WHEN NEW.home_exit_id <> OLD.home_exit_id AND EXISTS (
  SELECT 1 FROM home_exits
  WHERE id = NEW.home_exit_id AND kind = 'socks5' AND socks5_rotation_required_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'SOCKS5_ROTATION_REQUIRED');
END;
