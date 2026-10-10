## 2026-10-10 · API 中继后续：第二节点、安装包 SNI、路径头、mac 记忆与合并报错
- 归属：SHIP_PLAN §2 item 10 续（#1462 / #1463 同根因；所有者 2026-10-10 「继续做 123456」）；节点 Westwood、Mesa；
  macOS `apps/macos/Tono/Services/{ControlPlanePath,TonoAPIClient}.swift`；运维手册 `docs/ops/api-relay.md`、
  `tooling/ops/relay/`。Windows 端与控制面在各自 PR（`2026-10-10-win-api-relay-followups.md`、
  `2026-10-10-cp-api-relay-observability.md`）。
- 来源：基线 48894dd90（main）→ 分支 `fix/mac-api-relay-followups-20261010`；PR 待开；未合 main。
- 新增/优化（节点，已上线 2026-10-10 03:59 UTC）：两台 DMIT 节点改为 `include /etc/nginx/tono-relay.stream.conf`
  （规范副本 `tooling/ops/relay/tono-relay.stream.conf`，`apply-relay.sh` 备份→装模块→`nginx -t`→reload，失败自动还原）；
  放行 SNI 增加 `releases.afk.ccwu.cc`（安装包下载）；access_log 只记命中 SNI 的会话。第二节点 Mesa 179.255.154.17:2053
  上线（`libnginx-mod-stream` 新装）。
- 新增/优化（macOS）：中继列表加 Mesa；每次尝试带 `X-Tono-Path: <路径标签>` 请求头；记住的路径写入 app profile
  （按主机键，24 小时过期），下次启动先走它；`control_plane_path_failed` 审计加 `duration_ms`；三条路径都失败时
  传输错误与 `control_plane_transport_failed` 审计的 `detail` 为 `system_dns[…]; pinned[…]; relay[…]`（域/码不变，
  重试规则与时钟判断照旧）。
- 工程与测试修正：现有回归补 header 断言；新增 `testARememberedPathIsTriedFirstByANewClientForTheSameHost`、
  `testEveryPathFailureIsNamedWhenNoPathAnswers`。
- 验证：节点 2026-10-10 03:59 UTC 两台 `nginx -t` 通过、reload、`tono-xray` active；本机经两台中继 api 200 /
  releases 206（Range 0-1023）/ 错 SNI 0 字节关闭且不进日志；ping.pe `tcp 179.255.154.17:2053` 国内全部探测点可达
  （移动 171–182 ms）。macOS 测试仅 hosted CI：待记。
- 候选：仅源码，无新候选。
- 未做：mac 登录页没有 Windows 那样的支持信息行（UI 改动另议）；现场（移动线路）确认待客户装新版。
