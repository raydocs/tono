# Tono 0.0.71

This build focuses on connection stability and keeping each account's managed
server credentials isolated.

- Managed-server refreshes now run one at a time. An older response can no
  longer arrive late and replace newer routing or per-account credentials.
- A catalog update waits for active proxied traffic before applying, and an
  unchanged catalog is not reloaded. Routine fleet changes no longer close an
  in-progress request merely because the catalog revision changed.
- A cached catalog is tied to the account that received it and is removed on
  sign-out. A second person using the same Mac cannot inherit the previous
  account's server identity.
- A dead data plane gets one protected repair attempt instead of remaining in
  Recovering forever. If repair fails, the session ends clearly and can be
  retried.
- The network helper is 3.13.1. If a PF ruleset commits only partially, the
  next arm performs a conservative full state cleanup instead of trusting an
  unfinished generation. Existing installs will ask once for an administrator
  password to replace the helper.
- Changing language now waits for the old process to finish restoring DNS and
  firewall state before relaunching, and warns first when doing so would lower
  active protection.
- Unsigned managed policies can no longer route arbitrary public addresses
  outside the tunnel. Uploaded diagnostics also redact account names from
  process paths and no longer include exception text or raw return addresses.

The last verified catalog remains available during a temporary control-plane
failure; Tono does not fall back to an unprotected connection.
