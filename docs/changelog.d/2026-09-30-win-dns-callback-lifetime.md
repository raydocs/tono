## 2026-09-30 · Windows DNS callback lifetime
- Ownership: SHIP_PLAN §2 item 10; Windows system-DNS verification memory safety.
- Source: main `7d525e6c` → branch `hunt/sol-winapp-dns-callback-lifetime`; [PR #828](https://github.com/raydocs/tono/pull/828); not yet merged.
- Defect fix: a deadline/spurious wake could consume the DNS outcome and destroy completion storage before the callback finished notifying it. The callback now owns an independent reference through publication and notification; synchronous query paths retire the unused callback reference.
- New features: none; DNS policy and connection deadlines are unchanged.
- Engineering/tests: one deterministic ownership regression simulates consuming the outcome and dropping the waiting worker during notification, then verifies callback storage is released on return.
- Verification: Linux Rust 1.98.1 extracted production completion methods plus checked-in regression failed with borrowed ownership (`1 != 2` strong references), then passed (`1 passed`); `git diff --check` passed. Windows-native DNSAPI/app tests cannot run on this Linux VM; hosted Windows CI must validate them.
- Candidate/publication: source only; no new candidate or publication.
- Remaining limits: no real-device DNSAPI timing test; needs-hardware.
