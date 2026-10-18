-- The latest egress lookup per home line: the address the Worker saw through
-- the line's own SOCKS5 credential, and each keyless geolocation service's
-- answer for it (JSON array, src/home-egress.ts GeoAnswer). One row per line,
-- replaced on every lookup; no history. No foreign key: a deleted line's row is
-- an orphan the read joins away, the same as the home-line usage rows.
CREATE TABLE home_exit_egress (
  home_exit_id TEXT PRIMARY KEY,
  ip TEXT,
  checked_at INTEGER NOT NULL,
  error_stage TEXT,
  error TEXT,
  answers TEXT NOT NULL DEFAULT '[]'
);
