## 2026-10-01 · Windows sing-box DIRECT replacement no longer reads as a Core crash (#1228)
- 归属：SHIP_PLAN §2 item 10; Windows sing-box DIRECT (RegLate review of #1175).
- 来源：origin/main e38c9cfb (after #1227); fix/win-1228-singbox-direct-pid; source PR, not yet merged.
- 缺陷修复：WIN-SINGBOX-DIRECT-PID-MONITOR, the sing-box DIRECT replacement sets the owned-reload marker and adopts the proved new Core pid as the monitor baseline; the monitor defers an owned identity change instead of invalidating the session, so a tick inside the replacement cannot start the rebuild → DIRECT → replacement loop.
- 新增/优化：无。Release, AI-hold and strict-mode behavior unchanged; an unexplained pid change or a sustained missing Core still fires on the first tick after the reload.
- 工程与测试：one regression on the monitor decision (`core_identity_change_owned`).
- 验证：cargo test not run locally (MacBook rule); hosted CI runs it. rustfmt --check (apps/windows/app/rustfmt.toml) shows no diff on the changed lines.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：needs-hardware: how often a monitor tick lands inside a real replacement.
