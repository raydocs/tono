## 2026-10-01 · macOS 保护 DNS 等待缓存之后的假 IP
- 归属：SHIP_PLAN §2 item 10；`ProtectedSystemResolver.swift`；发现 MAC-DNS-CACHE-BATCH。
- 来源：基线 `17580a26` → 分支 `hunt/grok-maccfg-dns-cache-batch-89a9`（#886），未合 main。
- 缺陷修复：`kDNSServiceFlagsMoreComing` 清零只表示这一批结束。代码原先就此拆掉 `DNSServiceRef`。缓存中的公网 A 记录会先到，假 IP 在下一次回调。连接已经武装 PF，系统 DNS 检查失败后 `disconnect(releaseKillSwitch: false)` 保持断网。现在只有批次里已经有假 IP 才提前结束；只有公网地址时查询留到截止时间，截止后仍交出这些公网地址供失败说明使用，过期的假 IP 不能算通过。
- 新增/优化：无。
- 工程与测试：`ProtectedSystemResolverTests.testCachedPublicAnswerWaitsForALaterFakeIP`。
- 验证：Linux 云代理无 Swift 工具链，XCTest 未在本地执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需 `needs-hardware`。不能声称已在真机上看过缓存回调顺序。

## 2026-10-01 · 续记（系统 DNS 截止时间）
- 合入当时的 `origin/main`。`testSystemDNSDeadlineReturnsWhileSetupIsHeldAndRefusesStackedSetup` 在 1 秒到期，结果仍是 nil。截止回调把 `finishOnOwner` 派回 `ownershipQueue`，而测试里的 `DNSServiceGetAddrInfo` 正堵在这条队列上，等待方要等 C 调用返回才继续。这不是把超时改大能解决的抖动。
- 截止回调改在定时器队列上直接 `finish`。已收集的地址用锁里的快照，不在定时器线程读属主队列的数组。拆 `DNSServiceRef` 仍异步留在属主队列，堵着的 C 调用返回之前不会拆。助手域名和网段的路由没有改。失败时仍交回原来的网络，不在这里改成整机断网。
- 验证：本环境无 Swift，XCTest 未在本地执行。
