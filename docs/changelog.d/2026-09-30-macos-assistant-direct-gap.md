## 2026-09-30 · macOS 助手目的地先于托管直连
- 归属：SHIP_PLAN §2 item 10；macOS `ConfigPipeline+SingBoxProduct.swift` 与 `ConfigPipeline+Runtime.swift`；发现 MAC-ASSISTANT-DIRECT-GAP。
- 来源：基线 `50bbbbf0` → 分支 `hunt/grok-maccfg-assistant-direct-guard-89a9`（#867），未合 main。
- 缺陷修复：没有住宅跳时，sing-box 与 mihomo 生成器都不发出助手域名和 `160.79.104.0/21` 规则，理由是最终 MATCH 会把它们送进出口。已审核应用的进程直连和网页后缀直连是先匹配，会先于 MATCH 把这些目的地送出物理网卡。有住宅跳时域名规则只写了 TCP，同一进程的 UDP 仍走直连例外。现在无论有没有住宅跳，TCP 助手域名和该网段都先路由到住宅跳或 `Tono-Exit`；对应 UDP 在直连例外之前拒绝，QUIC 失败后回到已路由的 TCP。普通中国站点的直连不变。
- 新增/优化：无。
- 工程与测试：`SingBoxConfigTests.testAssistantDestinationsPrecedeReviewedBundleDirectWithoutAHomeHop` 断言无住宅跳时四条助手规则先于 `Tono-China-App`，且 mihomo 文本里同一标记先于 WeChat 进程规则。
- 验证：Linux 云代理无 Swift 工具链，XCTest 未在本地执行，由托管 macOS CI 验证。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需 `needs-hardware`。不能声称客户设备上的 QUIC 回退已实测。不改严格断网开关，也不把非助手流量改成拒绝。

## 2026-10-01 · 续记
- 合入当时的 `origin/main`。mihomo 的 `PROCESS-PATH-REGEX` 会把 `/` 和 `.` 写成 `\x` 转义（`rulePathRegex`），测试仍在找未转义的 `^/Applications/WeChat`，所以 `macos / build` 在 `XCTUnwrap` 失败。断言改为用 `rulePathRegex` 的实际载荷。
- `MultiExitPolicyTests` 里「无住宅跳就不写助手域名」与这次修复相反，已改为要求这些 TCP 行指向 `Tono-Exit`、UDP 行 `REJECT`，并且都排在审核包直连规则之前。
- 验证：本环境无 Xcode，`xcodebuild` 未跑。

## 2026-10-01 · 续记（策略测试）
- 再合入当时的 `origin/main`。`macos / policy-tests` 的 `assistant-destinations-precede-bundle-direct-without-home` 只报检查名。断言改为 `.literal` 搜索：每个助手域名和 `160.79.104.0/21` 的 TCP 必须指向 `Tono-Exit`、UDP 必须 `REJECT`，并且都在审核包直连之前；同一条字面规则不得指向 `Tono-China-App`、`Tono-China-Web`、`Tono-China-Direct`、`Tono-China-Web-Direct` 或 `DIRECT`。失败时带上后缀和那一行。
- 生成规则没有改。没有住宅跳时这些目的地仍然先于物理网卡直连。
- 验证：本环境无 Swift，`policy-tests` 未在本地执行。

## 2026-10-01 · 续记（括号）
- `macos / policy-tests` 报 `missing tcp anthropic.com`。生成行是 `DOMAIN-SUFFIX,anthropic.com)),Tono-Exit`（两个右括号）。断言写成 `"DOMAIN-SUFFIX,\(suffix)),Tono-Exit"`，Swift 把紧跟插值的那个 `)` 当成插值结束，实际查找的是只带一个右括号的字符串，所以永远匹配不到。三个查找都补上这个 `)`。
- 生成规则仍然没有改。助手域名和 `160.79.104.0/21` 不走物理网卡。
- 验证：本环境无 Swift，`policy-tests` 未在本地执行。
