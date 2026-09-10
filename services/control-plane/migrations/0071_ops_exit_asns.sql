-- Known exit ASNs, auto-recorded from exit-agent requests' request.cf.asn.
-- Cloudflare reports the exit's hosting-provider ASN (a large cloud/transit
-- ASN shared with other customers), so a client uploading from the same ASN
-- is flagged edge_via_exit even if it did not traverse a Tono exit. That is
-- the grain of this table; we do not match as_org.
--
-- source='exit-agent' is written by recordExitAgentAsn. source='manual' is
-- reserved for a later admin route. loadKnownExitAsns caches the set for
-- five minutes per isolate, so a newly seen ASN is visible within 5 minutes
-- (and immediately in the isolate that recorded it).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ops_exit_asns (
  asn INTEGER PRIMARY KEY,
  as_org TEXT,
  node_hint TEXT,
  source TEXT NOT NULL CHECK(source IN ('exit-agent','manual')),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
