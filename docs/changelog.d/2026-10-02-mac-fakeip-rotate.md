## 2026-10-02 · macOS：重启 Core 后，应用缓存的旧 fake-IP 不再指向别的网站
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) §2 第 10 项。macOS App（sing-box 配置编译、`CoreRuntimeManager`）。
- 来源：[#1258](https://github.com/raydocs/tono/issues/1258) 的 macOS 一侧，叠在 [#1333](https://github.com/raydocs/tono/pull/1333) 上，分支 `fix/mac-fakeip-rotate`，[#1334](https://github.com/raydocs/tono/pull/1334)。未合 main。
- 缺陷修复：macOS 上换节点、连接后应用 DIRECT 策略、刷新 pins 都经 `/core/sync` 换掉 Core 进程。sing-box 的 fake-IP 表只在内存里，新进程从同一段的开头按顺序重新分配，应用还缓存着的旧地址就对应到新进程最先解析的另一个域名，出现证书错误，直到 DNS 缓存过期（系统 30 秒，浏览器更久）。现在会换掉进程的文档轮流使用 `198.18.16.0/20` 里的一个 /22，文档里新增一条规则拒绝目的地址落在整个池内的纯 IP 连接：旧地址立即被拒绝，应用重新解析后恢复。
- 新增/优化：无。
- 工程与测试：新增 `SingBoxFakeIPRotation`（与上次写入内容相同的配置保持原字节，所以 reload 路径按摘要相等跳过重启的逻辑不变；内容变了或 Core 停过，才换下一段）；`buildSingBoxRuntime` 新增 `fakeIPSlot`；新增一条 XCTest；既有的池断言和 Linux `check` 用的 `macos-product-shape.json` 同步。helper 不需要改：它的准入不限定 fake-IP 段，没有协议版本变化。
- 验证：见 PR。本机没有连接、没有原生构建；XCTest 和 pinned sing-box 对 Swift 实际输出的 `check` 由 hosted macOS CI 运行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有实机验证（`needs-hardware`）。旧地址仍会失败一次（立即拒绝）。每个进程可用的 fake-IP 从 4094 个降到 1022 个。App 重启后接管一个仍在运行的 Core 时不知道它用的是哪一段，起点随机，有四分之一的概率同段。一次写入之后被取消、没有 `/core/sync` 的切换会让「上次写入」和「正在运行」不一致：下一次内容与正在运行的配置相同的 reload 会多重启一次 Core。[决策 047](../decisions/047-2026-10-02-windows-fakeip-rotation.md)。
