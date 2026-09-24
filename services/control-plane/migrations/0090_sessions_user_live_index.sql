-- The cron enforcement scan asks, per ineligible user, whether any session is
-- still unrevoked. Without an index on user_id that lookup scans the whole
-- sessions table once per candidate user every five minutes.
CREATE INDEX IF NOT EXISTS sessions_user_revoked ON sessions(user_id, revoked_at);
