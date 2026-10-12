-- Per UTC day, per client ASN, per control-plane path (`X-Tono-Path`): how
-- many stamped requests arrived on the path, and, from clients that also send
-- `X-Tono-Path-Failed` (decision 080), how many arrived and how many attempts
-- on the path failed first. Written only when recordClient stamps the device
-- row (path changed or the stamp is an hour old), so the five-minute catalog
-- poll adds no write. No IP, URL path, user or device id is stored.
--
-- `asn` 0 is unknown: a relayed or tunnelled request, or one from a known exit
-- ASN, arrives from a Tono node's address, so its edge ASN names the node.
-- `ok` / `fail` count reporting clients only; `arrived` counts everyone.
-- New table; nothing existing changes. 0096–0098 are reserved for other work.

CREATE TABLE IF NOT EXISTS ops_api_path_daily (
  day_at INTEGER NOT NULL,
  asn INTEGER NOT NULL DEFAULT 0 CHECK (asn >= 0),
  path TEXT NOT NULL
    CHECK (path IN ('pinned', 'system_dns', 'relay', 'doh', 'alt_port', 'tunnel')),
  as_org TEXT CHECK (as_org IS NULL OR length(as_org) <= 120),
  arrived INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  fail INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day_at, asn, path)
);
