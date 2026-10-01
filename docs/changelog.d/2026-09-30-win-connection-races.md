## 2026-09-30 · Windows 连接失败只释放一次，恢复预检后复核服务器选择
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1；Windows 连接失败释放与恢复连接准入。
- 来源：main `846705c7` → 分支 `codex2/win-connection-races`；PR #798；未合 main。
- 缺陷修复：已验证保护下的普通连接失败已由 `fail_connect` 走标准释放，调用者却在 `FailOpen` 后再次按 owner 释放，可能拆掉刚准入的后继连接；删除第二次释放，保留 `fail_connect_observed` → `release_explicit_with_guard`（Disconnect 共用路径）。恢复 TCP 预检期间 FSM 仍空闲，改选服务器不一定推进代际；快照另存用户选择，预检返回后在准入的同一把状态锁内复核，改变或清空就以 `Stale` 退出，不启动旧选择的连接。关联 [WIN-SELFHEAL-DOUBLE-RELEASE](../findings.d/WIN-SELFHEAL-DOUBLE-RELEASE.md)、[WIN-PREFLIGHT-STALE-SELECTION](../findings.d/WIN-PREFLIGHT-STALE-SELECTION.md)。
- 新增/优化：无。自愈的备用拨号目标仍与用户选择分开比较；严格 kill switch 和选择性 AI 保持的既有决定不改；不另建 AI 阻断层，标准释放留待 #738 接入。
- 工程与测试：在 `connection.rs` 现有测试模块加一个 `recovery_preflight_rejects_a_changed_or_cleared_selection`，覆盖选择未变、改选、清空。重复释放直接位于调用者的异步编排，没有可验证该第二次调用的现有纯函数接缝；按本轮「否则解释」要求不加无效断言，也不为测试重构 IPC。
- 验证：本 worktree 基线 `846705c7`；`git diff --check` 通过。逐行复核 Rust 类型、元组调用者、借用、await 和锁范围；未新增持有 `state.lock()` 再 await 重锁的路径。本环境无 Cargo、Windows、Swift/Xcode，Rust 单测与平台构建未执行，由 hosted Windows CI 运行；Windows 实机释放竞态未执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`needs-hardware`；仍需 Windows 实机验证失败释放与后继 Connect、恢复预检中改选。#738 未在此 main，不能声称释放后的 AI 阻断已验证。另见失败处理在代际校验前更新自愈和认证隧道端口的潜在竞态，本轮未修、未复现。
