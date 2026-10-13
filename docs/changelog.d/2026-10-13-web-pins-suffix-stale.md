## 2026-10-13 · 后缀已覆盖的网页钉选不再被旧地址卡住（#1057）
- 归属：`docs/SHIP_PLAN.md` §2 item 10（G4 冻结期内的 macOS 直连修复；冻结期合并由主会话决定）；macOS `ConfigPipeline`、`AppState+Connect/Catalog`。发现 `MAC-WEB-PINS-SUFFIX-STALE`、`R3CONN-DEC01`。
- 来源：基线 origin/main 20266ba2f；分支 `claude/dns-pins`；PR 见 #1057 的链接；尚未合 main。
- 缺陷修复：策略带有任一网页后缀时 App 停止刷新网页钉选，但产品 sing-box 配置仍先对钉选主机 `resolve` 到旧钉选 IP 再拨号，CDN 退役旧地址后该网站持续失败直到重连。改为：被策略后缀按相同端口覆盖的钉选不进入运行配置（后缀规则拨号时经中国 DNS 取当前地址），因此无需刷新也不会过期；仍被钉选决定拨号的（未被后缀覆盖）钉选继续刷新。无整会话重载新增。详见 `docs/findings.d/MAC-WEB-PINS-SUFFIX-STALE.md`。
- 决定：`R3CONN-DEC01` 保留现有补充 DNS 冲突拆会话行为（较严一侧），记为决定 122（provisional），该行关闭为 `accepted-design`；无代码改动。
- 新增/优化：无。
- 工程与测试：`testAWebPinThatAPolicySuffixCoversIsNotResolvedStatically`、`testAnUncoveredWebPinStaysLoadBearingWhileAPolicySuffixExists`、`testCoveredWebPinRotationInAMixedPolicyIsNotAChange`（Codex 第 1 轮后补：被覆盖钉选的轮换在合并时保持原值，不触发重载）、`testNewlyResolvedCoveredWebPinIsNotAnAdoptedChange`（Codex 第 2 轮：首次解析失败后才解析成功的被覆盖主机不被收养，避免只因它重载）。
- 验证：见 PR 的 Verification 一节。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未被覆盖的钉选轮换仍经既有推迟策略后重载整个会话（无局部热替换接口）；旧 YAML 运行配置路径未改；PF 会话端点仍含被覆盖钉选的旧地址；实机未验证。
