-- Client release registry and daily version-adoption rollup.
-- Artefacts stay in R2; this is the operator catalogue plus the fleet mix
-- derived from telemetry_windows (os_version / client_version).

CREATE TABLE client_releases (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK(platform IN ('windows','macos','linux','android','ios')),
  channel TEXT NOT NULL CHECK(channel IN ('stable','beta','internal')),
  version TEXT NOT NULL CHECK(length(version) BETWEEN 1 AND 40),
  build TEXT, r2_key TEXT, size_bytes INTEGER, sha256 TEXT,
  notes TEXT CHECK(notes IS NULL OR length(notes) <= 4000),
  min_supported_version TEXT, published_at INTEGER, yanked_at INTEGER, yank_reason TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX client_releases_unique  ON client_releases(platform, channel, version);
CREATE INDEX client_releases_current ON client_releases(platform, channel, published_at DESC);
CREATE TABLE ops_client_version_daily (
  day_at INTEGER NOT NULL, platform TEXT NOT NULL, app_version TEXT NOT NULL,
  devices INTEGER NOT NULL, users INTEGER NOT NULL,
  PRIMARY KEY (day_at, platform, app_version)
);
CREATE INDEX ops_client_version_daily_day ON ops_client_version_daily(day_at DESC);
