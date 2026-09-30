## 2026-09-30 · macOS 失败后卸下 PF，探测期间不装隧道

- 归属：SHIP_PLAN 客户连接路径。叠在 #706 上。不是 G4，不发客户包。
- 来源：#706 `47d0c564`，并带上 #703 的 `ExitHeal` 决策类型；未合 main。
- 缺陷修复：已武装的连接失败、看门狗、TUN 丢失、受保护 DNS 损坏、健康升级和 PF 被其他程序改掉，以前保持 PF 并保护重连。现在用共享的 `ExhaustedFailureNetwork` 放行，调用 `disarm`。
- 新增/优化：`ExitHeal` 只选下一次拨号，不碰 PF。后台重连要等 TCP 证明且保护已放下。需要用户操作的失败（管理员拒绝）放行后不自动再连，避免反复弹授权。网络变化那一支仍是 #702 的范围，这里不改。浏览器 DoH 冲突仍保持原来的阻断。
- 工程与测试：`ArmedFailureReleaseTests` 证明 disarm 被调用、restrict 没被调用、`isProtectionBlocked` 为假、没有排保护重连。`UnarmedReconnect` 证明不可达或仍武装时不连接。XCTest 未在本机跑。
- 验证：无 Xcode，`xcodebuild` 未执行。需要 macOS CI。
- 候选/发布：仅源码，无新候选。
- 剩余限制：网络切换分支和浏览器 DoH 未改。释放失败时 PF 可能仍在。Hysteria2 不做 TCP 证明。没有实机套接字探测记录。

### 2026-09-30 续记 · 生产路径使用 TCP 连接证明

- 未设置测试闭包时，用 `NWConnection` 对目录里的地址做一次 TCP，超时 2.5 秒。不通就继续等待，不调用 `connect()`。测试仍注入闭包，所以单测不会打到网络。

### 2026-09-30 续记 · 变基到当前 #706 并修编译

- 来源：两条提交重放到 [#706](https://github.com/raydocs/tono/pull/706) `55e68e93`。失败仍调用 `disarm`，证明成功前不 `connect()`。
- 缺陷修复：`build` / `policy-tests` 编译失败。退避调用补上 `attempt:` 标签。测试闭包标成 `@MainActor @Sendable`，Observation 才能交出这个存储。放行条件和探测条件没有放宽。
