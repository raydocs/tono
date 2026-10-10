| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-AUTH-CN-CF-PATH | 中国移动线路上 Windows 0.0.75 不开外网就无法登录（`TONO_AUTH_TCP`，`pinned=connect, system-dns=connect`）：登录传输链的固定 IP、系统 DNS、DoH、备用端口全部落在同一条到 Cloudflare 的运营商路径上，一断全断 | in-PR | fix/win-api-relay-20261010 | 高·已确认（客户现场，1 用户；ASN 38019 上海移动） | 中继只在未 armed 时可用（WFP/PF 放行表不加宽，decision 077）；mac 客户端中继回退在 `fix/mac-api-relay-20261010`（PR 待开）；第一次登录的用户要等 0.0.76 更新才带中继；中继两台（Westwood 179.253.233.220、Mesa 179.255.154.17，均 2053；Windows 按序尝试，更新下载在直连确证未送达时也经中继，`fix/win-api-relay-followups-20261010`），两台同时下线则回到今天的行为 |

2026-10-10 现场：用户 Transport 行同时报 `pinned=connect` 与 `system-dns=connect`，国内探测点 TCP 443 可达
Cloudflare 固定 IP（移动约 190 ms），电信/联通完整 HTTPS 到 `api.afk.ccwu.cc` 28/36 成功，SNI 未被封；判断为
移动到 Cloudflare 的路径问题。服务端中继已于 2026-10-10 03:04 UTC 上线并从国内三网探测点验证可达。
