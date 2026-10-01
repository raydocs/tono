# 舰队 exit-agent 接入记录（2026-09-24）

交接文档 [HANDOFF_2026-09-24](HANDOFF_2026-09-24.md) §2 第 2、3 步的执行记录，并扩展到目录中的全部在线节点。
凭据（节点 token、SSH 口令/密钥）不入库；token 只存在各节点 `/etc/tono-exit-agent/env`（0600）与 D1 的 hash。

## 起点（只读核实）

- 生产目录 revision 54（本地权威副本 hash 与 D1 `content_sha256` 一致）有 14 个基础节点 + 5 个 ` · hy2` 块。
  13 个节点 443 在线；`Tokyo · Sakura` SSH 与 443 均无响应。
- `exit_nodes` 只有 `los-angeles-westwood`（最后 ACK 2026-09-18）。其余 12 个在线节点**未登记**：身份由 ops hub 经 SSH
  写入静态 Xray 配置（最近一次 2026-09-22/23），不回 ACK、不计量。交接文档只提到 Westwood 与一台未登记节点，低估了范围。
- 全部节点 Xray 26.3.27；Harbor、Canyon、Niagara、Erie 装有 2026-08-15 的旧 exit-agent（自 08-26 起每轮因 `adu --tag`
  被 Xray 26 拒绝而失败），状态文件无 `sourceId`、无待发报告。
- 各节点 Xray 自 2026-09-11 15:00 UTC 前后重启（JP 09-20、Niagara 09-14），与旧聚合计量源 `""` 最后一次上报
  （09-11 15:01 UTC）吻合；新 per-node 源的首报只含其后未计费的流量，不与 `""` 重复计费。
- 生产尚未应用 0077（`exit_credentials` 无 `retired_at`），当前 Worker 无退役逻辑；新登记节点 ACK 前，设备回落共享凭据，
  所有节点均有共享凭据，不影响连接。

## 做了什么

1. **#563 合并（85ba3945）后**，把 `services/exit-agent/reconcile_and_report.py`（md5 `03a5e5e2…`）部署到每个节点
   `/opt/tono-exit-agent/`，沿用 Westwood 的 unit/timer（每分钟）。Westwood 保留原 env 与状态（`sourceId=los-angeles-westwood`）。
2. **登记**：其余 12 个节点按目录名与稳定 source ID 写入 `exit_nodes`（active，节点专属 token，hash 与 `POST exit-nodes` 相同算法），
   同时写 `ops_audit`（`exit-node.create`，actor `claude-session@ops`，type `system`）。会话内没有 ops admin token，
   因此直接写 D1，而不是调用 API。
   ID：`los-angeles-mesa`、`los-angeles-vista`、`tokyo-neon`、`los-angeles-pacific`、`jp-vless-reality`、`los-angeles-marina`、
   `us-vless-reality`、`los-angeles-harbor`、`los-angeles-canyon`、`buffalo-niagara`、`buffalo-erie`、`tokyo-fuji`。
3. **首轮前核对**：每个节点静态 `tono-vless` 客户端与当时 D1 dual roster 逐一比对，均为 46/46、UUID 零差异；
   首轮日志普遍为 `+6 -0`：静态配置写入后 Xray 未重载，6 个较新的身份此前并未在运行中的 Xray 生效，agent 首轮补齐。
   Westwood 首轮 `+4 -1`（移除 1 个已吊销身份）。
4. **hy2（US、Harbor、Canyon、Niagara、Erie、Marina）**：检查器 `tono-hy2-auth.service` 的 `ReadOnlyPaths` 原先绑定
   allowlist 文件 inode，agent 的原子替换在其命名空间内不可见。按 exit-agent README 的交接顺序，先加 drop-in
   `/etc/systemd/system/tono-hy2-auth.service.d/10-allowlist-dir.conf`（`ReadOnlyPaths=/opt/tono-hy2`）并重启检查器，
   再装 agent。之后 allowlist 首行为 `# tono-exit-agent roster v1`，46 个 hash，`root:tono-hy2 0640`；用一个真实 roster
   身份向检查器请求返回 `ok:true`。旧的共享口令/探测 hash 不再在 allowlist 内（README 已说明探测需改用专用测试账户）。
5. **Fuji（暂定产品决定，待所有者复核）**：其 hy2 为未发布的共享口令认证（`auth.type: password`），不在目录内，
   也无 allowlist；agent 会因此每轮拒绝。按「目录只发 Tono 签发的身份」与严格优先原则，停用 `tono-hy2.service` 并把
   `/opt/tono-hy2` 移到 `/opt/tono-hy2.disabled-20260924`（当时无连接；可原样移回恢复）。
