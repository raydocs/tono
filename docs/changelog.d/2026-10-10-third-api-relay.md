## 2026-10-10 · 第三个 API 中继（San Jose · Uscloud，另一家服务商）
- 归属：运维计划 [docs/ops/plan-2026-09-11.md](../ops/plan-2026-09-11.md)（API 中继，决定 077 的补充
  [089](../decisions/089-2026-10-10-third-api-relay-other-provider.md)；所有者 2026-10-10 经 Puck 批准）；macOS
  `apps/macos/Tono/Services/ControlPlanePath.swift`，Windows `apps/windows/app/src-tauri/src/tono/bootstrap.rs`，
  控制面 `services/control-plane/src/api-relays.ts`，运维手册 `docs/ops/api-relay.md`。
- 来源：基线 3d973f95（main）→ 分支 `amp/third-api-relay`；草稿 PR；未合 main。外部验收通过前不合并。
- 缺陷修复：无。
- 新增/优化：中继列表在两台 DMIT（Westwood、Mesa）之后追加第三台 38.14.195.144:2053（Uscloud AS402169，San Jose；
  不同服务商/ASN/城市，非出口节点）；三端顺序一致，第三台排最后。控制面 cron TCP 探测与运维台「API 中继」卡片多一行；
  该主机无出口节点 token，`exitNodeId` 为空，不接受端到端上报，告警只看 TCP。macOS API 请求的中继连接预算由
  「全部中继共 5 s」改为「每个中继 5 s」（三台共 15 s，与更新包下载一致）；Windows 仍每个 4 s（共 12 s）。
  WFP/PF 放行表不变。
- 工程与测试：新增 XCTest `testTheThirdRelayIsDialedAfterTheFirstTwoFail`、Rust `#[test]`
  `the_third_relay_carries_the_request_after_the_first_two_fail`；更新 `NativeUpdateDownloadTests` 中继标签顺序、
  `ops-nodes.test.ts` 中继列表。
- 验证：Linux orb，`services/control-plane` `npx vitest run test/ops-nodes.test.ts test/api-relays.test.ts
  test/ops-verdict-run.test.ts test/ops-api.test.ts`：4 files / 64 tests passed；`npm run typecheck` exit 0。
  macOS XCTest、Windows `cargo test` 仅 hosted CI（ci-gate），本机未执行。节点侧（协调会话 2026-10-10 部署）：节点本机
  验证通过；外部 Globalping TCP 2053 美/德/中 100% 丢包（443 正常），服务商网络防火墙未放行 2053，待所有者打开。
- 候选：仅源码，无新候选。客户端要等下一次客户端发布才带上第三台；Worker 探测与卡片在下一次控制面部署后生效。
- 剩余限制：外部验收（允许的 SNI TLS + `/api/v1/health` 200 经 38.14.195.144:2053；未知/缺失 SNI 被拒）未完成；
  第三台无端到端监控（需要中继专用凭据）；节点的 `limit_conn`/systemd 限额不在规范配置文件中；macOS 只记住「relay」
  不记哪一台，Westwood 宕机时已走中继的 Mac 每次请求最多多等 5 s。#1507（`ControlPlaneRelays.swift` 共享列表）
  rebase 时必须包含第三台。
