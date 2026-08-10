-- Cloud-assigned residential home exit reached through a chained SOCKS5 upstream.
-- kind='catalog' keeps the existing behavior (the home exit is a node published in the
-- encrypted managed catalog). kind='socks5' carries full upstream credentials in this
-- table; they are served only inside the bound user's own catalog routing directive
-- (routing.homeSocks5) and never echoed back by any GET endpoint. The Windows client
-- dials the SOCKS5 upstream through the user's selected VPS node (mihomo dialer-proxy),
-- so no VPS-side change is required. Cross-field consistency (all four socks5_* columns
-- set iff kind='socks5') is enforced by the write paths.

ALTER TABLE home_exits ADD COLUMN kind TEXT NOT NULL DEFAULT 'catalog'
  CHECK(kind IN ('catalog', 'socks5'));

ALTER TABLE home_exits ADD COLUMN socks5_host TEXT
  CHECK(socks5_host IS NULL OR length(socks5_host) BETWEEN 1 AND 253);

ALTER TABLE home_exits ADD COLUMN socks5_port INTEGER
  CHECK(socks5_port IS NULL OR socks5_port BETWEEN 1 AND 65535);

ALTER TABLE home_exits ADD COLUMN socks5_username TEXT
  CHECK(socks5_username IS NULL OR length(socks5_username) BETWEEN 1 AND 255);

ALTER TABLE home_exits ADD COLUMN socks5_password TEXT
  CHECK(socks5_password IS NULL OR length(socks5_password) BETWEEN 1 AND 255);
