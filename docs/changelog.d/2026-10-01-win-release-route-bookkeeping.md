## 2026-10-01 · Windows Service: explicit Release proceeds when owner bookkeeping fails after a confirmed Core stop
- 归属：SHIP_PLAN §2 item 10 (decision 031 fail-open); Windows Service owner lifecycle, `ReleaseKillSwitch` route.
- 来源：origin/main 10081bb2; fix/win-release-bookkeeping-1274; PR Fixes #1274, not yet merged.
- 缺陷修复：WIN-RELEASE-ROUTE-BOOKKEEPING. The explicit Release (Disconnect / Restore) stopped the Core, then refused the release when only the run-intent or active-owner write failed (`rollback_started_owner` Bookkeeping, or the `?` in `retire_unrecorded_owner_core`). A persistent ProgramData write failure kept a non-strict machine Blocked on every retry. Now `release_despite_bookkeeping` logs that failure and the route releases; an unconfirmed Core stop, a readable foreign owner record and an unproven DNS restore still refuse. Same approach as #1275 for the automatic path; replay is fenced by the independent active-owner clear and the release's tombstone or wanted-intent removal.
- 新增/优化：无。The explicit-Restore AI hold semantics and strict mode are unchanged.
- 工程与测试：one Service tokio test, `explicit_release_proceeds_when_the_run_intent_cannot_be_retired`; the existing corrupt-owner test maps the new error type.
- 验证：cargo test not run locally (MacBook rule); hosted CI runs it. `rustfmt --check` adds no hunk on the changed lines. The new test was not run against the old code (it would not compile: the old function returned `anyhow::Error`).
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：needs-hardware. Same residual as WIN-FRESH-ARM-RETIRE-BOOKKEEPING: if the run-intent write, the active-owner clear and the tombstone write/intent removal all fail, a same-boot Service restart can still replay the retired Core.
