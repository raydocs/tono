-- A rotated refresh session remembers when it was rotated and which session
-- replaced it. /auth/refresh uses this to recover a client whose rotation
-- response was lost in transit: one replay inside a short grace window, and
-- only while that successor is still live and has never itself been rotated.
ALTER TABLE sessions ADD COLUMN rotated_at INTEGER;
ALTER TABLE sessions ADD COLUMN successor_id TEXT;
