# Tono 0.0.79 — qualification RC (build 80)

Manual-install test candidate for installed-device qualification of AI Home, not stable acceptance. Production update feeds and the 0.0.78 RC remain unchanged. Requires Apple Silicon and macOS 26.3+.

- **AI Home routing mode, now the default for a Mac that never saved a mode** (#1692–#1695). AI services go through the account's Home line with Home DNS and fail closed: if the Home line or cloud hop is down, AI traffic is refused rather than leaking. Everything else goes DIRECT with UDP, LAN and mDNS, and is never locked by quit, failure or a dead Core. An account without a Home line connects in Stable for that session. A saved choice (Stable, Three-tier or AI Home) is kept, and a session already in progress keeps its mode across restart. The network helper moves to 4.52.61.
- Restore internet no longer gets stuck reporting an earlier restore as unfinished: the helper's process check read unreaped zombies and processes whose executable was replaced as "unknown" and kept refusing Connect (#1691, REL-ZOMBIE-UNIDENTIFIED).
- When another program holds a port Tono's core needs (most often Docker's or dnsmasq's resolver on 127.0.0.1:53), Connect now names the port and the program instead of "the protected connection failed", and Tono does not retry by itself (#1698).
- China Mobile Cloud (10086.cn, cmecloud.cn) and the MIIT filing site (miit.gov.cn) go DIRECT (#1696).
- An identical connect failure is reported once per ten minutes, so a retry loop no longer exhausts the failure-report budget (HTTP 429) (#1699).

## Installation and required tests

Verify the published SHA-256. In the old Tono choose **Restore internet**, confirm ordinary internet works, quit, then replace `/Applications/Tono.app` with the signed/notarized DMG or ZIP. Approve only the normal Tono helper request. Do not manually delete helpers or bypass a protection/installer refusal. If restore or helper approval fails, stop and contact support.

AI Home (decision 131): AI via Home (exit IP and DNS) and refused when Home or cloud is down; ordinary TCP/UDP, LAN and mDNS DIRECT; quit, Core kill and sleep/wake leave ordinary traffic online with AI held; Restore internet clears everything; captive portal and a company VPN beside Tono. Then Stable and Three-tier as before. Also: Connect with Docker (or another resolver) on port 53 names it and does not retry; Restore internet then Connect does not loop. Record old/new versions, package hash, OS and outcomes. Hosted CI is not installed-device acceptance.

## Known limits

- AI Home's protected scope is the reviewed AI list, not every AI service; ordinary traffic is not filtered. Clash or another TUN beside Tono is still only named after a failure, not checked before Connect.
- #1071/#1504 abandoned-helper-upgrade AI hold remains independent and unqualified; #1643 is not included. PF root-UID/NIC scope is not PID isolation; no pre-Helper boot-egress guarantee.
- G1–G3, old-client upgrades, actual PF/DNS faults, Home second-hop identity and a fixed-candidate trial remain unverified. Do not downgrade over this candidate for rollback; ask support for a compatible recovery path.
- Logging preferences are retained; fresh installs upload network logs by default, configurable in Settings. Logs can contain hostnames/app names, not page contents or passwords.
