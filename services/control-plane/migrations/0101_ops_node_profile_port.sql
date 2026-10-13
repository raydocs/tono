-- The node profile's documented `port` (api-contract.md PATCH nodes/{name}/profile,
-- NodeFactsDto.port) was validated and then discarded because the table had no
-- column for it; the node facts already read `ops_node_profiles.port`. Additive and
-- nullable: existing rows stay NULL ("not recorded"), as the console already shows.
ALTER TABLE ops_node_profiles ADD COLUMN port INTEGER
  CHECK(port IS NULL OR (port BETWEEN 1 AND 65535));
