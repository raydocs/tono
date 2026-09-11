-- Immutable node identity plus the two profile facts that outlive a rename:
-- failure domain (same merchant / DC / upstream) and which machine this one
-- replaced. catalog_name / node_name stay the join key on every other table.

CREATE TABLE ops_node_identity (
  node_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  first_seen_at INTEGER NOT NULL,
  retired_at INTEGER
);

ALTER TABLE ops_node_profiles ADD COLUMN failure_domain TEXT;
ALTER TABLE ops_node_profiles ADD COLUMN replaces TEXT;

INSERT OR IGNORE INTO ops_node_identity
SELECT lower(hex(randomblob(8))), catalog_name, NULL, COALESCE(created_at, strftime('%s','now')), CASE WHEN status='retired' THEN updated_at END FROM ops_node_profiles;
