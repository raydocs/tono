## 2026-09-30 · macOS：系统代理 administrator 授权弹窗加 180 s 期限，超时按拒绝处理
- 归属：G1（断开/恢复/退出不得被系统代理路径挂死）；发现分片 MAC-PROXY-PROMPT-UNBOUNDED。App
  `Core/SystemProxy.swift`、`Services/AppState.swift`；测试 `TonoTests/ProtectedDNSServiceSelectionTests.swift`。
- 来源：main `64af499a` → 分支 `glm/mac-proxy-prompt-bound`；PR [#774](https://github.com/raydocs/tono/pull/774)；未合 main。
- 缺陷修复：`SystemProxy.runNetworkSetupWithPrivileges` 的 `osascript ... with administrator privileges` 用无期限
  `waitUntilExit()` 等待。系统代理模式下未提权 `networksetup` 失败时（非管理员用户、MDM 锁定代理设置），
  enable / turnOff / restore / reapply 都会走到它，而它们全部串行在 `PrivilegedRuntimeCoordinator` actor 上：
  凭据对话框没人理会时 actor 被无限占住，断开 / 恢复网络（repairForRelease → stopCore → restoreDNS → disarm
  逐跳同一 actor）永不完成，退出到 20 s 期限时 PF 仍 armed。改后：新增 `SystemProxy.waitForExit(_:timeout:)`
  （轮询 200 ms，超时 SIGTERM、300 ms 后仍存活则 SIGKILL，再回收——镜像 `HelperManager` 安装弹窗
  ~332-349 的同一模式），提权等待最多 180 s，超时抛 `SystemProxyError.privilegesDenied`；调用方照原有
  失败路径处理，未改。未提权 `runNetworkSetup` 同一助手改为 15 s 有界等待，超时按 `commandFailed` 失败，
  上层照旧回退到提权路径（该路径自身也有界）。
- 新增/优化：Proxy Guard（`AppState.startProxyGuard`）每 10 s 一个 tick、每 tick 各起一个 Task，原先可在上一轮
  reapply 仍在 actor 上执行/排队时再入队新的 reapply（一次被挂住的弹窗后面排起一串、各自再弹一次凭据框）。
  现加 `proxyReapplyInFlight` 防重入：上一轮未结束的 tick 内直接跳过。
- 工程与测试：无。
- 验证：未在本机编译（本工作区为 Linux，无 Xcode/Swift 工具链；MacBook 也不跑 xcodebuild）。新增回归
  `testBoundedWaitKillsSubprocessPastItsDeadline`（`/bin/sleep 5` + 0.5 s 期限，断言超时返回、进程已死、耗时远小于
  自然退出）未运行，以托管 macOS CI（`macos-26`）XCTest 为准。其余改动（180 s/15 s 期限、防重入）为时序行为，
  未单独测。
- 候选/发布：仅源码，无新候选。
- 剩余限制：期限内用户仍可一直不答：actor 最多被占 180 s（提权）或 15 s（未提权）后自行恢复为失败；osascript 被
  杀后凭据对话框的系统侧收尾未实机核对。`SystemProxy` 内 `parseProxyInfo` / `listNetworkServices` /
  `primaryNetworkInterface` 仍是未设限的只读 `networksetup` / `route` 调用（`verifyProxyIntact` 会经 actor 走到
  它们），本条未改。Proxy Guard 防重入不覆盖连接/断开等其他调用方（它们本就串行在同一 actor）。未实机。
