## 2026-09-30 · macOS update retirement preserves executor cleanup retries
- Ownership: SHIP_PLAN §2 item 10; native update/install/rollback regression review.
- Source: baseline `7f382af7`; branch `hunt/sol-r4upd-mac-retire-cleanup`; source PR, not merged when authored.
- Bug fix: a failed executor-job retirement keeps the resolved attempt active, so the next update cannot acknowledge an old loaded launchd job as its executor. Finding `R4UPD-MAC-RETIRE-CLEANUP` (P2).
- New features: none; verified Disconnect, archives, consumed high-water and protection policy retain their existing behavior.
- Engineering/tests: one helper self-test exercises cleanup refusal, retained admission fence, retry and subsequent update admission. Helper protocol and source contract are bumped together.
- Verification: Linux source/diff and contract-hash checks; Swift/helper self-test cannot execute here and must run in hosted macOS CI. No executed native failing-then-passing result is claimed.
- Candidate/release: source only; no new package, deployment or publication.
- Limits: installed launchd cleanup fault/retry remains for hardware acceptance; network rules are unchanged.
