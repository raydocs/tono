# Tono 0.0.78 — customer-test RC (build 79)

Manual-install test candidate, not stable acceptance. Production update feeds and the 0.0.77 RC remain unchanged. Requires Apple Silicon and macOS 26.3+.

- The bundled sing-box core moves from v1.15.0-alpha.9 to v1.15.0-alpha.12 (sing-tun 0.9.7, hysteria2 no longer forces UDP fragmentation, FakeIP storage and DNS-reset fixes). Route-rule behaviour is unchanged. No other macOS app change since 0.0.77.
- Everything in 0.0.77 is retained: Stable remains the default; opt-in Three-tier is applied only after an explicit disconnect/reconnect; ordinary DIRECT stays public IPv4 TCP80/443 only.

## Installation and required tests

Verify the published SHA-256. In the old Tono choose **Restore internet**, confirm ordinary internet works, quit, then replace `/Applications/Tono.app` with the signed/notarized DMG or ZIP. Approve only the normal Tono helper request. Do not manually delete helpers or bypass a protection/installer refusal. If restore or helper approval fails, stop and contact support.

Test Stable first, then explicitly enable Three-tier: connection/Activity, actual DNS and cloud/Home/DIRECT egress, Home identity while changing cloud, failed Home/cloud requests, Core/helper death, restart, explicit restore, sleep/wake and Wi-Fi changes. Record old/new versions, package hash, OS and outcomes. Hosted CI is not installed-device acceptance.

## Known limits

- #1071/#1504 abandoned-helper-upgrade AI hold remains independent and unqualified; #1643 is not included. Do not treat interrupted helper replacement or protected automatic upgrade as verified. PF root-UID/NIC scope is not PID isolation; no pre-Helper boot-egress guarantee.
- G1–G3, old-client upgrades, actual PF/DNS faults, Home second-hop identity and a fixed-candidate trial remain unverified. Do not downgrade over this candidate for rollback; ask support for a compatible recovery path.
- Logging preferences are retained; fresh installs upload network logs by default, configurable in Settings. Logs can contain hostnames/app names, not page contents or passwords.
