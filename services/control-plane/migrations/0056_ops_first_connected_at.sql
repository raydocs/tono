-- First successful connect, filled on ingest going forward. Additive.

PRAGMA foreign_keys = ON;

ALTER TABLE ops_customer_status ADD COLUMN first_connected_at INTEGER;
