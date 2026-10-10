-- The transport path that carried the device's last control-plane request,
-- from the `X-Tono-Path: <kind>` header on sign-in, token refresh and catalog
-- fetch (`pinned`, `system_dns`, `relay`, `doh`, `alt_port`, `tunnel`). A
-- relayed request arrives from an exit node's address, so the edge ASN
-- describes the node; this column is the client's own word. Written when the
-- path changes or the stamp is an hour old, so the five-minute catalog poll
-- costs no row write otherwise. Additive; existing rows read NULL. Renumber at
-- merge if 0094 is taken by then.

ALTER TABLE devices ADD COLUMN client_path TEXT
  CHECK (client_path IS NULL OR (length(client_path) BETWEEN 1 AND 16));
ALTER TABLE devices ADD COLUMN client_path_at INTEGER;
