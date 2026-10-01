## 2026-09-30 · Stop reconnecting healthy quiet macOS log streams
- Ownership: SHIP_PLAN §2 item 10; macOS Core WebSocket reliability.
- Source: baseline `262b1864`; branch `hunt/sol-r3probe-quiet-logs`, pending PR; source only, not yet merged.
- Bug fix: remove the quiet-log Pong deadline, which pinned sing-box cannot satisfy. Avoid false stalls and accumulating abandoned Core log subscriptions. Finding: MAC-LOGS-PONG-UNSUPPORTED (P2).
- Added/optimized: none. Traffic/connections watchdogs and log receive-error/runtime-change reconnects retain their behavior.
- Engineering/tests: one narrow XCTest exercises the real watchdog with a controlled clock before asynchronous callbacks can interleave.
- Verification: Linux loopback-only official sing-box v1.15.0-alpha.3 at pinned source `93fff595` reproduced 12 successful log subscriptions, zero Pongs, healthy controller replies and descriptors increasing from 8 to 20 after client closes. This is a different binary build from Tono. `git diff --check` passed; Swift compilation/XCTest not run here, awaiting hosted macOS CI.
- Candidate/publication: source only; no new candidate, package, deployment or publication.
- Remaining limits: quiet logs provide no passive liveness signal; receive errors and explicit runtime restart still recover them. No claim of native macOS acceptance. Protection and network policy are unaffected.
