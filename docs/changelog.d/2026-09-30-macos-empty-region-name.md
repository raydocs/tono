## 2026-09-30 · macOS：空目录名不再把地区查找打崩

- 归属：编排器低风险范围 M14（Views）。不是客户发布门。不改布局。
- 来源：基线 `origin/main` `ff81118a`；分支 `cursor/macos-empty-region-lookup-5636`（从云代理 bc-7ab08cd1 的本地提交 `51f5f1051` 恢复）。
- 缺陷修复：`catalogNodeRegionCode` 对 `displayName.split(separator: "·")[0]` 取下标。目录名是空的，或只剩分隔符（`·`、` · hy2`）时，split 得到空数组，画节点卡片会 trap。改后没有第一段就返回 nil，未知地点仍不冒充固定地区。
- 新增/优化：无。
- 工程与测试：`MacUsabilityTests.testEmptyCatalogNameDoesNotTrapRegionLookup`。
- 验证：本机无 `xcodebuild`，XCTest 未跑。macOS CI 跑该用例。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无。
