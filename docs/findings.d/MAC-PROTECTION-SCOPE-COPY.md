| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PROTECTION-SCOPE-COPY | macOS 首次运行引导承诺“所有流量走受保护线路、线路失败先切断一切”，已连接后仪表盘徽章/指标和菜单栏只显示无范围的“Protected”，而默认 AI 家宽会话只保护名单内 AI、普通流量直连且退出不锁网（决策 130/131） | in-PR | [#1724](https://github.com/raydocs/tono/pull/1724) | 中·推导 | 海洋外观菜单栏头部仍只显示“Connected”，没有范围说明行（`MenuBarView.swift` 不在本次范围）；文案改动未经实机截图验收；Windows 三层分流下的同句引导文案（审计 E1 的 P3 部分）未改 |

依据：2026-10-23 产品审计 Fable E1（`/tmp/tono-product-audit-20261023/experience-fable.md`），主会话按源码核对：
`WelcomeIntroView.swift` 两套引导步骤（经典 `points` 与 `SeaIntroStep.detail`）都写整机承诺；`DashboardView.swift`
的 `statusBadgeTitle`/`protectionValue`/`protectionDetail` 与 `MenuBarProtectionStatus.swift` 的 `.connected` 分支
不看会话模式；视图层只有 `SettingsView.swift` 读 `coreRuntime.routingMode`。

修复（基线 `4fbf1e6a4`）：新增 `ProtectionScope`（`apps/macos/Tono/Views/ProtectionScope.swift`），只从
`appState.coreRuntime.routingMode`（连接时捕获的会话模式）推导，不读已保存的 `desktopRoutingMode` 设置。
已验证连接且会话为 `ai-home` 时：徽章/指标为 “AI protected”（AI 已保护），详情为
“Listed AI protected · unmatched traffic direct”（名单内 AI 已保护 · 规则外流量直连），菜单栏标题同样为 “AI protected”；
Stable/Three-tier 保持 “Protected”/“Traffic is routed”。状态优先级不变：disconnecting、connecting、重试等待、
unconfirmed、Protected Offline、degraded 仍先于已验证连接，这些状态不出现 AI 已保护字样。引导步骤 1/2 改为
模式中性（“路由模式覆盖的流量”），两套标题同步改为“按模式保护流量 / 不悄悄改走直连”。回归：`ProtectionScopePresentationTests`（RED 提交先行）。

独立审查 R1（覆盖 `6850784b2`）纠正：Dashboard 详情也必须先判 disconnecting、connecting、重试等待；
静态生产投影供视图与回归共用，覆盖 connect tail 中 Connected 与 Connecting/degraded 并存的状态。
“其他流量直连”改为“规则外流量直连”，保留决策 130 中视频/海外站点的云出口例外，不改路由。
原模式回归 RED：run [39919244126](https://github.com/raydocs/tono/actions/runs/39919244126)，
实际断言 `Protected != AI protected`；原 head `6850784b2` GREEN 为
[39919786180](https://github.com/raydocs/tono/actions/runs/39919786180)。新过渡态回归及修正的 RED/GREEN 待补。
