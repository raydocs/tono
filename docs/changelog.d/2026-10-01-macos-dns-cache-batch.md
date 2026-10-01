## 2026-10-01 · macOS 保护 DNS 等待缓存之后的假 IP
- 归属：SHIP_PLAN §2 item 10；`ProtectedSystemResolver.swift`；发现 MAC-DNS-CACHE-BATCH。
- 来源：基线 `6dc5b90d` → 分支 `hunt/grok-maccfg-dns-cache-batch-89a9`（本分支 PR），未合 main。
- 缺陷修复：`kDNSServiceFlagsMoreComing` 清零只表示这一批结束。代码原先就此拆掉 `DNSServiceRef`。缓存中的公网 A 记录会先到，假 IP 在下一次回调。连接已经武装 PF，系统 DNS 检查失败后 `disconnect(releaseKillSwitch: false)` 保持断网。现在只有批次里已经有假 IP 才提前结束；只有公网地址时查询留到截止时间，截止后仍交出这些公网地址供失败说明使用，过期的假 IP 不能算通过。
- 新增/优化：无。
- 工程与测试：`ProtectedSystemResolverTests.testCachedPublicAnswerWaitsForALaterFakeIP`。
- 验证：Linux 云代理无 Swift 工具链，XCTest 未在本地执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需 `needs-hardware`。不能声称已在真机上看过缓存回调顺序。
