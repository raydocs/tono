-- Expiry and plan an operator sets at onboard, before the customer registers.
-- Copied onto users at first sign-in, like 0055's wechat/contact/notes, so a
-- customer is never created without the expiry the operator entered. Additive.

PRAGMA foreign_keys = ON;

ALTER TABLE signup_allowlist ADD COLUMN expires_at INTEGER;
ALTER TABLE signup_allowlist ADD COLUMN plan TEXT;
