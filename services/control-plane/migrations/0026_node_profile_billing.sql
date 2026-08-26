-- Complete the manually managed VPS billing profile. Komari remains a fallback
-- for fields an operator has not entered.
ALTER TABLE ops_node_profiles ADD COLUMN price REAL;
ALTER TABLE ops_node_profiles ADD COLUMN currency TEXT;
ALTER TABLE ops_node_profiles ADD COLUMN billing_cycle INTEGER;

