-- Per-user home/residential exit binding for catalog filtering.
-- Global managed_exit_catalog remains the encrypted credential authority.
-- Home exits are identified by exact Clash proxy names published in that catalog.
-- Shared (non-home) proxies remain visible to every authenticated user.
-- Home proxies are only included in a user's GET /exit-catalog when bound.

CREATE TABLE home_exits (
  id TEXT PRIMARY KEY,
  proxy_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  egress_ipv4 TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'disabled', 'retired')),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(length(proxy_name) BETWEEN 1 AND 200),
  CHECK(length(display_name) BETWEEN 1 AND 200),
  CHECK(egress_ipv4 IS NULL OR length(egress_ipv4) BETWEEN 7 AND 45),
  CHECK(notes IS NULL OR length(notes) <= 1000)
);

CREATE UNIQUE INDEX home_exits_proxy_name_unique
  ON home_exits(proxy_name);

CREATE INDEX home_exits_status_updated
  ON home_exits(status, updated_at DESC);

-- One home exit per user (一人一家庭 IP).
CREATE TABLE user_home_bindings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  home_exit_id TEXT NOT NULL REFERENCES home_exits(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX user_home_bindings_home_exit
  ON user_home_bindings(home_exit_id);
