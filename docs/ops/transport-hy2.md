# Hysteria2 三网证明（T0）

选定节点（2026-09-10，Panstar 机队）。口令不写在这里。

| 角色 | 实例 | 产品 | IPv4 | 系统 | 为什么选它 |
|---|---|---|---|---|---|
| 东京 / 三网直连 | `vm-Gk43AX` | JP Plus Nano | `45.8.173.206` | Debian 13 | Panstar JP Plus；流量约空；用来证明大陆 UDP |
| 洛杉矶 / 对照路径 | `vm-nvLHV3` | LAXPre Nano | `144.225.255.38` | Debian 12 | 同商家另一大洲；流量约空；1 GB 内存比东京那台宽裕 |

不选：JP Lite（不是三网直连）、Ubuntu 26.04、Debian 11、洛杉矶用量最高的那台。

## 装法（东京 vm-Gk43AX，2026-09-10）

- 官方 hysteria **v2.12.2** linux-amd64，systemd `tono-hy2.service`，用户 `tono-hy2`，`MemoryMax=80M`。
- 监听 **UDP `:443`**，与现有 `tono-xray` 的 **TCP `:443`** 共存。xray 全程 `active`，PID 未换。
- 自签证书 `CN=www.microsoft.com`，SAN `DNS:www.microsoft.com`。
- SHA-256 指纹：`E3:AA:4A:74:5A:A9:05:39:AB:1A:49:3D:94:0E:EB:A7:B4:30:5B:75:16:AB:84:16:7E:46:C9:8A:D9:FE:D3:DB`
- 本机 `hysteria ping` 经 `127.0.0.1:443` 和公网 IP 自连均成功（到 `1.1.1.1:443` 约 1ms）。OS 无 ufw / iptables 空。
- 洛杉矶那台**没有**装 hy2：它没有 VLESS，且同商家入站 UDP 同样被拦，装上去也测不出备用通道。

## 国内 TCP（杭州 `47.110.84.71`，只出站，未改该机业务）

| 目标 | TCP 22 | TCP 443 |
|---|---|---|
| 东京 `45.8.173.206` | 39ms 通 | **39ms 通**（xray Reality 仍在；错误 SNI 返回 TLS internal error，符合预期） |
| 洛杉矶 `144.225.255.38` | 132ms 通 | 超时（该机没有 443 监听） |

杭州直连 `google.com:443` 超时。主通道要从国内用，走东京 VLESS TCP，不是直连。

## Reality 是不是坏了（2026-09-11，杭州只出站）

有的客户能连、**移动用不了**，先分清是出口死了还是运营商路径把 Reality 拦了。杭州这台是 **AS37963 阿里云**，不是移动家宽，**不能代替移动实测**。探测未改该机 `ss-server`，东京/Dedirock `tono-xray` PID 未换（285119 / 658）。

| 从杭州看 | 东京 `45.8.173.206` | Dedirock `198.12.84.154` |
|---|---|---|
| TCP 443 五次 | 41–44ms 全通 | 140–170ms 全通 |
| SNI `www.bing.com`（与 Reality dest 一致） | TLS 1.3，证书 `CN=r.bing.com` Microsoft，校验 OK | 同上，`CN=r.bing.com`，校验 OK |
| 错误 SNI | `tlsv1 alert internal error`（Reality 预期） | peer reset（仍是活着的 443，不是超时） |
| 直连 `google.com:443` | 五次超时 | — |
| 直连 `www.bing.com:443` | 28–40ms 通 | — |
| hy2（UDP 443）经代理 ping `1.1.1.1:443` | 入站 UDP 仍被商家拦 | **5/5**，144–171ms；`google.com:443` 167ms |

结论：

1. **不是 Reality 服务挂了。** 两台出口都在用 `target/serverNames = www.bing.com`，从大陆云厂商把 dest SNI 打过去能拿到微软真证书。xray 日志这会儿只有本机 API 探活，当时没有已建立的客户 443 会话可按 ASN 分类。
2. **「有人能用、移动不能用」更像移动 DPI / 路径对 XTLS-Reality 不友好**（SNI 是 bing、IP 却不是微软），不是这两台机的 dest 配错。阿里云浙江复现不了移动。
3. 给移动的下一手是 **hy2**。东京 Panstar 入站 UDP 仍不通，移动即使用手选也选不到东京 hy2。大陆云厂商到 Dedirock hy2 通。家宽移动还要老板在移动网上走一遍 Dedirock hy2。自动切换仍默认关。生产目录仍不塞 hy2 块。

