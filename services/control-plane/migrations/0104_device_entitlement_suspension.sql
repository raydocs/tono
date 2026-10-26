-- Network credentials are still revoked on expiry/quota exhaustion. Keep the
-- account session distinct from explicit device/credential revocation.
ALTER TABLE devices ADD COLUMN entitlement_suspended INTEGER NOT NULL DEFAULT 0
  CHECK (entitlement_suspended IN (0, 1));
