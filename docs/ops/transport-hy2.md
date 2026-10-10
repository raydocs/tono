# Hysteria2 三网证明（T0）

## 2026-10-10 三网公共探针（A16 第 1 步）

[Amp 待办](amp-backlog-2026-10-10.md) A16，D2-A。本轮**没有 SSH 到任何节点**，节点侧未改，443 上的 `tono-xray`
只被做了 TCP 建连（不发数据）。数据来自公开测量网络 [Globalping](https://globalping.io)（匿名 API，每小时 250 次测试，
无账号、无密钥），探针按运营商主 ASN 选：移动 AS9808、电信 AS4134、联通 AS4837，每个节点每家 3 个探针。
复跑脚本 [`tooling/ops/hy2/globalping_carriers.py`](../../tooling/ops/hy2/globalping_carriers.py)；每次的 measurement ID
与逐探针结果在 [evidence/2026-10-10-hy2-carriers](evidence/2026-10-10-hy2-carriers/)。时间 2026-10-10 10:14–10:20 UTC，
共用 181 次测试（含 1 次试跑）。

每个节点在同一组探针上跑四项：ICMP ping 5 包；TCP 443 建连 5 次（Reality 主通道的对照）；mtr UDP 到 hy2 端口
（443/UDP）；mtr UDP 到一个没人监听的对照端口 33434。hy2 服务端对非 QUIC 的包不回任何东西，所以 hy2 端口那条
mtr 最远只能看到主机前一跳。判定：

- `host-edge`：hy2 端口的 UDP 包到了主机门口——最后应答的一跳在主机的 /24（网关），或与同一探针对照端口路径上
  紧挨主机的那一跳同属一个网络（同一家转接商的交接路由）。
- `target-replied`（对照端口）：主机本身回了 ICMP 端口不可达，即 UDP 包确实送进了这台机器。
- `left-china`：出了中国运营商网络（含 CMI/CN2/CUG 的国际段）但没到主机门口；`unclassified`：该探针没有 ASN
  数据；`probe-lan`：探针自己的内网就不再应答；`no-reply`：第一跳都没应答。

### 测了哪些节点

库里有 IPv4 且 9 月 24 日记为装有 hy2 的四台，hy2 均为 UDP 443（见下文「部署之后怎么 append」表）：
`Buffalo · Niagara` `23.94.79.123`、`Buffalo · Erie` `198.46.140.254`、`US-VLESS-Reality`（Grove）`198.12.84.154`、
`Los Angeles · Marina` `144.225.255.114`（Marina 第一轮有两个探针结果不可用，补跑一轮）。

没测：Harbor、Canyon（9 月 24 日记为有 hy2，但 IP 不在库里）；Sunset、Mesa（9 月 11 日装过 hy2，9 月 24 日的 hy2
名单里没有它们）；东京 `45.8.173.206`（商家拦入站 UDP，工单 #529，未知是否已放行）。

### 汇总（节点 × 运营商）

| 节点 | 运营商 | 探针 | ICMP 均值 | TCP 443 均值（最小） | hy2 端口 UDP 路径 |
|---|---|---|---|---|---|
| Niagara | 移动 | 南宁、上海、台山 | 267–309 ms | **1111–4351 ms**（244–277） | 3/3 host-edge |
| Niagara | 电信 | 广州、桂林、西安 | 209–219 ms | 216–230 ms（206–224） | 2/3 host-edge，1 unclassified¹ |
| Niagara | 联通 | 长沙、南宁、西安 | 202–269 ms | 247–263 ms（223–259） | 3/3 host-edge |
| Erie | 移动 | 北京、昆明、南宁 | 231–304 ms | **231–2359 ms**（230–314） | 2/3 host-edge，1 left-china² |
| Erie | 电信 | 东莞、广州、南京 | 220–261 ms | 225–226 ms（211–218） | 2/3 host-edge，1 unclassified¹ |
| Erie | 联通 | 长沙、桂林、西安 | 248–264 ms | 247–253 ms（224–240） | 3/3 host-edge |
| Grove | 移动 | 南宁、上海、台山 | 185–200 ms | **1206–2656 ms**（**1190–1200**） | 3/3 host-edge |
| Grove | 电信 | 东莞、广州、南京 | 171–175 ms | 171–185 ms（168–174） | 3/3 host-edge |
| Grove | 联通 | 长沙、桂林、西安 | 174–223 ms | 191–219 ms（178–196） | 3/3 host-edge |
| Marina | 移动 | 广州、昆明、南宁、上海、台山（两轮 6 次） | 153–173 ms | 148–175 ms（145–173） | 4/6 host-edge，2 no-reply³ |
| Marina | 电信 | 东莞、广州、南京、西安（两轮 6 次） | 141–169 ms | 139–169 ms（137–161） | 6/6 host-edge |
| Marina | 联通 | 长沙、桂林、南宁、芜湖（两轮 6 次） | 164–186 ms | 168–181 ms（162–176） | 5/6 host-edge，1 probe-lan⁴ |

共 45 条 hy2 端口路径，39 条 host-edge。不同探针合计：移动 6 个城市、电信 5 个、联通 5 个。

1. 电信广州那个探针没有 ASN 数据；原始 hop 显示 hy2 端口的包已到 Cogent 布法罗（`buf02.atlas.cogentco.com`），
   与对照端口路径上主机前一跳是同一段，对照端口主机已应答。
2. 移动北京到 Erie：两条 UDP 路径都停在 Cogent AS174（231 ms），对照端口主机也没回；ICMP 与 TCP 都正常。
3. 移动广州那个探针两轮都是**第一跳就不应答** UDP 443，而同一探针到同一节点的对照端口 UDP 能走到 Marina 网关。
   即这台探针所在的接入网 / 路由器丢弃出方向 UDP 443（常见的 QUIC 屏蔽），与节点无关；只一个样本。
4. 联通芜湖探针的 mtr 过了自己的私网就不再有应答，不说明路径。

对照端口：三台 Dedirock（ColoCrossing AS36352）从三家运营商都 `target-replied`，UDP 包确实进了主机。Marina 的对照
端口没有主机应答，符合 ego-lite 只放行 UDP 443 的防火墙；它的 hy2 端口路径停在其 /24 网关 `144.225.255.1`。
逐探针结果（同一脚本输出）：

<details><summary>45 行逐探针表</summary>

| Node | Carrier | Probe | ICMP min / avg, loss | TCP 443 min / avg, loss | UDP hy2 port path | UDP control port |
|---|---|---|---|---|---|---|
| Buffalo · Niagara | China Mobile | Nanning AS9808 | 289 / 309 ms, 40% | 277 / 1512 ms, 0% | host-edge (AS1299 308 ms) | target-replied (AS36352 332 ms) |
| Buffalo · Niagara | China Mobile | Shanghai AS9808 | 276 / 291 ms, 0% | 244 / 1111 ms, 0% | host-edge (AS1299 292 ms) | target-replied (AS36352 291 ms) |
| Buffalo · Niagara | China Mobile | Taishan AS9808 | 265 / 267 ms, 0% | 266 / 4351 ms, 40% | host-edge (AS1299 270 ms) | target-replied (AS36352 261 ms) |
| Buffalo · Niagara | China Telecom | Guangzhou AS4134 | 206 / 209 ms, 0% | 206 / 216 ms, 0% | unclassified (AS? 211 ms) | target-replied (AS? 209 ms) |
| Buffalo · Niagara | China Telecom | Guilin AS4134 | 217 / 219 ms, 0% | 224 / 230 ms, 0% | host-edge (AS174 234 ms) | target-replied (AS36352 223 ms) |
| Buffalo · Niagara | China Telecom | Xi'an AS4134 | 217 / 218 ms, 20% | 213 / 216 ms, 0% | host-edge (AS174 229 ms) | target-replied (AS36352 225 ms) |
| Buffalo · Niagara | China Unicom | Changsha AS4837 | 202 / 202 ms, 0% | 259 / 263 ms, 0% | host-edge (AS3257 214 ms) | target-replied (AS36352 213 ms) |
| Buffalo · Niagara | China Unicom | Nanning AS4837 | 269 / 269 ms, 0% | 223 / 247 ms, 0% | host-edge (AS3257 289 ms) | target-replied (AS36352 269 ms) |
| Buffalo · Niagara | China Unicom | Xi'an AS4837 | 257 / 257 ms, 0% | 250 / 251 ms, 0% | host-edge (AS3257 257 ms) | target-replied (AS36352 254 ms) |
| Buffalo · Erie | China Mobile | Beijing AS9808 | 230 / 231 ms, 0% | 230 / 231 ms, 0% | left-china (AS174 231 ms) | left-china (AS174 231 ms) |
| Buffalo · Erie | China Mobile | Kunming AS9808 | 284 / 284 ms, 20% | 310 / 2318 ms, 40% | host-edge (AS1299 287 ms) | target-replied (AS36352 303 ms) |
| Buffalo · Erie | China Mobile | Nanning AS9808 | 295 / 304 ms, 20% | 314 / 2359 ms, 20% | host-edge (AS1299 306 ms) | target-replied (AS36352 307 ms) |
| Buffalo · Erie | China Telecom | Dongguan AS4134 | 220 / 223 ms, 0% | 218 / 225 ms, 0% | host-edge (AS174 221 ms) | target-replied (AS36352 227 ms) |
| Buffalo · Erie | China Telecom | Guangzhou AS4134 | 212 / 220 ms, 0% | 213 / 226 ms, 0% | unclassified (AS? 218 ms) | target-replied (AS? 235 ms) |
| Buffalo · Erie | China Telecom | Nanjing AS4134 | 261 / 261 ms, 0% | 211 / 226 ms, 0% | host-edge (AS174 234 ms) | target-replied (AS36352 237 ms) |
| Buffalo · Erie | China Unicom | Changsha AS4837 | 248 / 248 ms, 0% | 240 / 247 ms, 0% | host-edge (AS3257 237 ms) | target-replied (AS36352 249 ms) |
| Buffalo · Erie | China Unicom | Guilin AS4837 | 263 / 264 ms, 0% | 224 / 253 ms, 0% | host-edge (AS3257 234 ms) | target-replied (AS36352 265 ms) |
| Buffalo · Erie | China Unicom | Xi'an AS4837 | 261 / 261 ms, 0% | 239 / 248 ms, 0% | host-edge (AS3257 252 ms) | target-replied (AS36352 254 ms) |
| US-VLESS-Reality (Grove) | China Mobile | Nanning AS9808 | 189 / 189 ms, 0% | 1200 / 2432 ms, 0% | host-edge (AS46887 192 ms) | target-replied (AS36352 193 ms) |
| US-VLESS-Reality (Grove) | China Mobile | Shanghai AS9808 | 200 / 200 ms, 0% | 1199 / 2656 ms, 0% | host-edge (AS46887 202 ms) | target-replied (AS36352 204 ms) |
| US-VLESS-Reality (Grove) | China Mobile | Taishan AS9808 | 184 / 185 ms, 0% | 1190 / 1206 ms, 20% | host-edge (AS46887 192 ms) | target-replied (AS36352 182 ms) |
| US-VLESS-Reality (Grove) | China Telecom | Dongguan AS4134 | 167 / 172 ms, 0% | 168 / 176 ms, 0% | host-edge (AS1299 173 ms) | target-replied (AS36352 170 ms) |
| US-VLESS-Reality (Grove) | China Telecom | Guangzhou AS4134 | 172 / 175 ms, 0% | 168 / 171 ms, 0% | host-edge (AS1299 181 ms) | target-replied (AS36352 173 ms) |
| US-VLESS-Reality (Grove) | China Telecom | Nanjing AS4134 | 167 / 171 ms, 0% | 174 / 185 ms, 0% | host-edge (AS1299 168 ms) | target-replied (AS36352 175 ms) |
| US-VLESS-Reality (Grove) | China Unicom | Changsha AS4837 | 174 / 174 ms, 0% | 178 / 191 ms, 0% | host-edge (AS46887 194 ms) | target-replied (AS36352 188 ms) |
| US-VLESS-Reality (Grove) | China Unicom | Guilin AS4837 | 190 / 190 ms, 0% | 196 / 206 ms, 0% | host-edge (AS46887 195 ms) | target-replied (AS36352 200 ms) |
| US-VLESS-Reality (Grove) | China Unicom | Xi'an AS4837 | 212 / 223 ms, 0% | 192 / 219 ms, 0% | host-edge (AS46887 200 ms) | target-replied (AS36352 191 ms) |
| Los Angeles · Marina | China Mobile | Guangzhou AS9808 | 164 / 164 ms, 0% | 162 / 164 ms, 0% | no-reply | left-china (AS197196 178 ms) |
| Los Angeles · Marina | China Mobile | Kunming AS9808 | 171 / 172 ms, 0% | 167 / 173 ms, 0% | host-edge (AS197196 179 ms) | left-china (AS197196 180 ms) |
| Los Angeles · Marina | China Mobile | Taishan AS9808 | 168 / 170 ms, 0% | 170 / 175 ms, 0% | host-edge (AS197196 212 ms) | left-china (AS197196 186 ms) |
| Los Angeles · Marina | China Telecom | Guangzhou AS4134 | 168 / 169 ms, 0% | 161 / 169 ms, 0% | host-edge (AS197196 201 ms) | left-china (AS197196 198 ms) |
| Los Angeles · Marina | China Telecom | Nanjing AS4134 | 141 / 141 ms, 0% | 137 / 139 ms, 0% | host-edge (AS197196 147 ms) | left-china (AS197196 143 ms) |
| Los Angeles · Marina | China Telecom | Xi'an AS4134 | 155 / 155 ms, 0% | 152 / 154 ms, 0% | host-edge (AS197196 162 ms) | left-china (AS197196 155 ms) |
| Los Angeles · Marina | China Unicom | Guilin AS4837 | 174 / 175 ms, 0% | 167 / 179 ms, 0% | host-edge (AS197196 203 ms) | left-china (AS197196 187 ms) |
| Los Angeles · Marina | China Unicom | Nanning AS4837 | 185 / 186 ms, 0% | 175 / 181 ms, 0% | host-edge (AS197196 222 ms) | left-china (AS197196 180 ms) |
| Los Angeles · Marina | China Unicom | Wuhu AS4837 | 168 / 168 ms, 0% | 162 / 168 ms, 0% | probe-lan (AS? 2 ms) | probe-lan (AS? 2 ms) |
| Los Angeles · Marina (2) | China Mobile | Guangzhou AS9808 | 165 / 165 ms, 0% | 161 / 163 ms, 0% | no-reply | left-china (AS197196 205 ms) |
| Los Angeles · Marina (2) | China Mobile | Nanning AS9808 | 173 / 173 ms, 0% | 173 / 174 ms, 0% | host-edge (AS197196 179 ms) | left-china (AS197196 176 ms) |
| Los Angeles · Marina (2) | China Mobile | Shanghai AS9808 | 146 / 153 ms, 0% | 145 / 148 ms, 0% | host-edge (AS197196 172 ms) | left-china (AS197196 189 ms) |
| Los Angeles · Marina (2) | China Telecom | Dongguan AS4134 | 155 / 155 ms, 0% | 158 / 162 ms, 0% | host-edge (AS197196 161 ms) | left-china (AS197196 164 ms) |
| Los Angeles · Marina (2) | China Telecom | Guangzhou AS4134 | 163 / 164 ms, 0% | 155 / 161 ms, 0% | host-edge (AS? 216 ms) | unclassified (AS? 176 ms) |
| Los Angeles · Marina (2) | China Telecom | Nanjing AS4134 | 141 / 141 ms, 0% | 138 / 141 ms, 0% | host-edge (AS197196 183 ms) | left-china (AS197196 161 ms) |
| Los Angeles · Marina (2) | China Unicom | Changsha AS4837 | 164 / 164 ms, 0% | 163 / 168 ms, 0% | host-edge (AS197196 195 ms) | left-china (AS197196 198 ms) |
| Los Angeles · Marina (2) | China Unicom | Guilin AS4837 | 175 / 175 ms, 0% | 176 / 178 ms, 0% | host-edge (AS197196 189 ms) | left-china (AS197196 188 ms) |
| Los Angeles · Marina (2) | China Unicom | Nanning AS4837 | 185 / 185 ms, 0% | 174 / 180 ms, 0% | host-edge (AS197196 197 ms) | left-china (AS197196 180 ms) |

</details>

### 能说明什么、不能说明什么

- **能说明：** 2026-10-10，移动、电信、联通的 Globalping 探针发往四台节点 UDP 443 的包，在不同城市都送到了
  主机门口，未见在出境处被统一丢弃；三台 Dedirock 的 UDP 包确实进了主机。延迟：Grove / Marina 约 140–225 ms，
  Niagara / Erie 约 200–310 ms。
- **TCP 443 对照里的移动异常：** 移动经 CMI（AS58453）到三台 Dedirock，TCP 443 建连均值 1.1–4.4 s；Grove 每次
  最小都约 1.2 s，等于第一个 SYN 每次都没换回应答、靠 1 秒重传。同一批探针 ICMP 正常，同节点的电信、联通正常，
  移动经 CMIN2（AS58807）到 Marina 正常。和「移动用不了」的反馈一致，但每个探针只有 5 次建连，**是观察，不是结论**。
- **不能说明：** QUIC / Hysteria2 握手能否完成。mtr 的 UDP 载荷不是 QUIC，按 QUIC Initial（SNI、Hysteria 特征）
  做识别的封锁不会被触发；也没测吞吐、长连接与丢包随时间的变化。Globalping 探针是志愿者主机（多数标 eyeball，
  南京电信一台是机房），不等于客户家宽。
- 按 SHIP_PLAN §2.6，三网 `ok | throttled | blocked` 仍**未判定**：UDP 路径通，握手未测。G2.8 / A17 自动切换的前提
  不变，需要下面的握手结果。

### 真实握手：`hy2_probe.py`（老板的三网设备，或节点本机）

[`tooling/ops/hy2/hy2_probe.py`](../../tooling/ops/hy2/hy2_probe.py) 用官方 `hysteria` 客户端（v2.12.2，与节点同版，
`provision-reality-node.rb` 里有 linux-amd64 摘要）的 `ping` 模式做 N 次完整 QUIC + TLS + hy2 鉴权握手，再经隧道 TCP 建连
一次 `--target`。证书只认 `--cert`（`insecure: false`），脚本先核对 `--cert` 的 SHA-256 等于目录 `fingerprint`，不等就不发包。
`--auth-file` 放一个**专用、有权限的测试账户 UUID**（hy2 allowlist 只收 roster UUID，旧共享探测口令已不在），文件必须
本人所有、0600；值只进临时 0600 配置，不打印，客户端输出里出现也会被替换成 `[redacted]`。本机 orb 用本地 hysteria
服务端验证过：正确口令 3/3 ok；错误口令 `auth-rejected`；没人监听 `timeout`；错 SNI `tls`；证书与指纹不符直接拒绝（exit 1）。

```sh
# 在电信 / 联通 / 移动家宽各一台机器上，各跑一遍（cert 为节点公开叶子证书：/opt/tono-hy2/current/cert.pem，
# 9 月的 Dedirock 手装为 /opt/tono-hy2/tls/cert.pem；fingerprint 见本文 append 表）
python3 tooling/ops/hy2/hy2_probe.py --hysteria ./hysteria --server 23.94.79.123:443 --sni www.microsoft.com \
  --cert niagara.pem --fingerprint 1e5374a79bdb83b04c3d3c84722c03211d1c941c2de9f92431d2198ba7212cad \
  --auth-file ~/.tono-hy2-probe --count 5 --carrier cmcc --vantage "上海 移动家宽" --markdown
# 节点本机自检：--server 127.0.0.1:443 --cert /opt/tono-hy2/current/cert.pem --carrier node
```

输出一行 JSON（`tono.hy2-probe.v1`：握手成功数、经隧道建连 min/median/max、失败分类 `auth-rejected | tls | timeout |
handshake | proxy-connect`、hysteria 版本，不含口令），`--markdown` 再给一行，贴进下表。退出码 0 全过、2 有失败、1 未发包。
`--vantage` 只写城市与接入类型，不写住址、账号或家庭 IP。

| 日期 | 运营商 | 探测点 | 节点 | 握手 | 经隧道建连 min / median / max | 结论 | hysteria |
|---|---|---|---|---|---|---|---|
| 待测 | cmcc | 需老板提供的移动家宽 | | | | | |
| 待测 | ct | 需老板提供的电信家宽 | | | | | |
| 待测 | cu | 需老板提供的联通家宽 | | | | | |
| 待测 | node | 各 hy2 节点本机（节点安装待做：本轮 orb 不能 SSH） | | | | | |

D2-A 允许改节点 hy2 配置（先备份、不碰 443 的 xray），本轮没有 SSH，所以节点侧没有动作；节点本机自检要在下次有
SSH 的会话里把脚本拷到节点、用测试账户跑一次。

---

## 2026-09-13 补充：Panstar Marina 单机已通，仍非家宽三网证明

用户另指定 `vm-jPZp8D` / #7012 / `144.225.255.114`（目录基名 `Los Angeles · Marina`）。
ego-lite 只增加 IPv4 入站 UDP 443，防火墙保持 Enabled / Synced，原规则不变。
实际 Debian 11；原拒绝来自安装器平台名单，不是二进制不兼容。hy2 补装路径现增加
systemd ≥247 / Python ≥3.9 / OpenSSL SAN / 已校验二进制可执行性检查，未扩大 Reality 安装范围。

- Hysteria v2.12.2，部署 ID `20260913T080226Z-727a8909`，非 root 服务 UDP 443。
- SAN/SNI/masquerade：`www.ucla.edu`，证书钉扎，不跳过 TLS 验证；未更换其它节点证书。
- 43 个既有身份全部认证成功、随机身份拒绝；Xray PID 707990 和配置 SHA 全程不变。
- 产品生成的隔离 Mihomo 配置：fake-IP DNS、Google/YouTube、出口 IP 校验通过；5/5 独立握手，
  错误 pin 拒绝；持续下载 8 MiB / 31.99 秒 / HTTP 200；服务零重启。
- 这只是当前运维 Mac 的外部路径，不可填成电信/联通/移动家宽结论。自动切换仍关。
- 官方目录只读 r54 / 19 条，19→20 条追加 dry-run 通过，**未 PUT**。当前 hy2 授权表是静态
  身份快照；实时 roster 新增/撤销/清空尚未同步。修完该安全边界再提交目录发布审批。

完整证据、凭据清理及回滚见[本轮审计](../reports/RELEASE_READINESS_2026-09-13.md#panstar-7012-单机测试)。
下文是 9 月 10–11 日历史试验，平台“不选”与“目录仍不塞块”不能覆盖上述新实测或当前 r54。

---

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

再探（仍只出站、`ss-server` PID **548** / **7129** 未换）：东京 TCP 443 **69ms**；SNI `www.bing.com` 仍是 TLS 1.3 `CN=r.bing.com`；UDP 443 仍超时。Niagara `23.94.79.123` hy2 证书仍是 `CN=www.microsoft.com` / `DNS:www.microsoft.com`，指纹 `1e5374a79bdb83b04c3d3c84722c03211d1c941c2de9f92431d2198ba7212cad`；`hysteria ping` `1.1.1.1:443` 与 `google.com:443` 均为 **EXIT 0**；该机 `tono-xray` PID **335056** 未换。探测目录已删。

上面五台 `hysteria ping` 用的是官方客户端 + **`tls.ca` 证书文件**，不是 App 运行时那块 `fingerprint`。同日再用客户端形状从杭州打 Niagara（官方 Meta **v1.19.30**，`type: hysteria2` + `sni: www.microsoft.com` + 64 hex `fingerprint`，**不写** `skip-cert-verify`；mixed-port 仅 `127.0.0.1:17890`）：

| 从杭州 | 结果 |
|---|---|
| 直连 `https://www.google.com/generate_204` | 超时（exit 28） |
| 经 Niagara hy2 同一 URL | **HTTP 204**，0.99s；Cloudflare trace `ip=23.94.79.123` `loc=US` `colo=BUF` |
| 同一块去掉 `fingerprint` | 握手 `x509: certificate signed by unknown authority` |
| `fingerprint` 换成全 `f` | 握手 `certificate fingerprints do not match` |

杭州 `ss-server` PID **548** / **7129** 未换；Niagara `tono-xray` PID **335056**、`tono-hy2` PID **2675546** 未换；证书仍是 `CN=www.microsoft.com` / `DNS:www.microsoft.com`。探测目录（含 mihomo 二进制与 yaml）已删。同日东京 TCP 443 仍是 TLS 1.3 微软 `CN=r.bing.com`。官方 hysteria v2.9.3 在 `insecure: false` 时**不会**把 `pinSHA256` 当成替代 CA 校验，不能拿它当 App 形状。

本分支客户端把这五条 ` · hy2` 放在独立「备用 UDP」栏（城市 · 代号 · 备用通道）。新包目录 GET 带 `X-Tono-Accept: hy2`。五块私有 yaml 本地 `--dry-run` 已通过（5 个唯一名、各一个 `{{TONO_CLIENT_UUID}}`）。测 hy2 的 Windows 候选是 §10：run [`34599676962`](https://github.com/raydocs/tono/actions/runs/34599676962)，installer SHA-256 `2af3f3b1894fd5b5d12b9507df723d0f8a87715d91fd1b1bb4fb8809d31ba674`（源 `3abe64b6`，选中 hy2 时不再 REJECT UDP）。§9 `7bc7aaf9…` 不要再装。未装真机，不是 G1.1。

**生产 Worker 已是 `7c38521c`（#145）。目录还没 `--append`。** 旧包无 `X-Tono-Accept: hy2` 时仍被剥。`write-dedirock-hy2-catalog-sources.rb` 写出五块后 `--dry-run` / `--append`。G2.8 自动切换仍关。家宽三网未测。

### 部署之后怎么 append（口令不进仓库）

文件必须是绝对路径、当前用户所有、mode `0600`。Grove 的 `name` 必须是 `US-VLESS-Reality · hy2`，才能和 TCP 基名折叠。指纹与上表相同，写成不带冒号的小写 hex。`write-dedirock-hy2-catalog-sources.rb` 按这张表写出五块，不联网。

```sh
# After GET /api/v1/health buildSha is the #145 merge commit, not 2cef4eac:
umask 077
dir=$(mktemp -d)
ruby tooling/scripts/write-dedirock-hy2-catalog-sources.rb "$dir"
ruby tooling/scripts/publish-managed-catalog.rb --dry-run "$dir"/*.yaml
# only then:
ruby tooling/scripts/publish-managed-catalog.rb --append "$dir"/*.yaml
rm -rf "$dir"
```

五块的 `name` / `server` / `fingerprint`：

| 文件名建议 | name | server | fingerprint |
|---|---|---|---|
| niagara.yaml | `Buffalo · Niagara · hy2` | `23.94.79.123` | `1e5374a79bdb83b04c3d3c84722c03211d1c941c2de9f92431d2198ba7212cad` |
| erie.yaml | `Buffalo · Erie · hy2` | `198.46.140.254` | `4a66f10676ca881186be350d16b3f86cb36f9c896ef445a692d5cc0bc8b5b201` |
| sunset.yaml | `Los Angeles · Sunset · hy2` | `192.236.205.232` | `0ff3ab6b1bec3a3766f88955a84064ae73ea4724cb4d8602780e06dfbceceeb7` |
| mesa.yaml | `Los Angeles · Mesa · hy2` | `107.174.123.27` | `f59731347bf068d79f9d9e78c074e4686b981383a5c9029a5650e703e6afba41` |
| grove.yaml | `US-VLESS-Reality · hy2` | `198.12.84.154` | `a4a8308980004c8a5cda98597b87986671f230445df863c23d380f012c72f909` |

## A17 macOS 客户端：同节点自动换到 hy2

[Amp 待办](amp-backlog-2026-10-10.md) A17 的 macOS 半边，D1-C；取舍见暂定[决定 081](../decisions/081-2026-10-10-hy2-auto-switch-macos-client.md)。
开关是 A18 的 `hy2AutoSwitch`（目录 200 响应顶层布尔，缺失按 `false`）。代码：`apps/macos/Tono/Core/Hy2AutoSwitch.swift`。

- **前提**：本次启动里本账户最近一次目录 200 带 `hy2AutoSwitch: true`。`false`、缺失、目录被拒、换账户：只走 Reality，
  并清掉记忆与计数。开关不跨启动缓存；启动后第一次 200 之前不自动切。
- **何时切**：同一 Reality 块连续 **3** 次连接失败且分类为 `CORE_EXIT_UNREACHABLE`，下一次连接拨同一节点的
  ` · hy2` 块（基名 + 后缀、`type: hysteria2`、密码等于 Reality 块的 UUID、内核能校验 SPKI 钉扎、不是东京那种
  商家拦 UDP 的块）。DNS、helper、TUN 等失败不计数也不清零。不换到别的节点。
- **记住**：自动 hy2 走完同样的就绪检查、真正 Connected 之后，记住该节点 **24 h**（UserDefaults，账户按 SHA-256 分开，
  只存基名和时间）；期间连接直接拨 hy2（成功不续期），过期后先试 Reality。开始一次自动 hy2 就消耗该节点的计数和记忆，
  **30 min** 内不再自动试 hy2；只有 Connected 把记忆还回来，所以失败、看门狗超时、被取消的自动 hy2 都不会重复。
  hy2 块从目录消失、开关变 `false`、用户手选该节点任一块，都会清掉记忆。
- **不变**：只在内存里换本次拨号的选中块，保存的选择仍是 Reality；PF 按拨号节点放行，与手选 hy2 完全同一条路径，
  不新增放行；helper 协议不变；手选 hy2 照旧。
- **限制**：失败放行后的无武装重连仍先做 Reality 的 TCP 证明；TCP 完全不通（SYN 被丢）时这条梯子不会自己连，
  要等用户再点连接凑满 3 次。三网握手证明（§2.6）仍未做，服务端开关默认全关。