## UDP 结论：商家入站 UDP 被拦，自动切换不做

探测点都能发 UDP DNS（所以不是「这台机器不会 UDP」）：

| 源 | 到 `1.1.1.1:53` | 到东京 UDP 443 | 到东京 UDP 36712（临时 echo） |
|---|---|---|---|
| 杭州 `47.110.84.71` | 69ms 通 | 无回复；东京网卡未见包 | 无回复；东京网卡未见包 |
| 洛杉矶 `144.225.255.38` | 3ms 通 | 超时 | 超时 |
| 本云端（美国） | 4ms 通 | 超时 | 超时 |

东京本机 outbound UDP 到 `1.1.1.1:53` 通。公网 IP 自连 hy2 也通（走 loopback/hairpin）。因此服务端是活的，**包从外网进不了这台 VM**。

按 §2.6：任一运营商 `blocked` → **自动切换默认关**，目录可以稍后带手动块，发布说明写「本版备用通道仅手动」。在 Panstar 面板放行 **UDP 443**（以及若改端口则放行该 UDP 端口）之前，不要往生产目录塞 hy2 块。

## 结果表（三网客户路径）

杭州这一台阿里云不是电信/联通/移动家宽，不能填三网格子。能确定的是：**从大陆 TCP 到东京 JP Plus 通；从大陆/海外 UDP 到这台东京机都不通。**

| 运营商 | vm-Gk43AX 握手 5 次 | 30s 下载 | vm-nvLHV3 握手 5 次 | 30s 下载 | 结论 |
|---|---|---|---|---|---|
| 电信 | 未测（家宽） | | 未装 hy2 | | TCP 主通道可用（杭州样本）；UDP `blocked` |
| 联通 | 未测（家宽） | | 未装 hy2 | | 同上 |
| 移动 | 未测（家宽） | | 未装 hy2 | | 同上 |

家宽三网要老板在电信/联通/移动各走一次。在商家放行 UDP 之前，Panstar 预期仍是 `blocked`。

## Dedirock 对照（2026-09-10，`dedirock-727653400`）

老板给的现成 Tono Reality 出口，用来证明「不是大陆 UDP 废了，是 Panstar 没放行」。口令不写在这里。

| | |
|---|---|
| IPv4 | `198.12.84.154` |
| 系统 | Ubuntu 22.04，2 GB / 30 GB |
| 已有 | `tono-xray.service` TCP `:443`（PID 658，装 hy2 前后未换） |
| 新加 | `tono-hy2.service` UDP `:443`，hysteria v2.12.2，`MemoryMax=80M`，RSS ~24 MB |
| 证书 | `CN=www.microsoft.com` + SAN；指纹 `A4:A8:30:89:80:00:4C:8A:5C:DA:98:59:7B:87:98:66:71:F2:30:44:5D:F8:63:C2:3D:38:0F:01:2C:72:F9:09` |
| OS 防火墙 | ufw inactive，iptables ACCEPT |

杭州 `47.110.84.71`（只出站，ss-server 443/20000 未改）：

| 探测 | 结果 |
|---|---|
| TCP 443（VLESS） | 145ms 通，装 hy2 之后仍通 |
| 临时 UDP 36712 echo | 178ms 回包（商家入站 UDP 开着） |
| hy2 握手 5 次 | **5/5**，经代理 TCP 到 `1.1.1.1:443` 约 145–149ms |
| 经 hy2 到 `google.com:443` | **189ms 通**（直连 Google 仍超时） |

结论：大陆 UDP 到这家美国机可用。Panstar 东京仍被商家入站 UDP 拦住。自动切换默认关，直到家宽三网对 **这台 Dedirock**（或放行后的 Panstar）再测一轮。生产目录暂不塞 hy2 块（等 G2.6/G2.7 合进 `main`；本分支已做 Windows/macOS 准入与 Helper UDP 放行）。

