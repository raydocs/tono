## 2026-10-13 · Windows：未提交的 DIRECT 重载过期后，无人恢复的非严格会话有界后释放
- 归属：SHIP_PLAN §2 item 10；Windows Service WFP 看门狗（`apps/windows/service/src/core/windows_kill_switch`）。
- 来源：基线 origin/main → 分支 `claude/win-direct-incomplete-expiry`；Refs #1056（R3KS1-PENDING-EXPIRY）；决定 [116](../decisions/116-2026-10-13-incomplete-direct-reload-expiry-releases.md)（provisional）。
- 缺陷修复：DIRECT 重载在 Bracket/Pending 阶段过期（App 在重载中途死亡）时，Service 收窄到精确 Blocked，但 Blocked 被判为健康，非严格的 `UNHEALTHY_RELEASE_TICKS` 释放永不触发，没有 App 时整机一直无网。改后：过期仍立即收窄（#777/#926 的行为不变），非严格会话随后进入既有的按代数围栏的退役：90 s 内没有新的 Connect / 验证清掉它，就停 Core、放开通用流量并装上 AI 保持（与已提交租约过期同路径）。严格模式不入队；宽限期内 Lock/MarkVerified 仍被接受（与已提交过期不同）。
- 新增/优化：无。
- 工程与测试：`expired_pending_direct_reload_releases_a_non_strict_session_after_the_grace`（含 90 s 宽限边界）、`a_live_replacement_lease_withdraws_the_incomplete_reload_release`（宽限内 App 提交了新租约，旧期限不得退役它）、`incomplete_expiry_queues_the_release_when_only_intent_persistence_fails`（已证明精确 Blocked、仅意图写入失败时仍入队）。`withdrawing_the_incomplete_reload_window_restores_the_one_it_displaced`（被替换的 fresh-Connect 验证窗口在撤销时恢复而非清除）。Codex 审查（3 个 Major）后补充：新有效租约在看门狗下一拍撤销排队的释放，退役时也再核对。
- 验证：见 PR 正文 `## Verification`。未在真机杀 App 复现。
- 候选/发布：仅源码，无新候选。
- 剩余限制：恢复测试直接写入 Committed 租约，未走真实 Begin→Lock→Replace→Finalize；宽限 90 s 是 provisional（决定 116）；Retracting（非释放的所有权变更收窄）不在此修复内；待实机。
