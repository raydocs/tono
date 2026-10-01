## 2026-09-30 · 连接成功路径不再和 /delay 抢握手

- 归属：SHIP_PLAN 客户连接路径（源码）。不改 TUN / PF / WFP / 路由，不合入。
- 来源：main `d2363002` → 本分支；未合 main。与拨号默认值的基准 PR 分开。
- 缺陷修复：连接验证在数据面探测还没返回时就发起 `unified-delay` 的 `/delay`。回环基准里这把 VLESS 首包从 45.1 ms、1 次握手拉到 71.7 ms、2 次握手。成功路径现在先做数据面探测；`/delay` 只在探测已经通过之后取样，失败的最后一轮才等待它做分类。
- 新增/优化：控制器一就绪就预取 `www.google.com` 的 A 记录，和后面的 PF/WFP、系统 DNS 切换重叠。预取失败不失败连接。DoH 仍走出口。阶段耗时以已有 `stage` 事件上传：`stage` 是刚结束的步骤，`delayMs` 是该步自己的耗时，`elapsedMs` 仍是累计。macOS 键与 Windows 的 `preparing` / `preparingHelper` / `startingKillSwitch` / `startingTunnel` / `lockingTraffic` / `applyingCloudPolicy` / `securingDNS` / `checkingExit` / `verifyingTraffic` 相同。
- 工程与测试：无新测试表。已有「获胜的 TUN 不等待 advisory」用例仍成立。
- 验证：基准数字来自同日 `--check`（见拨号默认值 PR），本变更不重跑协议服务器。`cargo test` 与 XCTest 未跑：本机 rustc 1.83 不能编 edition 2024，且没有 Xcode。
- 候选/发布：仅源码，无新候选。
- 剩余限制：TUN 建立、路由、PF 第二次武装、WFP、系统 DNS 切换、Windows `find-process-mode: always`、gVisor 与真实 RTT 仍只能在实机上从上述阶段耗时里看。出口 DoH 比明文 DNS 多一次握手，保持不变。
