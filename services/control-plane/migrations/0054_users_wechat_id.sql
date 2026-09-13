-- WeChat id on each customer so the operator can reach them. Additive.

PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN wechat_id TEXT;
CREATE INDEX users_wechat_id ON users(wechat_id) WHERE wechat_id IS NOT NULL;
