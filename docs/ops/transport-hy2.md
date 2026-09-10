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

东京不要跑 `--apply`：入站 UDP 仍被商家拦，改鉴权也测不出客户路径。生产目录仍不 PUT hy2 块。
