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

### 2026-09-30 续记 · 测试闭包不再交给 Observation

- 工程与测试：`ce3c6932` 上 `macos/build` 与 `policy-tests` 仍失败。宏把存储看成 `(@concurrent (String) async -> Bool)?`，访问器却要交出 `(@MainActor @Sendable (String) async -> Bool)?`。`unarmedTcpProof` 改为 `@ObservationIgnored`，与其它测试缝一致，不再生成这个访问器。`ResumeOnce` 标成 `nonisolated`，套接字回调可以在后台队列结束探测。
- 行为不变：普通失败仍 `disarm`；TCP 证明成功且保护已放下之前不 `connect()`。无 Xcode，本机未跑 `xcodebuild`。

### 2026-09-30 续记 · 构建测试跟上放行文案

- 工程与测试：`a232aae0` 上 `policy-tests` 已通过，Observation 不再报 yield 错误。`macos/build` 仍失败，因为健康检查断言还期待「断网保护正在阻断并重连」，目录里也没有四句新英文的简体中文。断言改成「原来的网络已经恢复，正在寻找可连接的出口」。PF 检查仍必须跑完并停止监视，修复次数仍是 1。显式「修复并重连」仍会进入 `connect()`；武装失败之后保护已放下，不再停在暂停的 Protected Offline。四句新文案补了 `zh-Hans`。
- 行为不变：普通失败仍 `disarm`，不调用 `restrictToBootstrap`。本机无 Xcode，未跑 `xcodebuild`。

### 2026-09-30 续记 · 助手拒绝后自动重试仍然暂停

- 缺陷修复：`a232aae0` 的 `macos/build` 里 `testRepairAndReconnectReachesConnectWhenHelperRejectsThisApp` 失败。显式「修复并重连」已经进入 `connect()`，但放行时 `resetReleasedSessionHistory` 清掉了暂停，无武装探测又取消了保护重连，下一拍看不到助手的 `.rejected`，暂停没有重新立上。现在放行之后若状态仍是拒绝，重新立上暂停，并且不启动无武装连接（那次 `connect()` 会再次清掉暂停）。原网络仍然放开。断言仍要求暂停为真，没有改成期待假。
- 验证：本机无 Xcode，未跑 `xcodebuild`。

### 2026-09-30 续记 · 变基到已含 #703 的 main

- 来源：重放到 `01c2403f`（main 已含 #706 与已合并的 #703）。`ExitHeal` 保留 main 的 `selectiveAiHold`；这条路径的 `selectiveReady` 仍是 false，普通失败仍是完整放行。助手协议仍是 `4.52.6`。
- 行为不变：放行之后若助手状态仍是 `.rejected`，重新立上 `protectedReconnectPausedForUserAction`，不启动无武装连接。`testRepairAndReconnectReachesConnectWhenHelperRejectsThisApp` 仍断言暂停为真。`unarmedTcpProof` 仍是 `@ObservationIgnored`。
- 验证：本机无 Xcode，未跑 `xcodebuild`。需要 macOS CI。

### 2026-09-30 续记 · 放行不能放进同步的 MainActor.run

- 工程与测试：`fd7d2f9e` 上 `macos/build` 与 `policy-tests` 编译失败。连接失败收尾在 `await MainActor.run` 里调用了异步的 `applyExhaustedArmedFailure`，闭包变成异步，而 `MainActor.run` 只要同步体。这段 `perform` 已经标了 `@MainActor`，收尾直接留在原闭包里。暂停条件和放行条件没有放宽。
- 验证：本机无 Xcode，未跑 `xcodebuild`。需要 macOS CI。
