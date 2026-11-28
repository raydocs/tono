## 2026-11-27 · PR 2：出口节点 `exit-agent` 与静态 `home-blackhole` 拓扑对账实现
- 归属：Ops 专项（[Node-Side Residential SOCKS5 RFC](../proposals/node-side-residential-socks5.md) PR 2）；影响模块 `services/exit-agent/`、`tooling/scripts/remote/`。
- 来源：`main @ 73ff1ea5c`（PR #1875 合入后）→ 分支 `feat/node-home-pr2-exit-agent`。
- 缺陷修复：在 `supported_api_commands` 中排除 usage 行的误匹配词元 `xray`。
- 新增/优化：
  1. **静态零 `geoip.dat` Fail-Closed 拓扑（[exit_metering_config.py](../../tooling/scripts/remote/exit_metering_config.py)、[enable-tono-exit-metering.sh](../../tooling/scripts/remote/enable-tono-exit-metering.sh)）**：在完全保持现有 `with_metering` 兼容与幂等性的前提下新增 `--node-home` / `with_node_home`，强制启用 `RoutingService`、index-0 `freedom`（tag `direct`）、`home-blackhole` 出站、`routing.domainStrategy = "AsIs"`、禁用 VLESS `sniffing` 覆盖，并固化前三条静态防漏规则（`tono-api-rule -> api`、`regexp:^h:` + 9 段字面量私网/CGNAT/环回 CIDR `-> home-blackhole`、`regexp:^h:` 兜底 `-> home-blackhole`），完好保留现有静态/手工客户。
  2. **双命名空间（`u:` / `h:`）与严格 RFC §4.3 编排（[reconcile_and_report.py](../../services/exit-agent/reconcile_and_report.py)）**：
     - 同一 PR 内同步扩展 `is_managed_label`、`client_label`/`home_client_label`、`attributed_user`、`aggregate_user_totals` 与 `reconcile` 吊销逻辑，`u:` 与 `h:` 统一计费不重复计费，并同步吊销失效 `h:` 标签；
     - `parse_roster` 严格校验成对的 `homeIdentities` 与 `homeOutbounds`（禁跨云端/家宽 UUID 复用、端口范围、非空凭证、不在异常中泄漏口令）；
     - 能力门禁仅在 9 项 API 命令齐备、`xray version` 命中 PR 0 已验证集合（`26.3.27`、`26.11.9`）且静态配置通过拓扑校验时在 `roster-ack` 上报 `nodeHomeCapable: true, meteringProtocolVersion: 3, nodeHomeXrayVersion`，并在首轮未收到 `homeOutbounds` 时不上报 `homeObservedAt`；
     - 严格按 `ado`（`0700` `.xray-staging` / `0600` 临时文件用后即删，且解析 `lso` 时永不打印口令）→ 全量替换 `adrules` → `lsrules` 与内置纯标准库 HTTP/2-gRPC `RoutingService/TestRoute` 验证 → `adu(h_label)` 顺序入站；解绑严格执行 `rmu(h_label)` → `adrules` → `rmo(home:<id>:<gen>)` 并持久队列上报 `drainedGenerations`；
     - `ROSTER_CACHE_VERSION` 升至 `2`，绝对禁止将 `homeOutbounds` 写入磁盘缓存，仅保留 `<= 300s` 且绑定 Xray `startMarker` 的非机密 `homeLease`，超时或 Xray 重启立即 `rmu` + 三规则锁死 + `rmo` 清理，同时保持 `u:` 云端 24 小时断网缓存；
     - 新增 `--withdraw-home` 平滑摘除 `h:` / `home:*` 并上报 `nodeHomeCapable: false`，同步在 `sync_hy2_roster` 拒绝任何家宽条目。
- 工程与测试：新增 3 项静态拓扑单测（[test_exit_metering_config.py](../../tooling/scripts/remote/test_exit_metering_config.py) 共 18 项）与 7 项 `exit-agent` 节点家宽全周期/断网租约/回滚单测（[test_reconcile_and_report.py](../../services/exit-agent/test_reconcile_and_report.py) 共 140 项）。
- 验证：本机通过 `test_exit_metering_config.py`（18/18）、`test_reconcile_and_report.py`（140/140）、`test_systemd_cadence.py`（5/5）、`test_probe_xray_capabilities.py`（6/6）、`test-suite-reachability.sh`（68/68），并在空 `XRAY_LOCATION_ASSET` 下驱动真实 `Xray v26.3.27` 与 `v26.11.9`（TLS + `xtls-rprx-vision`、直连回显、SOCKS5 `ATYP=0x03` 域名透传、字面私网 CIDR 黑洞截断、`u:+h:` 合并计量、解绑排空 `drainedGenerations` 与 `--withdraw-home`）全流程真流实测通过；`node tooling/scripts/records.mjs changelog` 与 `git diff --check` 通过。
- 候选/发布：仅 PR 2 节点 Agent 代码，默认分支尚未部署至线上 VPS；需配合 `enable-tono-exit-metering.sh --node-home` 灰度生效。
- 剩余限制：桌面端/移动端的 `homeTunnel` 与 `routingSha256` v2 消费将在 PR 3 / PR 3b 交付；线上灰度 `Los Angeles · Mesa` 验收将在 PR 4 完成。
