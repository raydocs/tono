## 2026-10-23 · macOS 保护范围文案（AI 家宽会话不再声称整机受保护）
- 归属：SHIP_PLAN §2 item 10（真实保护状态不变式）；macOS 引导页、仪表盘状态、菜单栏状态；MAC-PROTECTION-SCOPE-COPY（审计 Fable E1）。
- 来源：基线 `4fbf1e6a4`（main `0465af814` 之上仅含无关 Android 回归）→ 测试先行 RED 提交 + 实现提交（SHA 见 PR）；分支为 T3 worktree，尚未推送、未开 PR、未合 main。
- 缺陷修复：默认 AI 家宽会话连接后，徽章/指标显示 “Protected”、详情 “Traffic is routed / 流量已走受保护线路”，菜单栏 “Protected” → 改为 “AI protected / AI 已保护” 与 “Listed AI protected · other traffic direct / 名单内 AI 已保护 · 其他流量直连”；Stable 与 Three-tier 保持原文案。首次运行引导步骤 1/2（经典与海洋两套）从“所有流量都走受保护线路 / 先切断不让流量漏出去”改为“路由模式覆盖的流量”，标题不变。
- 新增/优化：`ProtectionScope` 只从连接时捕获的会话模式（`coreRuntime.routingMode`）推导，已保存的下次连接设置不能覆盖；状态优先级（disconnecting、connecting、重试等待、unconfirmed、Protected Offline、degraded）保持在已验证连接之前，这些状态不出现 AI 已保护字样。不改路由、PF、helper、连接生命周期、默认值或持久化偏好。
- 工程与测试：一个 XCTest `ProtectionScopePresentationTests`：AI 家宽会话 + 已保存 Stable 设置 → 菜单栏 `.connected` 标题 “AI protected”；degraded/unconfirmed 保持原标题；已保存 AI 家宽 + Stable 会话 → “Protected”。测试通过反射读 `LocalizedStringKey` 的 key，不依赖本地化包。
- 验证：本 Mac 不跑 xcodebuild/Swift（禁止）。已跑 `git diff --check`（0）、`python3 -I` 解析 `Localizable.xcstrings`（JSON 合法，1031 键，新旧键核对）、源码 grep 无旧句残留、`TonoTests` 与 `Tono` 为 pbxproj 同步目录（新文件无需注册）。未执行：hosted macOS XCTest RED/GREEN、`LocalizationCoverageTests`、渲染/截图测试、实机截图验收。
- 候选/发布：仅源码，无新候选。
- 剩余限制：海洋外观菜单栏头部（`MenuBarView.swift`，不在本次允许路径）已连接时仍只显示 “Connected”，无范围行；UI PR 需人工视觉验收；Windows 三层分流下的同句引导文案未改；决策 131 的验收清单未加入文案项（决策文件不在本次范围）。
