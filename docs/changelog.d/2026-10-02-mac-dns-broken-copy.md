## 2026-10-02 · macOS：受保护 DNS 失效时不再提示「网络已切换」
- 归属：SHIP_PLAN §2 第 10 项；macOS App（`AppState.scheduleNetworkEnvironmentReconciliation`）。
- 来源：基线 `f7279dd9` → 分支 `fix/mac-dns-broken-copy-861`，PR #1339；尚未合入 main。
- 缺陷修复：已连接时系统网络通知触发对账，上行没有换网、只是受保护 DNS 读到被改动，界面却显示
  「当前网络已切换…」。现在这种情况显示目录里已有的「受保护的 DNS 已停止。断网保护正在阻断流量，
  Tono 正在重试。」；上行真的换了才显示换网提示。关联 #861（MAC-RECONCILE-DNS-COPY）。
- 新增/优化：无。保留断网保护、立即重连的原有决策；没有新增文案条目（英文与简体中文都已在
  `Localizable.xcstrings`）。
- 工程与测试修正：`NetworkChangeTests.testBrokenDNSOnTheSameUplinkDoesNotSayTheNetworkChanged`
  先单独推送为 `b17eee4b`（红），结果记在 PR。
- 验证：仅托管 CI；未在实机上触发 DNS 被改动的场景。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1339，merge commit `5b2efd51`，PR 头 `65976809`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37023726142 。
- 普通风险改动：主会话核对差异并在 hosted CI 上跑了对应测试，没有独立评审。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
