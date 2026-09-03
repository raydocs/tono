-- Speed up periodic session retention pruning in enforceAll
-- and clean up historical dead/revoked sessions.
CREATE INDEX IF NOT EXISTS sessions_retention
  ON sessions(revoked_at, expires_at);

-- One-time purge of historically abandoned sessions older than 7 days
DELETE FROM sessions
WHERE (revoked_at IS NOT NULL AND revoked_at <= strftime('%s', 'now') - 604800)
   OR (expires_at <= strftime('%s', 'now') - 604800);
