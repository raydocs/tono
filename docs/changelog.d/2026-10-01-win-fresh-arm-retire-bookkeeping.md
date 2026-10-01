## 2026-10-01 · Windows Service: automatic fresh-arm retirement releases despite bookkeeping failure
- 归属：SHIP_PLAN §2 item 10 (decision 031 fail-open); Windows Service owner lifecycle.
- 来源：origin/main 10ce26c9; claude/win-fresh-arm-retire-bookkeeping; source PR, not yet merged.
- 缺陷修复：WIN-FRESH-ARM-RETIRE-BOOKKEEPING. `retire_expired_fresh_arm` (abandoned Connect, Core recovery exhausted, committed DIRECT expiry) refused the release every tick when the repair gate hit an I/O error or the run-intent read/write failed after the Core stop, so a non-strict machine stayed Blocked. Now only an installer-held gate, update admission or an unconfirmed Core stop refuse; the other failures are logged and the release (AI hold kept) proceeds.
- 新增/优化：无。Strict mode is not reached by this path (unchanged).
- 工程与测试：one Service tokio test, `fresh_arm_expiry_releases_when_the_run_intent_cannot_be_retired`.
- 验证：cargo test not run locally (MacBook rule); hosted CI runs it. The new test was not run against the old code.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：needs-hardware. The explicit Release route still refuses on the same bookkeeping failure (#1274).
