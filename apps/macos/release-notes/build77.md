# Tono 0.0.76 — customer-test candidate (build 77)

This is a new manual-install test candidate, not a stable release or a completed hardware qualification. Production automatic-update feeds are unchanged.

- Includes the merged independent Restore internet worker, Wi-Fi DHCP/neighbor-discovery recovery and current main's client/toolchain fixes. Held or design-blocked branches are not included.
- Requires Apple Silicon and macOS 26.3 or later. No Intel, iOS or Linux package is included.
- Download and verify the published SHA-256 before installation. In the old Tono, choose **Restore internet**, confirm ordinary internet works, then quit the app. Replace `/Applications/Tono.app` with this candidate and approve only the normal Tono helper installation request. Do not remove privileged helper files by hand or force-disarm unknown protection.
- This manual replacement is a test path, not proof of a protected automatic upgrade. If restoration, replacement or helper approval fails, stop and send the exact error to support; do not keep retrying while protection is unknown.
- Please test connection, Activity, disconnect/DNS restoration, hotspot-to-Wi-Fi changes, Restore internet followed by two minutes without relocking, restart and sleep/wake. Record the old version, candidate hash, OS and outcome.

## Known limits

- Hardware acceptance and old-version upgrades remain to be tested. The abandoned-helper-upgrade AI-hold issue [#1071](https://github.com/raydocs/tono/issues/1071) is not fixed by this version; do not treat a cancelled helper replacement as verified protection.
- Legacy system-proxy cleanup and emergency CLI recovery are not qualified by the new Restore internet worker.
- Existing logging preferences are retained; new installations upload network logs by default. Logs can contain hostnames and app names, not page contents or passwords; disable upload in Settings if desired.
- Do not downgrade over this candidate to recover a failed installation. Ask support for the appropriate recovery path.
