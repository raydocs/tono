## 2026-10-10 · 两端客户端发送 `X-Tono-Path-Failed`（ASN × 路径成功率的数据来源）
- 归属：运维计划 [§2](../ops/plan-2026-09-11.md)（中继可观测）；[待办](../ops/amp-backlog-2026-10-10.md) A8 的客户端续作；
  `apps/macos`（`TonoAPIClient.exchangeOverPaths`）与 `apps/windows`（`src-tauri/src/tono/transport.rs` 路径遍历）。
- 来源：基线 main `a32d3fed`（#1498 已合）→ 分支 `amp/a8b-path-failed-header`；PR 见正文；未合 main。
- 缺陷修复：无。#1490 的服务端已经读这个头，但没有客户端发送，`GET /api/v1/ops/api-paths` 每行成功率都是「无数据」。
- 新增/优化：
  - 按[决策 080](../decisions/080-2026-10-10-api-path-failure-header.md)：每次在某条路径上（重新）发出的控制面请求，除已有的
    `X-Tono-Path` 外都带 `X-Tono-Path-Failed: <本请求此前失败过的路径，逗号分隔>`；没有失败时头存在且为空（即「上报客户端」）。
    只含词表标签（`pinned|system_dns|relay|doh|alt_port|tunnel`），按尝试顺序、去重（Windows 多个备用端口只记一次 `alt_port`），
    最长 43 字符（服务端上限 96）；不含地址、耗时、错误文字或账号信息。
  - 范围是一次路径遍历（macOS 一次 `exchangeOverPaths`，Windows 一次 `TonoTransport::send`）：外层重试重新开始，
    与服务端「这次到达之前输掉的路径」的定义一致，也与 Windows 每次 `send` 的作用域一致。
  - 只加在控制面传输上：更新器的元数据请求（`NativeUpdateDownload`，发布主机）不带 `X-Tono-Path` 也不带本头；服务端只在
    `recordClient`（登录、刷新、目录）读它。macOS 没有备用路径的调试/测试主机分支现在也带 `X-Tono-Path: system_dns` 和空的本头。
  - 路径顺序、重试规则、首选路径记忆均未改变。
- 工程与测试：macOS 一个 XCTest（`AccountSessionRequestTests.testEachAttemptNamesThePathsItsRequestAlreadyLost`：首试成功经真实
  URLSession 到本机监听器，线上读到空头；系统解析被拒后固定地址收到 `system_dns`）；Windows 一个 `#[tokio::test]`
  （`each_attempt_names_the_paths_its_request_already_lost`：固定地址丢包后系统解析收到 `pinned`，第二次首试成功收到空头）。
- 验证：本机（Linux）不能运行 Swift / Windows `cargo`；两项测试由托管 CI（macos-26、windows-2025）运行，结果见 PR。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：经 Cloudflare 边缘时空值请求头是否原样交给 Worker 未在生产实测；服务端 `clientPathFailures` 读码把空值读作 `[]`（上报），但 `api-paths.test.ts` 没有空值用例；上线后看 ops 节点页
  「客户网络 × 控制面路径」表的 `ok` 是否开始增长。计数单位仍是服务端的「设备 × 路径 × 小时」打戳。
