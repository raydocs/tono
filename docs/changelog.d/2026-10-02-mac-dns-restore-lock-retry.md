## 2026-10-02 · macOS retries a DNS restore the helper refused, so one lost lock race no longer blocks the release
- Ownership: SHIP_PLAN §2 item 10 (decision 031); macOS App release path (`REGLATE-MAC-DNS-LOCK`, [#1239](https://github.com/raydocs/tono/issues/1239)).
- Source: baseline `4da6e98c`; branch `fix/mac-dns-restore-lock-retry-1239`; PR in the fragment's continuation below; not yet merged.
- Defect fix: every Disconnect and automatic release restores DNS twice. Since #1144 the second, snapshotless restore always takes the network-preferences lock, and the helper refuses instead of waiting when another writer holds it (System Settings, another VPN client). The App did not retry, so `KillSwitchService.disarm` never sent the release and a non-strict Mac stayed blocked until the user retried or the helper watchdog released. `HelperManager.restoreProtectedDNS` now retries a helper refusal (`commandFailed`) up to three times, 300 ms apart. This is the retry the helper's own comment leaves to its caller.
- Kept: no helper change and no helper version bump. A restore that still fails after the retries blocks the release as before (DNS recovery stays an invariant of every PF release). Peer rejection (`forbidden`), transport failures and invalid replies are not retried.
- New/optimization: none.
- Engineering/tests: `HelperRefusalRetryTests.testHelperRefusalIsRetriedUntilTheRestoreSucceeds`. The retry helper is new, so the test cannot compile against the old code; it was not run there.
- Verification: no local `xcodebuild` on the MacBook; hosted macOS CI runs the XCTest.
- Candidate/publication: source only; no new candidate.
- Limits: needs-hardware (the lock race was not reproduced). A writer that holds the lock for longer than the retries (about 0.6 s) still blocks the release until the next attempt. A restore that fails for a lasting reason now takes about 0.6 s longer to report.
