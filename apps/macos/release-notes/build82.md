# Tono 0.0.81 — qualification RC (build 82)

Manual-install test candidate that replaces the 0.0.80 RC (build 81), not stable acceptance. Production update feeds remain unchanged. Requires Apple Silicon and macOS 26.3+.

- **Fixed: when the chosen server does not answer, Tono now says so** (#1760). The message reads "This server did not answer. Pick another server and try again." and, while protection is blocked, the dashboard offers "Choose another route". The menu bar's Switch server is unchanged.
- **Fixed: two helper refusals showed only "the protected connection failed"** (#1760). If system DNS has not joined the protected path yet, the message now says to wait a moment and reconnect; if the connection engine quits right after starting, it says so and asks to connect again and send diagnostics if it repeats. The Devin macOS VM failure at "securing DNS" is the first of these.
- **Fixed: "traffic could not enter the tunnel" gave no clue** (#1760). The diagnostics now name which check failed (which probe sites, the controller, the mixed port); if another VPN is running at that moment, the message names it. Tono re-arms the tunnel at most three times per connection instead of indefinitely.
- **Faster answer when a connection fails, and faster automatic reconnects** (#1767). After the tunnel check fails, the advisory exit measurement now runs beside the final diagnostic instead of after it, up to 5 seconds sooner. While protection is down, Tono now tests all candidate servers at once instead of one after another, so an automatic reconnect starts up to 2.5 seconds per extra candidate sooner; the preferred server still wins when it answers.
- Everything in 0.0.80 is kept: Home lines given as a gateway name work in AI Home and Three-tier; the AI list has 194 entries; the network helper is 4.52.67.

## Install and required tests

Verify the published SHA-256 first. In the old Tono choose Restore internet, confirm ordinary browsing works, quit, then replace `/Applications/Tono.app` with the signed and notarized ZIP. Approve only the normal Tono helper installation. Do not delete the helper by hand or work around a protection or installation refusal; if Restore or helper approval fails, stop and contact support.

Test AI Home, Stable and Three-tier as for build 81. Also for this candidate: pick a server that is down and confirm the message offers another server and the dashboard shows "Choose another route"; with another VPN (such as a company VPN) connected, start Tono and confirm the failure names the other VPN; after a failed connect, read the diagnostics and confirm the TUN route line names the check that failed. Record the old and new versions, package digest, OS and results. Hosted CI is not installed-device acceptance.

## Known limits

- After the tunnel is locked, a dead server and a broken local tunnel still produce the same code; the ops side tells them apart by how many customers fail on the same node.
- The helper does not pass the connection engine's own log to the app, so "the engine stopped right after starting" carries the exit status only; send diagnostics for the rest.
- AI Home protects the listed AI services, not every AI service; ordinary traffic is not filtered. With another TUN such as Clash beside Tono, the conflict is still named only after a failure; there is no pre-connect check.
- The #1071/#1504 aborted-helper-upgrade AI hold risk remains separate, and #1643 is not included. The PF root UID/NIC scope is not PID isolation, and nothing guarantees the exit before the helper starts at boot.
- G1–G3, upgrades from older installs, real PF/DNS faults, Home second-hop identity and the fixed-candidate trial are not accepted yet. A failed candidate cannot be rolled back by installing the old version over it; ask support for a compatible recovery.
- Existing log preferences are kept; new installs upload network logs by default, which can be changed in Settings. Logs may contain domain and app names, never page contents or passwords.
