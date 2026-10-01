## 2026-09-30 · macOS 读不了的 resolver 目录不再藏起分割 DNS
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。macOS 已连接会话的受保护 DNS 审计。
- 来源：`origin/main` `ff81118a` 上的 `hunt/grok-macrt-split-dns-files`；[#836](https://github.com/raydocs/tono/pull/836)；未合 main。
- 缺陷修复：`/etc/resolver` 无法枚举或其中有文件读失败时，不再丢掉 System Configuration 里已经读到的分割 DNS。动态库里有冲突则照旧暂停并保持 Kill Switch。动态库没有冲突时仍返回 nil，审计保持 unverifiable，不因此拆隧道。
- 新增/优化：无。
- 工程与测试：`SupplementalResolverMergeTests.testUnreadableResolverDirectoryKeepsDynamicStoreConflicts`。
- 验证：本环境无 Xcode，`xcodebuild` 未跑。hosted macOS CI 待跑。
- 候选/发布：仅源码，无新包。
- 剩余限制：未在真机上放置不可读的 `/etc/resolver` 文件。
