## 2026-10-10 · 第三台 API 中继（非 DMIT 商家）与每台中继独立的连接预算
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)（控制面可达）；[决定 089](../decisions/089-2026-10-10-third-api-relay-other-provider.md)
  （修订 077）；发现 [API-RELAY-SAME-PROVIDER](../findings.d/API-RELAY-SAME-PROVIDER.md)。不是 ship gate；是否进 0.0.75 由所有者另定。
- 来源：分支 `amp/third-api-relay`（[#1538](https://github.com/raydocs/tono/pull/1538)），合并 main `2ad39dba` 后改为新节点。
- 新增/优化：
  - 中继列表在两台 DMIT（Westwood、Mesa）之后追加第三台 **154.84.56.196:2053**（AROSSCLOUD AS400619，洛杉矶）：
    macOS `ControlPlaneRelays.swift`（app 与特权 helper 共用，helper 4.52.46 → 4.52.47，`CONTRACT.sha256` 重算）、
    Windows `service/src/lib.rs` `API_RELAYS`（WFP rule C 多一条同形状放行，`FILTER_NAMESPACE` v14 → v15 `…9e0e…`）、
    控制面 `api-relays.ts`、`cn_acceptance.py`、[api-relay.md](../ops/api-relay.md)。原选 38.14.195.144（Uscloud）入站 2053 被商家挡住，弃用。
  - macOS API 交换的中继连接预算改为每台 5 s（三台 15 s，`relayWalkBudget`），不再三台共用 5 s。
  - 中继规范配置加单地址并发上限 `limit_conn 256`；`apply-relay.sh` 在发行版已经加载 stream 模块时不再重复 `load_module`，并在缺 `logrotate` 时安装它（否则日志无上限）。
  - 控制面测试统一 mock `cloudflare:sockets`，任何测试都不再真的连网络。
- 节点（所有者经 Puck 批准，仅 2053 SNI 透传中继，2026-10-10 20:16 UTC）：Debian 13，安装 nginx / libnginx-mod-stream / logrotate
  时用 `policy-rc.d` 拦住自动启动并删除默认站点（80 从未监听），再跑规范 `apply-relay.sh`。之后只有 sshd 与 2053 在监听。
  回滚 `/root/tono-relay-rollback.sh`。未改防火墙、SSH、443，未部署出口。
- 工程与测试：macOS `testTheThirdRelayIsDialedAfterTheFirstTwoFail`；helper 自测的中继规则、列表与状态处置期望改为三台；
  Windows `the_third_relay_carries_the_request_after_the_first_two_fail` 与 WFP 中继放行固定表；`test_relay_stream_conf.py`
  加 `test_one_address_cannot_hold_more_than_256_relay_sessions`。
- 验证（2026-10-10）：节点本机经 2053 用 SNI `api.afk.ccwu.cc` 访问 `/api/v1/health` 200（证书校验通过），`releases.afk.ccwu.cc`
  握手成功（v1 清单未发布，404 符合预期）；陌生 SNI（www.npmjs.com、example.com）与无 SNI 均在握手前被关闭；从 orb 外部经
  154.84.56.196:2053 health 200；Globalping TCP 2053：电信、联通、移动 7 个探点 0 % 丢包、136–177 ms。本机 Linux：中继与 cn-acceptance
  Python 测试通过；Swift、Windows cargo 以托管 CI 为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：与 DMIT 同在洛杉矶（约 1 ms），区域级事故仍可能三台同时失效；国内家宽未实测（Globalping 为机房/骨干探点）；
  该主机无出口代理凭据，端到端探测不上报，只有 TCP 可达探测；Windows 启动恢复（30 s）在 Cloudflare 路径全断且两台 DMIT 都不可用时，
  第三台约 28 s 才轮到，可能来不及完成两次请求；DMIT 两台节点仍跑不含 `limit_conn` 的旧规范文件，需另行批准后再 `apply-relay.sh`。
