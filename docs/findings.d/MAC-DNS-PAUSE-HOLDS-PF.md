| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-DNS-PAUSE-HOLDS-PF | macOS 连接中第三次 Protected DNS 审计失败、或发现 split-DNS 冲突时走保留式拆线且不排重连：Core 停、PF 留、系统 DNS 指向已停的 127.0.0.1，非严格模式 Mac 断网约 30 秒直到 helper 看门狗释放，之后 UI 仍写「断网保护正在拦住直连、重试已暂停」 | in-PR | 本 PR | 中·推导（P2，源码路径） | 与 MAC-BROWSER-DOH-FAIL-CLOSED 同型。改为自动失败释放（保留 AI 拦截），不排重连。split-DNS「结束会话」仍是待所有者确认的暂定产品决定，只去掉了看门狗本来就会撤掉的 PF 保留。XCTest 只在 hosted CI 运行；DHCP/企业 VPN 改 DNS 的真机路径未测，needs-hardware |

触发路径：`scheduleNetworkEnvironmentReconciliation`（DHCP / 网络变化通知）→ DNS `.broken` 且上行未变 → 前两次保留式拆线 + 立即受保护重连，第三次 `pauseIfProtectedDNSKeepsFailing` 暂停；或任一次 `.supplementalConflict` → `holdProtectedDNSSupplementalConflict`。两处都在 `disconnect(releaseKillSwitch: false)` 后不排重连，Core 停后 `SocketServer.observeCoreForWatchdog` 三次（约 30 秒）释放 PF 并恢复 DNS，App 不再对账，直到窗口被激活。
