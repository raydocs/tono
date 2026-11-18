# Tono 0.0.83 — qualification RC (build 84)

Manual-install test candidate that replaces the 0.0.82 RC (build 83), not stable acceptance. Production update feeds remain unchanged. Requires Apple Silicon and macOS 26.3+.

New since build 83:

- **Fixed: sign-in could fail with "cannot reach any relay"** (#1836). Tono's relay list is now two addresses, Westwood on its new IP and Mesa; the blocked Westwood address and the Arosscloud relay are gone. Without a running tunnel (first sign-in, re-login, token refresh) Tono reaches the control plane only through these relays, so a network that blocked the old Westwood address and could not reach Mesa had no way in. The network helper moves to 4.52.71 to permit the new relay address; an older helper keeps permitting the old one until it is updated.
- Everything in 0.0.82 is kept.

## Install and required tests

Verify the published SHA-256 first. In the old Tono choose Restore internet, confirm ordinary browsing works, quit, then replace `/Applications/Tono.app` with the signed and notarized ZIP. Approve only the normal Tono helper installation (this build updates the helper to 4.52.71). Do not delete the helper by hand or work around a protection or installation refusal; if Restore or helper approval fails, stop and contact support.

Confirm the helper reports 4.52.71. On a network where the old build said it could not reach a relay, sign out and sign in again with Tono not connected, and confirm sign-in succeeds. Then repeat the build 83 checks (AI Home, Stable, Three-tier, anti-leak). Record the old and new versions, package digest, OS and results. Hosted CI is not installed-device acceptance.

## Known limits

- Without a tunnel, sign-in still uses the two relays only; if neither is reachable from a network, sign-in fails (decision 091). Older installs keep the blocked address until updated, so a customer who cannot sign in needs this build installed by hand or another network (a phone hotspot) for the first sign-in.
- The limits of 0.0.82 still apply: anti-leak rules not measured on a real Mac; G1–G3, upgrades from older installs and real PF/DNS faults are not accepted. A failed candidate cannot be rolled back by installing the old version over it; ask support for a compatible recovery.
