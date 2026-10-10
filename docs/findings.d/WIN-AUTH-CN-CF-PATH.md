| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-AUTH-CN-CF-PATH | 中国移动线路上 Windows 0.0.75 不开外网就无法登录（`TONO_AUTH_TCP`，`pinned=connect, system-dns=connect`）：登录传输链的固定 IP、系统 DNS、DoH、备用端口全部落在同一条到 Cloudflare 的运营商路径上，一断全断 | fixed(43476cb3) | [#1462](https://github.com/raydocs/tono/pull/1462)，[#1465](https://github.com/raydocs/tono/pull/1465)（Windows）；[#1463](https://github.com/raydocs/tono/pull/1463)，[#1464](https://github.com/raydocs/tono/pull/1464)（macOS） | 高·已确认（客户现场，1 用户；ASN 38019 上海移动） | 四个 PR 均已合 main（Windows `6c4ea897`、`43476cb3`；macOS `48894dd9`、`b4552c1e`），状态 2026-10-10 A15 补改；待实机：该客户的中国移动线路未在新包上复测，无候选包；中继只在未 armed 时可用（WFP/PF 放行表不加宽，decision 077）；第一次登录的用户要等 0.0.76 更新才带中继；中继两节点（Westwood、Mesa，2053；Windows 按序尝试，更新下载在直连确证未送达时也经中继，`fix/win-api-relay-followups-20261010`；登录已走中继的设备，更新检查第一跳即该中继，`amp/a1-updater-relay`）；两台都下线则回到今天的行为；mac 更新发现文档（manifest/签名）在直连未应答时经中继（`amp/a2-updater-relay`），mac 安装包下载在直连未应答时也经中继逐块落盘（同一签名大小上限、60 s 空闲/900 s 总时长，root 照旧校验包哈希，`amp/a2b-mac-package-relay`）；两端登录前自检（A4，`amp/a4-first-launch-probe`）：未登录启动时并行只做 TCP+TLS 握手探三条路径，结果存 24 h，第一次登录先走握手通的那条，免付死路径的连接超时 |

2026-10-10 现场：用户 Transport 行同时报 `pinned=connect` 与 `system-dns=connect`，国内探测点 TCP 443 可达
Cloudflare 固定 IP（移动约 190 ms），电信/联通完整 HTTPS 到 `api.afk.ccwu.cc` 28/36 成功，SNI 未被封；判断为
移动到 Cloudflare 的路径问题。服务端中继已于 2026-10-10 03:04 UTC 上线并从国内三网探测点验证可达。