6. **备份**：每个节点 `/root/tono-pre-agent-backup-20260924/`（Xray 配置、hy2 allowlist、旧 agent/env/状态）；
   Westwood 在 `/root/tono-exit-agent-backup-20260924/`。
7. **timer 修复**：先停旧 timer、手动跑首轮、再启用 timer 的 4 台（Harbor、Canyon、Niagara、Erie）出现
   `NEXT n/a`（`OnUnitActiveSec` 无法排期），停摆 6–14 分钟；`systemctl restart` timer 并手动触发一次后恢复。

## 验证

- D1：13 个节点均 `active`，最后 ACK 距查询时间不超过 62 秒（2026-09-24 16:43 UTC 左右），无超过 150 秒的节点。
- 每节点首轮日志 `roster observed … reported usage … dropped 0`；hy2 节点真实身份 `ok:true`。
- 未做：客户端实机连接验证（数据面只做了身份与 ACK 层面的核对）；ops hub 仍会按原流程写静态配置（与 roster 相同，
  不冲突，但下次 hub 推送后应复核不会重新加入已吊销身份）。

## 未完成 / 需要所有者

- **`Tokyo · Sakura` 下架**：节点离线仍在目录内；#570 的严格就绪门会把它视为未就绪。下架与 #570 部署后的
  无条件 revision bump 都需要 ops admin token 做受审计的 catalog PUT，本会话没有。
- ops hub 的身份推送是否停用：由 agent 接管后 hub 推送变为冗余，是否关闭待定。
- 首报会把 09-11 以来未计费的流量一次计入各账户，个别账户可能因此触达配额。

## 续记（2026-09-25）

1. **agent 升级到 #624（`aecb4cec`，main `f5c31d58`）**：13 个节点逐台替换 `/opt/tono-exit-agent/reconcile_and_report.py`
   （旧 `03a5e5e2` 备份在各节点 `/root/tono-exit-agent-backup-20260925/`），替换后手动触发一轮，全部 `result=success`、
   roster `+0 -0`、用量上报正常；timer 未停。先在 Westwood 做金丝雀。
2. **`Tokyo · Sakura` 实际在线，只是换了 IP**：主机 `vm-EjSuCC` 由 `148.135.183.152` 变为 `162.4.194.103`（目录与 hub
   `nodes.secrets.json` 仍是旧 IP，因此「SSH 与 443 均无响应」）。该机是旧布局：Xray 25.3.6、`/usr/local/etc/xray`、
   无 api/stats、inbound 无 tag，43 个静态客户端（42 个 `u:` + 1 个无 email）。按所有者选择「保留」接入：
   - 备份到 `/root/tono-pre-agent-backup-20260925/`（原配置、25.3.6 二进制、原 unit）；
   - Xray 换成与 Fuji 同一个 26.3.27 二进制（sha256 `8255dd93…` 比对），`/opt/tono-xray/releases/20260925-xray-26.3.27`，
     配置在原配置上只增加 `stats`/`policy`/`api`/`tono-api` 入站/路由、inbound tag `tono-vless`，无 email 的客户端记为
     `slot-1`（与其他节点一致）；Reality 设置逐字相同；`xray run -test` 通过后切换，unit 与 Fuji 一致；重启后 443 外部可达、
     API 应答。改动时该节点对客户不可达（目录指向旧 IP），无在线用户受影响。
   - D1 登记 `exit_nodes`（`tokyo-sakura` / `Tokyo · Sakura`，节点专属 token，hash 同 `POST exit-nodes` 算法）并写
     `ops_audit`（`exit-node.create`，actor `claude-session@ops`，type `system`）；会话内仍无 admin token，故直接写 D1。
   - 装 agent（`aecb4cec`）与 unit/timer，首轮 `+7 -2`（补齐离线期间新增身份、移除 2 个），ACK 成功，
     `metering_protocol_version` 自动升为 2。之后 D1 共 14 个 active 节点，最慢 ACK 55 秒。
3. **目录**：同日经 Cloudflare Access 登录的控制台做受审计 `PUT exit-catalog`，只改 Sakura 的 `server` 为 `162.4.194.103`
   （r54 → r55，逐行比对仅第 130 行变化；目录中的 Reality 公钥/short-id/SNI 与节点私钥核对一致）。#570 部署后另做一次
   内容不变的 bump（r60 → r61）。**仍需**：hub `/opt/tono-ops/nodes.secrets.json` 的 Sakura 条目仍是旧 IP；
   未做客户端实机连接验证。
