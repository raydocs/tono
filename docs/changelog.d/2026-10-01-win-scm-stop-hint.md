## 2026-10-01 · SCM 停止等待提示在 DNS 恢复期间刷新

- 归属：SHIP_PLAN §2 第 10 项（不断网）。Windows Service 停止。
- 来源：`origin/main` `17580a26`。分支 `cursor/win-scm-stop-hint-d3c7`。未合 main。
- 缺陷修复：服务在启动恢复完成前就接受 Stop。第一次 `StopPending` 之后 SCM 不再送 Stop，65 秒提示盖不住一次 40 秒 DNS 恢复再加未证实屏障退休时的第二次。停止期间每 15 秒递增 checkpoint 并重报等待提示，避免 SCM 在恢复中途杀掉进程。DNS 证明和超时预算不缩短，屏障策略不改。
- 新增/优化：无。
- 工程与测试：`scm_stop_hint_refreshes_before_a_dns_restore_can_outlive_it`。
- 验证：Linux 上这条 lib 测试。`cargo check --target x86_64-pc-windows-gnu` 编服务二进制。没有 Windows 实机。
- 候选/发布：仅源码，无新候选。
- 剩余限制：刷新线程没在 SCM 里实测。提示仍是 65 秒，只是不再只报一次。
