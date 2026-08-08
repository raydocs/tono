-- Optional default (non-home) VPS proxy name for a bound user's client routing.
-- Lets a bound user's client split traffic: Claude traffic to the home exit,
-- everything else to this default proxy. NULL means no explicit default.

ALTER TABLE user_home_bindings ADD COLUMN default_proxy_name TEXT;
