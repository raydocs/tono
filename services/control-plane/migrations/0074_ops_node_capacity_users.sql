-- How many customers this machine is sold as holding. Optional: the 可售验收
-- 容量 line stays unknown until somebody types a number.

ALTER TABLE ops_node_profiles ADD COLUMN capacity_users INTEGER;
