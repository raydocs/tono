-- A release row now has to be backed by the object the updater will download.
--
-- The four columns are the evidence: the signature the updater checks, the
-- lowest OS the build installs on, when the bucket object was last confirmed to
-- match the declared size and digest, and the etag it had when it was. All four
-- are nullable because the rows already in the table were registered before any
-- of it was asked for; `createRelease` accepts them optionally, and `publish`
-- refuses a row that was never verified — which is the honest way to treat history
-- without pretending it was checked.
ALTER TABLE client_releases ADD COLUMN signature TEXT;
ALTER TABLE client_releases ADD COLUMN min_os_version TEXT;
ALTER TABLE client_releases ADD COLUMN verified_at INTEGER;
ALTER TABLE client_releases ADD COLUMN object_etag TEXT;
