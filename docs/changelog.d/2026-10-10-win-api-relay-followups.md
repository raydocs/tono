## 2026-10-10 · Windows 中继后续：第二中继、X-Tono-Path、更新下载走中继
- 归属：SHIP_PLAN §2 item 10（「连不上且无下一手」；#1462/#1463 后续，所有者 2026-10-10「继续做 123456」）；
  Windows 客户端 `apps/windows/app/src-tauri/src/tono/{bootstrap,transport}.rs`、`tono/commands/update.rs`。
- 来源：基线 48894dd90（main）→ 红 337b225af、修复 307224ff6；分支 `fix/win-api-relay-followups-20261010`，PR #1465；未合 main。
- 缺陷修复：[WIN-AUTH-CN-CF-PATH](../findings.d/WIN-AUTH-CN-CF-PATH.md) 的两处剩余限制。原：中继只有 Westwood
  一台，节点下线即回到无中继的行为；更新器（发现文档、签名、安装包）只走直连，Cloudflare 路径不通的客户拿不到
  带中继的新版本以外的任何更新。改后：`API_RELAYS` 为 Westwood 179.253.233.220:2053 与 Mesa 179.255.154.17:2053，
  按序尝试，每台 4 s 连接预算不变；更新器的 GET 在直连确证未送达（`should_retry_transport` 的 GET 规则，连接前
  无任何响应）时，按序经中继各重发一次（上次应答的中继排第一），主机名、SNI、证书校验不变，安装包的签名/大小
  校验不变；HTTP 状态码是应答，不重发。
- 新增/优化：控制面请求每次尝试带 `X-Tono-Path: pinned|system_dns|relay|doh|alt_port|tunnel`（按承载该次尝试的
  路径，同一请求换路重发时换值），只含路径名，无账号或网络数据；供控制面记到设备行，区分中继来源 IP 与出口节点。
  WFP bootstrap 放行表不变（armed 时中继不可用，fail-closed 不放宽）；登录 POST 仍只在确证未送达时换路。
- 工程与测试：`dead_cloudflare_paths_fall_back_to_a_relay` 断言中继收到 `X-Tono-Path: relay`；新增
  `an_undelivered_discovery_get_falls_back_to_a_relay`（直连黑洞，第一中继拒绝，第二中继应答，Host 保持发布域名，
  应答中继被记住）。先提交测试（红），再提交修复。
- 验证：hosted CI only, run ids：红 38023043017（337b225af，`windows / app-rust` 编译失败 `error[E0425]: cannot find function get_with_relays in this scope`，符合预期）；绿 38023044674（307224ff6，ci-gate success，`an_undelivered_discovery_get_falls_back_to_a_relay ... ok`、`dead_cloudflare_paths_fall_back_to_a_relay ... ok`，680 passed）。独立审查 Grok jev-route 28ee2af5 PASSED，0 findings（覆盖 307224ff6）。本机未运行 cargo（AGENTS.md：MacBook 不跑原生 cargo）。
- 候选：仅源码，无新候选。
- 未做：控制面记录 `X-Tono-Path` 到设备行（另开 PR）；macOS 客户端第二中继与路径头；移动线路实机验证。