## hy2 身份：全量 UUID，不是共享口令（G2.5）

目录合同是 `password: {{TONO_CLIENT_UUID}}`。Dedirock 手工 hy2 原先是 `auth.type: password` 加一份不在 42 个 VLESS UUID 里的共享口令，所以**客户 UUID 一个都认证不上**。手选「备用通道」对客户等于无效。

正确做法：

- 只读 `/opt/tono-xray/current/config.json` 的全部 VLESS `id`，写成 `/opt/tono-hy2/auth-allow.sha256`（只存 SHA-256）。
- 本机 sidecar `tono-hy2-auth` 绑 `127.0.0.1:18765`，Hysteria2 `auth.type: http`。
- 若 `config.yaml` / `/opt/tono-hy2/auth` 里还有旧共享口令，hash 也进 allowlist，ops 探测 yaml 仍能用。
- `--hy2-sync-identities` 默认 dry-run；`--apply` 等 18765 listen 再重启 `tono-hy2`，**不 stop / 不改 `tono-xray`，不覆盖已有 `tono-hy2.service` 单元**。
- 口令与 UUID 不准拷出盒子、不准进仓库。机上用 UUID 打 HTTP 鉴权；随机口令必须拒。

### Dedirock 已 apply（2026-09-10 / 11）

dry-run：`{"xrayClients":43,"xrayPid":658,"xrayUntouched":true,"dryRun":true}`（42 个 VLESS UUID + 1 个遗留 ops 口令）。

`--apply`：allowlist 43；`tono-xray` PID **658 未换**；`tono-hy2.service` ExecStart 仍是 `/opt/tono-hy2/bin/hysteria server -c /opt/tono-hy2/config.yaml`；`tono-hy2-auth` 听 `127.0.0.1:18765`。

本机（口令不离盒）：

| 探测 | 结果 |
|---|---|
| HTTP：已知 VLESS UUID | 接受 |
| HTTP：随机口令 | 拒绝 |
| `hysteria ping` 127.0.0.1 + UUID | 通，到 `1.1.1.1:443` |
| 同上 + 遗留 ops 口令 | 通 |
| 同上 + 随机口令 | 拒 |

杭州 `47.110.84.71` 只出站、`ss-server` 仍占 TCP 443 / UDP 20000：hy2 握手 **5/5**，经 hy2 ping `1.1.1.1:443` 约 150ms，`google.com:443` 通。探测文件用完已删。

**复检（2026-09-11，杭州只出站，业务未改）：** `ss-server` 仍占 TCP 443 / UDP 20000。东京 TCP 443 五次 41–44ms；SNI `www.bing.com` 仍是微软 `CN=r.bing.com`；错误 SNI 仍是 `tlsv1 alert internal error`。东京 hy2 证书 `CN=www.microsoft.com` / SAN `DNS:www.microsoft.com`；入站 UDP 443 仍超时。Dedirock TCP 443 144–175ms，同样微软 Bing 证书；hy2 握手 **5/5**（`1.1.1.1:443` 147–161ms），经 hy2 到 `google.com:443` 172ms。Dedirock xray PID **658**、hy2 **78067**、`auth.type: http` 听 18765，未动。东京 xray PID **285119** 未换；东京 `tono-hy2-auth` 仍 inactive（不要在那台上 apply）。直连 Google 仍超时。家宽移动仍未测。

同日稍后再探（仍只出站、未改杭州业务、未动 `tono-xray`）：杭州 `ss-server` PID 548 仍占 TCP/UDP 443，PID 7129 仍占 TCP/UDP 20000。东京 TCP 40–54ms；SNI `www.bing.com` TLS 1.3 证书仍是微软 `CN=r.bing.com`。东京 hy2 证书 `/opt/tono-hy2/tls/cert.pem` 仍是 `CN=www.microsoft.com` / `DNS:www.microsoft.com`；`tono-xray` PID **285119**；`tono-hy2` active、`tono-hy2-auth` inactive。Dedirock `tono-xray` PID **658**、`tono-hy2-auth` active。杭州经 Dedirock hy2 ping `1.1.1.1:443` **151ms 通**；探测目录已删。

