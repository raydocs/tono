# R3-M13-grok macOS 诊断与遥测（2026-10-01）

Fixer: Grok 4.7。范围：`CrashReporter.swift`、`DiagnosticsLogUploader.swift`、`DiagnosticsLogOwnership.swift`、`Diagnostics/*`、`LocalTrafficAudit*.swift`、`AppTrafficLedger.swift`、`ConnectionTelemetryBuffer.swift`、`AppRoutingResearch*.swift`、`AccountSession+Telemetry.swift`。基线：`origin/main` `414a7c87`。这些源文件相对上一轮 M13 报告之后没有再改。

上一轮已经修过游标停在整块非本 scope 前缀上（M13-G-F1，[#826](https://github.com/raydocs/tono/pull/826)，合入 `7947829d`）。本轮不再改那条路径。Codex 没有留下 M13 报告；覆盖表仍把这一档标成 GAP。

未改、未合并 [#724](https://github.com/raydocs/tono/pull/724)、[#725](https://github.com/raydocs/tono/pull/725)、[#734](https://github.com/raydocs/tono/pull/734)。

## 已修

无新缺陷。没有新 PR。

| 已在 main 或等待审阅 | 说明 |
|---|---|
| M13-G-F1 [#826](https://github.com/raydocs/tono/pull/826) | 已合入。空的 scope 过滤结果不再被当成 gzip 失败。 |
| [#725](https://github.com/raydocs/tono/pull/725) | 保护快照默认重新打开、失败上报跟随该开关、断网时最多 32 条进本机队列。这是待审的产品改动，不是 main 上已证实、可另修的缺陷。本轮不改 `AccountSession+Telemetry.swift`。 |
| [#724](https://github.com/raydocs/tono/pull/724) | Windows 侧的同类默认打开与队列。不在本档文件里。 |
| [#734](https://github.com/raydocs/tono/pull/734) | 运维控制台展示失败聚类。不在本档文件里。 |

## 未修的已证实缺陷

无。没有新 issue。

## 驳回

| 假设 | 为什么不是缺陷 |
|---|---|
| 周期窗口没有 `requestIsCurrent`，登出时会把上一账号的快照发给下一账号 | `authorizedRequest` 在取出 token 之后、`send` 之前检查 `credentialGeneration` 和 `isLoggingOut`。登出一开始就把 `isLoggingOut` 置上，换代发生在清 token 时。发不出去。 |
| 审计队列调用 `AppRoutingResearch.isCollectionActive` 会死锁 | 研究队列的 `sync` 不回调审计队列。研究 `record` 用 `async`。`setResidentialRouteContext` 的调用点在 AppState，不在审计队列里。 |
| `flushPending` 失败后队列无限增长 | 写入失败会把同一批放回去。`enqueue` 与 `flushPending` 都在同一条串行队列上，放回前队列是空的，条数和字节仍受 256 / 256 KiB 限制。 |
| `AppTrafficLedger` 的 `Int64` 加法会在主线程陷阱 | 计数来自本机核心的连接字节。一次会话到不了 `Int64.max`。没有一条现实路径。 |
| `/System/Volumes/Data/Users/<name>` 会把短名带进上传日志 | `displayProcessPath` 只改写 `/Users/<name>`。测试写明不在 `/Users` 下的家目录保持原样。没有证据表明 Mihomo 用 Data 卷路径填写 `processPath`。不扩大这条规则。 |
| 研究快照会上传任意主机名 | 只有 Claude/Anthropic 官方主机名原样进入快照。其它目的地收成 `other`。进程路径不进研究载荷。 |
| 崩溃面包屑或 `coreErrors` 带出令牌 | 标签白名单。异常原因只留在本机摘要。`coreErrors` 最多 20 条、每条 200 字，并且跟着同意开关。 |
| 遥测或崩溃处理会切断网络 | 失败路径注释写明不拆除保护。`fail` 在账号丢失时停 sidecar，PF/DNS 按既有杀开关规则留着。本档没有新的放行或加严。 |

上一轮报告里的 15 条驳回仍然成立，这里不重复展开。

## 验证

读了清单里的源文件，以及同意、scope、上传闭环（`AccountSession+Telemetry`、`TonoAPIClient` 的代际检查）。未跑 XCTest：本机没有 Xcode。没有产品补丁。

## 合并

本报告 [#973](https://github.com/raydocs/tono/pull/973) 不开 auto-merge。
