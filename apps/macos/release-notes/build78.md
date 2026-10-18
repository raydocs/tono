# Tono 0.0.77 — customer-test RC (build 78)

Manual-install test candidate, not stable acceptance. Production update feeds and the 0.0.76 RC remain unchanged. Requires Apple Silicon and macOS 26.3+.

- Adds the opt-in Three-tier mode in Settings. Stable remains the default. Save the next mode, then explicitly disconnect and reconnect; automatic recovery retains the current session mode and does not apply a newly saved choice.
- Priority: 21 cloud-video exceptions → existing 166 AI/named Home entries through cloud → assigned Home → explicit cloud list → other supported ordinary traffic DIRECT, including unclassified destinations. Recognized Home/cloud DNS or dial failures do not fall back DIRECT. Fixed DoH and fail-closed Core-death protection remain.
- Ordinary DIRECT supports public IPv4 TCP80/443 only. Application UDP/QUIC, IPv6, LAN and other ordinary ports are not supported. ECH, cached/raw IP or app DoH can hide AI identity and take default DIRECT; unidentified AI is not guaranteed Home routing. The Home group includes named non-AI services, not an exhaustive AI classifier.
- Fixes late DNS answers entering a known Home CIDR and automatic recovery consuming next-session settings. Preserves the previous Stable LAN preference while Three-tier disables LAN access. Mode/rule/cloud changes require an explicit disconnect/reconnect, not a hot switch.

## Installation and required tests

Verify the published SHA-256. In the old Tono choose **Restore internet**, confirm ordinary internet works, quit, then replace `/Applications/Tono.app` with the signed/notarized DMG or ZIP. Approve only the normal Tono helper request. Do not manually delete helpers or bypass a protection/installer refusal. If restore or helper approval fails, stop and contact support.

Test Stable first, then explicitly enable Three-tier: connection/Activity, actual DNS and cloud/Home/DIRECT egress, Home identity while changing cloud, failed Home/cloud requests, Core/helper death, restart, explicit restore, sleep/wake and Wi-Fi changes. Record old/new versions, package hash, OS and outcomes. Hosted CI is not installed-device acceptance.

## Known limits

- #1071/#1504 abandoned-helper-upgrade AI hold remains independent and unqualified; #1605/#1643 are not included. Do not treat interrupted helper replacement or protected automatic upgrade as verified. PF root-UID/NIC scope is not PID isolation; no pre-Helper boot-egress guarantee.
- G1–G3, old-client upgrades, actual PF/DNS faults, Home second-hop identity and a fixed-candidate trial remain unverified. Do not downgrade over this candidate for rollback; ask support for a compatible recovery path.
- Logging preferences are retained; fresh installs upload network logs by default, configurable in Settings. Logs can contain hostnames/app names, not page contents or passwords.
