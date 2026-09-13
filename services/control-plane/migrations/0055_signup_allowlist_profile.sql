-- Pending WeChat / contact / notes captured at onboard, before the customer
-- registers. Copied onto users at first sign-in. Additive.

PRAGMA foreign_keys = ON;

ALTER TABLE signup_allowlist ADD COLUMN wechat_id TEXT;
ALTER TABLE signup_allowlist ADD COLUMN contact TEXT;
ALTER TABLE signup_allowlist ADD COLUMN notes TEXT;
