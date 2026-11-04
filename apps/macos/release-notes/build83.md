# Tono 0.0.82 — qualification RC (build 83)

Manual-install test candidate that replaces the 0.0.80 RC (build 81), not stable acceptance. Build 82 (0.0.81) was built but never handed out, so everything in it is listed here too. Production update feeds remain unchanged. Requires Apple Silicon and macOS 26.3+.

New since build 82:

- **Fixed: Stable, Three-tier and AI Home could let some traffic around the tunnel** (#1820). Desktop routing now carries the same anti-leak rules as the mobile apps: DNS-over-TLS (port 853), STUN including IPv6, overseas UDP, DNS HTTPS/SVCB lookups, the Home helper domains and X's domains (`grok.x.com` still goes through Home). In AI Home each Home TCP route is paired with its UDP block. The network helper moves to 4.52.69 to carry these rules; an older helper keeps the previous rules until it is updated.
- **Fixed: a failed hy2 connection skipped the same server's other transport** (#1797). When an `X · hy2` dial fails for a reason other than QUIC or sign-in, Tono now tries X's own Reality block first, as on Windows.
- **Less redrawing when idle** (#1798). The connection card only ticks every second while a timer or retry countdown is shown.

Also in this build, from build 82 (#1760, #1767):

- When the chosen server does not answer, the message says so and the dashboard offers "Choose another route".
- Two helper refusals now explain themselves: system DNS not yet on the protected path (wait and reconnect), and the connection engine quitting right after start (connect again, send diagnostics if it repeats).
- "Traffic could not enter the tunnel" names the check that failed and any other VPN running; the tunnel is re-armed at most three times per connection.
- A failed connect reports up to 5 seconds sooner, and automatic reconnects test all candidate servers at once; the preferred server still wins when it answers.
- Everything in 0.0.80 is kept: Home lines given as a gateway name work in AI Home and Three-tier; the AI list has 194 entries.

## Install and required tests

Verify the published SHA-256 first. In the old Tono choose Restore internet, confirm ordinary browsing works, quit, then replace `/Applications/Tono.app` with the signed and notarized ZIP. Approve only the normal Tono helper installation (this build updates the helper to 4.52.69). Do not delete the helper by hand or work around a protection or installation refusal; if Restore or helper approval fails, stop and contact support.

Test AI Home, Stable and Three-tier as for build 81. Also for this candidate: confirm the helper reports 4.52.69 after install; in each mode run a WebRTC/STUN leak test and a DoT (853) lookup and confirm neither shows your local IP or resolver, and that `grok.x.com` still exits through Home; with an `X · hy2` server whose UDP is blocked, confirm Tono stays on X over Reality instead of moving to another server. Carry over the build 82 items: a down server offers another server and "Choose another route"; another VPN is named on failure; the diagnostics' TUN route line names the failed check. Record the old and new versions, package digest, OS and results. Hosted CI is not installed-device acceptance.

## Known limits

- The anti-leak rules (#1820) match the mobile contract in code; they have not been measured on a real Mac. The four live exits' Reality/TCP settings are only pinned in the repository, not re-measured.
- After the tunnel is locked, a dead server and a broken local tunnel still produce the same code; the ops side tells them apart by how many customers fail on the same node.
- The helper does not pass the connection engine's own log to the app, so "the engine stopped right after starting" carries the exit status only; send diagnostics for the rest.
- AI Home protects the listed AI services, not every AI service; ordinary traffic is not filtered. With another TUN such as Clash beside Tono, the conflict is still named only after a failure; there is no pre-connect check.
- The #1071/#1504 aborted-helper-upgrade AI hold risk remains separate, and #1643 is not included. The PF root UID/NIC scope is not PID isolation, and nothing guarantees the exit before the helper starts at boot.
- G1–G3, upgrades from older installs, real PF/DNS faults, Home second-hop identity and the fixed-candidate trial are not accepted yet. A failed candidate cannot be rolled back by installing the old version over it; ask support for a compatible recovery.
- Existing log preferences are kept; new installs upload network logs by default, which can be changed in Settings. Logs may contain domain and app names, never page contents or passwords.
