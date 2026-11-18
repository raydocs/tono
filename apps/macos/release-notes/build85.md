# Tono 0.0.84 — qualification RC (build 85)

Manual-install test candidate that replaces the 0.0.83 RC (build 84), not stable acceptance. Production update feeds remain unchanged. Requires Apple Silicon and macOS 26.3+.

New since build 84:

- **Fixed: sign-in still failed on a network that resets the TLS name `api.afk.ccwu.cc`** (#1838, #1839). On such a network the TCP connection to the relays succeeded but the handshake was reset by name. Over the relays Tono now dials the control plane as `static.bicon.dev`, a name served by the same API and admitted by both relays. Only the relay path changes: a running tunnel, a pinned address and the update download keep their hosts, and the network helper is unchanged (it permits relays by address and port).
- Everything in 0.0.83 is kept.

## Install and required tests

Verify the published SHA-256 first. In the old Tono choose Restore internet, confirm ordinary browsing works, quit, then replace `/Applications/Tono.app` with the signed and notarized ZIP. Do not delete the helper by hand or work around a protection or installation refusal; if Restore or helper approval fails, stop and contact support.

On the network where build 84 said it could not reach a relay, sign out and sign in again with Tono not connected, and confirm sign-in succeeds. Then repeat the build 84 checks. Record the old and new versions, package digest, OS and results. Hosted CI is not installed-device acceptance.

## Known limits

- Without a tunnel, sign-in still uses the two relays only (decision 091). A network that also blocks `static.bicon.dev` would need another name; older installs, including build 84, keep the old name, so a customer who cannot sign in needs this build installed by hand or another network (a phone hotspot) for the first sign-in.
- The update check and download still use `releases.afk.ccwu.cc`.
- The limits of 0.0.83 still apply; G1–G3, upgrades from older installs and real PF/DNS faults are not accepted. A failed candidate cannot be rolled back by installing the old version over it; ask support for a compatible recovery.