东京不要跑 `--apply`：入站 UDP 仍被商家拦，改鉴权也测不出客户路径。生产目录仍不 PUT hy2 块。家宽移动还没走 Dedirock hy2。

**复检（2026-09-11，本云端美国，无杭州 SSH）：** 东京 / Dedirock TCP 443 通；SNI `www.bing.com` 仍是微软 `CN=r.bing.com`；错误 SNI `www.microsoft.com` 仍是 `tlsv1 alert internal error`。两台 UDP 443 仍超时。hy2 证书 SAN 仍是 provisioner 的 `DNS:www.microsoft.com`；从外网打不到 UDP，握手无法在本云确认。未改国内机、未动 `tono-xray`。

## Dedirock 五台 hy2（2026-09-11，给用户手选测）

四台新机 `--hy2 --apply` + `--hy2-sync-identities --apply`；Grove（`198.12.84.154`）原先就有，未再 `--hy2 --apply`。证书均为 `CN=www.microsoft.com` + `SAN DNS:www.microsoft.com`。UFW inactive。口令不写在这里。

| 目录基名 | IPv4 | xray PID（未换） | hy2 指纹（SHA-256） |
|---|---|---|---|
| Buffalo · Niagara | `23.94.79.123` | 335056 | `1E:53:74:A7:9B:DB:83:B0:4C:3D:3C:84:72:2C:03:21:1D:1C:94:1C:2D:E9:F9:24:31:D2:19:8B:A7:21:2C:AD` |
| Buffalo · Erie | `198.46.140.254` | 305356 | `4A:66:F1:06:76:CA:88:11:86:BE:35:0D:16:B3:F8:6C:B3:6F:9C:89:6E:F4:45:A6:92:D5:CC:0B:C8:B5:B2:01` |
| Los Angeles · Sunset | `192.236.205.232` | 130727 | `0F:F3:AB:6B:1B:EC:3A:37:66:F8:89:55:A8:40:64:AE:73:EA:47:24:CB:4D:86:02:78:0E:06:DF:BC:EC:EE:B7` |
| Los Angeles · Mesa | `107.174.123.27` | 137255 | `F5:97:31:34:7B:F0:68:D7:9F:9D:9E:78:C0:74:E4:68:6B:98:13:83:A5:C9:02:9A:56:50:E7:03:E6:AF:BA:41` |
| Los Angeles · Grove（`US-VLESS-Reality`） | `198.12.84.154` | 658 | `A4:A8:30:89:80:00:4C:8A:5C:DA:98:59:7B:87:98:66:71:F2:30:44:5D:F8:63:C2:3D:38:0F:01:2C:72:F9:09` |

杭州 `47.110.84.71` 只出站（`ss-server` PID **548** / **7129** 未换）：五台 `hysteria ping 1.1.1.1:443` 与 `google.com:443` 均为 **EXIT 0**。探测文件用完已删。xray PID 探测前后未换。

同日杭州复检东京 `45.8.173.206`：TCP 443 五次 70–96ms；SNI `www.bing.com` 仍是微软 `CN=r.bing.com`；入站 UDP 443 仍超时。Panstar 工单 **#529**（待处理）。东京不要 `--hy2-sync-identities --apply`。

本分支客户端把这五条 ` · hy2` 放在独立「备用 UDP」栏（城市 · 代号 · 备用通道）。新包目录 GET 带 `X-Tono-Accept: hy2`。五块私有 yaml 本地 `--dry-run` 已通过（5 个唯一名、各一个 `{{TONO_CLIENT_UUID}}`）。

**生产目录仍不 PUT。** 生产 Worker `GET /api/v1/health` 的 `buildSha` 仍是 `main` `2cef4eac`（第十四次控制面），没有 hy2 合同、也不会剥 ` · hy2`。`deploy-control-plane-main.sh` 只允许从已与 `origin/main` 对齐的 `main` 部署，**不要从本功能分支直接打生产**。顺序：把本分支的 Worker（hy2 合同 + `filterHy2CatalogForViewer` + `X-Tono-Accept`）合进 `main` → 老板跑生产部署 → `--append` 五块。先 PUT 会让 Sparkle 0.0.67 / 旧 Windows 吃到 `type: hysteria2` 后 fail closed。G2.8 自动切换仍关。家宽三网未测。
