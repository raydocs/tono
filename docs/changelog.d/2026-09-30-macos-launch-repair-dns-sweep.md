## 2026-09-30 · macOS 启动修复 helper 后无快照也清扫受保护 DNS
- 归属：SHIP_PLAN §2 item 10（不断网）；macOS `RuntimeCleanup.swift`，发现 MAC-LAUNCH-REPAIR-DNS-SWEEP。
- 来源：基线 `5d46b896` → 分支 `codex/macos-launch-repair-dns-sweep`（本分支 PR），未合 main。GLM-5.3 发现，Codex gpt-6.1-sol（effort xhigh）实现，审阅后提交。
- 缺陷修复：`recoverStaleRuntime()` 里 helper 可用的分支早已按注释所述「快照缺失不等于无需恢复」在 `didStartCore || shouldResumeProtection` 时请求恢复；但 helper 不可用、`prepareHelper()` 修好后的分支只在 `recheck.snapshotPresent` 时才调用 `restoreProtectedDNSIfConfigured()`。在删除快照窗口内被强杀、下次启动 helper 又不可用时，核心已停而 DNS 仍指向死掉的 127.0.0.1。现在修好后只要 recheck 可用就请求恢复（helper 端对无快照执行 loopback 清扫），recheck 不可用仍算未修复，错误信息不变。
- 新增/优化：无。未改 helper 源码、helper 版本或协议。
- 工程与测试：把修复分支抽成 `RuntimeCleanup.repairProtectedDNSAtLaunch(prepareHelper:status:restoreDNS:)`（与既有 `queryPendingNativeUpdate` 相同的注入方式），新增 `LaunchDNSRepairTests.testRepairedHelperRestoresDNSWithoutSnapshot`。
- 验证：Linux box 无 Swift 工具链，Swift/XCTest 未在本地执行，由托管 macOS CI 验证。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需托管 macOS CI；强杀窗口未实机复现。
