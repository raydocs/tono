## 2026-10-01 · Windows Service/App: four P2 paths no longer end stuck Blocked (#1229)
- 归属：SHIP_PLAN §2 item 10; Windows Service lifecycle and App startup restore (RegLate + WinSvcIPC review).
- 来源：origin/main db39c330; fix/win-1229-service-stuck-blocked; source PR, not yet merged.
- 缺陷修复：WIN-RETIRE-FOREIGN-OWNER, an expired fresh arm is retired over an unreadable or foreign owner record instead of refusing every tick; WIN-STARTUP-RECONCILE-STUCK, a startup reconciliation that fails three bounded attempts takes the decision-031 release of the unverified barrier; WIN-STOP-REPAIR-GATE-IO, a repair-gate I/O error no longer keeps protection on SCM stop; WIN-RESTORE-SUPERSEDED-PROBE, a sign-in during startup restore no longer hides a stale armed barrier from Protected Offline and the resync poll.
- 新增/优化：无。Every changed failure path ends with ordinary network and the AI hold; strict mode unchanged.
- 工程与测试：one regression per item: foreign-owner retire (Service tokio test), startup retry bound (service bin), stop gate predicate (owner lifecycle tests), superseded restore fold (App).
- 验证：cargo test not run locally (MacBook rule); hosted CI runs it. rustfmt --check shows no diff on the changed lines (the files carry pre-existing drift).
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：needs-hardware; none of the four paths was reproduced on a real machine.
