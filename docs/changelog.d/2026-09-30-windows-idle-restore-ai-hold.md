## 2026-09-30 · Windows idle Restore removes the secondary AI hold

- 归属：SHIP_PLAN §2 item 10；Windows App explicit network recovery.
- 来源：origin/main `56a11440` → branch `hunt/sol-r4fo-idle-restore-ai-hold` (this PR); source only, not merged at authoring.
- 缺陷修复：After automatic recovery, broad protection is absent but AI firewall/NRPT rules remain. A slow startup account read offers Restore Internet after eight seconds. Its idle App FSM previously returned success without cleanup. Explicit Restore now dispatches the existing owner-gated plain Service release; automatic failed-Prepare recovery retains its generation checks and idle no-op. Finding: R4FO-WIN-RESTORE-IDLE-AI-HOLD.
- 新增/优化：无；no UI layout, Service protocol, network policy lists or strict-mode change.
- 工程与测试：One narrow regression checks the production idle-dispatch gate with the actual tono-core ConnectionStatus, preserving the automatic no-op.
- 验证：Linux rustc 1.98.1 compiled the exact production gate and committed regression with the real tono-core connection module. Original gate failed (0 passed, 1 failed); fixed gate passed (1 passed). Receipts: `out/R4-FailOpen/idle-restore-{baseline,fixed}.log`. This is dispatch-boundary evidence, not full Tauri/Service or native rule execution. `git diff --check` passed; hosted Windows CI must compile/run the App regression.
- 候选/发布：仅源码，无新候选；未部署或发布。
- 剩余限制：needs-hardware for idle explicit NRPT/firewall cleanup and recovery refusal. Shared live automatic/explicit release-intent reconciliation is a separate larger change, issue #1109; durable automatic recovery intent is #1077.
