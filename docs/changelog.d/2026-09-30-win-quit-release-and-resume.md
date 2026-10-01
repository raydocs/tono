## 2026-09-30 · Windows 退出前补查服务并恢复取消退出后的目录同步
- 归属：SHIP_PLAN §2 item 10；Windows App 退出、重启与服务保护释放。
- 来源：main `026e747c` → 分支 `codex2/win-quit-fixes`；PR #784；已并入 `origin/main` `a828ed5f`。发现前释放与取消后恢复目录同步仍在。退出判定测试补上 `KillSwitchStatus.reconnect_after_release`。
- 缺陷修复：重启 App 后在保护发现完成前退出，原只看本地 FSM 而漏掉上次留下的 Core/WFP/DNS；现本地未报告保护时限时 1 秒补查 Service，当前用户为 Service 活动 owner 且其 kill switch wanted 或 Core 运行时走显式释放（kill switch 聚合是全机的，其他用户的屏障不在此释放，避免 owner-gated 拒绝把退出卡住）。`TonoState` 创建失败时也可走不依赖会话的 owner-gated 释放，后台完成释放及自有系统代理清理，不随退出等待超时中止；服务按 DNS → Core/持久意图退役 → WFP 顺序处理。关联 `WIN-QUIT-BEFORE-DISCOVERY-SKIPS-RELEASE`。
- 缺陷修复：取消退出后原不再刷新云目录与流量策略；现保护重同步后为 Ready、仍有账户且未在关闭账户的当前认证代恢复既有周期同步。重启的两处取消返回也调用重同步。关联 `WIN-CANCELLED-QUIT-STOPS-CATALOG-SYNC`。
- 新增/优化：无。补查不可读或超时时沿用原退出决定；保留 owner gate 和待更新退出围栏，未重启退出流程未中止的遥测与日志上传。
- 工程与测试：`quit.rs` 新增一条纯判定回归，覆盖本地未发现时本用户的 wanted 保护与运行 Core、其他用户的屏障与 Core 及不可读快照。取消退出的完整恢复依赖原生 `AppHandle`，没有廉价的既有测试入口，按本次任务允许未另加注入测试。
- 验证：本 Linux worktree 无 Cargo、Windows 或 Xcode；未编译或执行 Rust/Swift 原生测试，hosted Windows CI 执行 Rust 检查，当前待跑。逐行复核改动的类型、cfg、owner gate、await 与锁释放；`git diff --check` 通过。
- 候选/发布：仅源码，无新候选。
- 剩余限制：涉及退出时网络释放，PR 须带 `needs-hardware`；未做 Windows 实机的强关 App → 重启 → 立即退出、DIRECT 租约、DNS/WFP 恢复或取消退出后的目录/策略刷新验证。凭据不可读、服务不可读或补查超时仍可能漏掉残留保护，本次按任务边界保留原行为。取消退出的既有重同步仍可等到 Service IPC 的 32 秒 guard；重启先恢复界面反馈再等重同步，未另改这个读取预算。
