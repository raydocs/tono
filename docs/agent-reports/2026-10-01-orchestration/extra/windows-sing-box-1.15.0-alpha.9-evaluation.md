# Windows 内核能否换成 sing-box v1.15.0-alpha.9

日期：2026-09-30。仓库 `raydocs/tono`，`main` 已与 `origin/main` 对齐，HEAD `d2363002`（Merge #698）。本轮只做分析，没有改产品代码，没有开 PR。

**结论：放在功能开关后面分阶段走，默认仍是现在的 mihomo。** 可以开始用现有 certify 工具钉死 `v1.15.0-alpha.9`（commit `132b38e9caaba1a1959354d518e54d2d08419afe`）做内部构建和真机试验。不能把客户默认内核换成它。稳定版 v1.14.2 只作为对照：它没有 1.15 的新 TUN 栈，也读不了 Tono 已经冻结的 runtime JSON。

最高约束：切换、崩溃、回滚的任何一步都不能让用户机器没有网络。做不到这一步的实现，开关保持关闭。

## 1. 现在两边各是什么

| | macOS 产品 | Windows 产品 | 本次目标 |
|---|---|---|---|
| 内核 | sing-box，`tooling/scripts/sing-box/release.json` 钉 `v1.15.0-alpha.3` | mihomo，`apps/windows/app/src-tauri/core-identity.json` 钉 `v1.19.30`（`tono-core.exe`，tag `with_gvisor`，sing-tun `v0.4.22`） | sing-box `v1.15.0-alpha.9`（2026-09-26） |
| 源码 commit | `93fff5954390367dd456cad3cbd79be54f8b941f` | MetaCubeX mihomo v1.19.30 | `132b38e9caaba1a1959354d518e54d2d08419afe` |
| 构建 | `prepare-macos-sing-box.sh` + `certify.py`，Go 1.27.1，CGO=0，四个 tag，banner `1.15.0-alpha.3-tono-m1.1` | `build-mihomo-adaptive.sh` | 同一套 certify，换 candidate，不要用上游 zip 当产品二进制 |
| 数据面 | Service/helper 已走 sing-box JSON | Service `StartClash` 仍写 Mihomo YAML，`sing_box::build_runtime` 没有接到启动路径 | 见第 4 节 |

上游发布（GitHub Releases，2026-09-30 查询）：

- 稳定：`v1.14.0`（2026-08-31）、`v1.14.1`（2026-09-15）、`v1.14.2`（2026-09-24）。后两篇发布说明只有 “Fixes and improvements”。
- 1.15 alpha：`alpha.1` 09-04、`alpha.2` 09-05、`alpha.3` 09-13、`alpha.4` 09-15、`alpha.5` 09-16、`alpha.6` 09-18、`alpha.7` 09-22、`alpha.8` 09-24、`alpha.9` 09-26。9 月后半段经常隔 1–2 天一版。`alpha.9` 到本报告只有 4 天。
- `v1.14.2` 是 `v1.15.0-alpha.9` 的祖先（compare ahead 41、behind 0）。alpha.9 比稳定版多出来的，主要是新 TUN 栈、整张证书 pin、以及一批修复。
- Tono 钉的 `alpha.3`（`93fff595`）**不是** `alpha.9` 的祖先。compare 为 diverged：ahead 85、behind 21。那 21 个 commit 是 alpha.3 时代的同一批改动（自有 TUN 栈、短睡眠保活连接、进程查找、Go 1.26.8），在 alpha.9 这条历史上用了另一套 SHA 重做过。升级是换 pin，不是快进。

官方 `v1.15.0-alpha.9` 仍发布 `windows-amd64`、`windows-arm64`、`windows-386`，以及带 `legacy-windows-7` 后缀的包。CLI 由 Go 1.26.8 构建，CGO 关闭，tag 很宽（含 `with_gvisor,with_quic,with_utls,with_clash_api` 以及 Naive、OpenVPN 等）。这与 Tono 的四 tag、amd64-v2、自有 banner **不是同一个二进制**。sing-tun 钉在 `v0.9.6-0.20260925112405-97d11460f2ea`，内置 wintun DLL 0.14.1。

## 2. 从 macOS 所钉版本到 alpha.9 的变更

macOS 所钉的就是 `v1.15.0-alpha.3`，不是 1.14。alpha.3 的发布说明已经宣布：从 1.15.0 起省略 `stack` 即使用 sing-tun 自有 TCP/IP 栈；`stack` 弃用，1.17.0 删除。Tono 的 `runtime-template.json` 已经不写 `stack`。

alpha.3 → alpha.9 发布说明里和 Tono 有关的增量：

| 版本 | 内容 | 对 Tono |
|---|---|---|
| alpha.4、alpha.6、alpha.9 | “Fixes and improvements”；alpha.9 另更新 NaiveProxy（Tono 不收 Naive） | 修复在 commit 里，不在发布说明里 |
| alpha.5 | Tailcat | 与目录无关 |
| alpha.7 | 整张证书 SHA-256 pin：`certificate_sha256`；另有 MASQUE、HTTP 代理改写 | **HY2 的 DER pin 从此能用官方字段表达** |
| alpha.8 | `dns_server_address` / `dns_search_domain` | 当前策略不用 |

同一段历史里、发布说明没写进标题、但和 Windows 有关的 commit（都在 alpha.9 上）：

- `73a4196cb3` 修复 Windows 上已关闭连接的错误认不出来。已包含。
- `4537a1ac00` 修复 system TUN 读循环在写错误后停掉。已包含。这是“隧道突然死掉”的一类问题。
- `9680a09ea3` Windows 查连接所属进程时不再扫整张 TCP 表。已包含。和现在 Windows `find-process-mode: always` 的开销是同一类问题，但是 sing-box 自己的实现。
- `9b24dbd458` / `dec31b3363` 加入 Go TUN 栈并去掉对 gVisor 的依赖。官方二进制的构建 tag 仍带 `with_gvisor`；产品配置必须继续省略 `stack`，不能把 mihomo 的 `gvisor` 翻译过去。
- `4abede8ceb`、`111ecb3483` 修网络重置（含“每次启动都重置”）。已包含。
- `1800096c4a` 短睡眠期间保留空闲连接。已包含。提交说明没有写明只限某一系统。
- `474aa5b5d9` 损坏的 cache 文件不再把进程打崩。已包含。Tono 合同本来就关持久 cache。
- `ad1794327b` 整张证书 pin，改了 `common/tls/std_client.go` 和 `windows_client.go`。Go 引擎在有 pin 时设置 `InsecureSkipVerify`，再用 `VerifyPeerCertificate` 比对原始证书。这和现有 SPKI pin 是同一模式，比对的是整张 DER。

相对 v1.14.2，alpha.9 多出来的同一批 TUN / pin / Windows 修复不在稳定版里。v1.14.0 相对 1.13 的大变更（新 DNS 动作、`dns_mode` 默认变成 `hijack`、Windows 上 `strict_route` 会拦非 TUN 的 53 端口、Schannel TLS 引擎要求 Windows build 17763）在 alpha.3 合同里已经处理过：模板写死 `dns_mode: disabled`、`strict_route: false`。

本轮用官方 Linux `v1.15.0-alpha.9` 对 M0 冻结的 `reference.json` 做了 `check -c`：Windows 形状和把接口名改成 `utun199` 的 macOS 形状都是退出码 0。同一份 Windows JSON 在官方 `v1.14.2` 上失败：`inbounds[0].multi_queue: unknown field`。1.14.2 也拒绝 `certificate_sha256`（unknown field）。所以 1.14.2 不能当作这份合同的退路。

## 3. Windows 问题分类

检索的是 `SagerNet/sing-box` 与 `SagerNet/sing-tun` 的 GitHub issue / PR / commit（2026-09-30）。issue 标题里带 Windows 的开放项很少；大量用户反馈不在这个 tracker 里。下表的“仍开放”指 GitHub 上仍开放或尚未进入 alpha.9 的 pin，“已修复”指修复 commit 在 `132b38e9` 里。没有对应 issue 不等于真机已经干净。

| 类别 | 状态 | 和 Tono 的关系 |
|---|---|---|
| TUN / wintun | 无标题为 wintun 的开放 issue。sing-tun pin 内置 wintun 0.14.1。安装器已经会在名为 Tono 的适配器还在时拒绝安装 | 相关。适配器残留、锁 LUID 必须仍是 Tono 的 Wintun 证明（`validate_tunnel_luid`）。换内核不能放宽 |
| `auto_route` | 文档行为：打开后由内核改路由。`#4356` 重复 IP 集导致建路由失败，2026-08-24 已关闭 | 相关。模板保持 `auto_route: true`，接口名必须仍是 `Tono`，否则 WFP lock 对不上 |
| `strict_route` / WFP | 文档写明 Windows 上会让不支持的网络不可达，并挡住从其他网卡出去的 53 端口，可能影响 VirtualBox。这是设计，不是开放 bug。sing-tun `a18119854`（2026-09-29）才允许 strict route 下的 IPv6 邻居发现，**晚于 alpha.9 的 sing-tun pin，不在本版本里** | 相关，而且必须关掉。Tono 的 WFP 是唯一保护层。模板已是 `strict_route: false`。打开它会和 Tono 的过滤器叠两层，崩溃后谁来拆 sing-box 的过滤器没有证明 |
| DNS 劫持 | 1.14 起默认 `dns_mode=hijack`，会改系统接口 DNS。`#3827` IPv6 本地 DNS 已于 2026-02-28 关闭 | 相关。必须继续显式 `disabled`，系统 DNS 仍由 Service 写到 `198.18.0.2` 并在解除时先恢复。默认值一旦漏写，就会和 Service 抢 DNS |
| 系统代理 | `#285` 2022 年已关闭。图形客户端的系统代理不是 CLI 的必选项 | 当前产品走 TUN，不走系统代理。保持不启用 |
| 睡眠 / 唤醒 | alpha.9 含短睡眠保留空闲连接；iOS 的 pause/wake 是另一批 commit。没有打开的 Windows 睡眠 issue | 相关，未在真机证明。必须进第 8 节的测试 |
| 网络变化 | sing-tun `monitor_windows.go` 注册了路由变化和接口变化回调。alpha.9 修了“启动就 network reset” | 相关。会和 `#705`（路由通知先确认再停内核）叠在一起。Tono 的确认逻辑要留着，不能再让内核自己拆掉 WFP |
| IPv6 | 本地 DNS 修复已在 1.14/1.15。strict route 下的 ND 修复不在本 pin | 合同拒绝 IPv6。保持拒绝则 ND 问题碰不到。Windows 探测代码把 `198.19.0.1` 明确排除在 fake-ip 之外 |
| 崩溃 / 内存 | alpha.9 含损坏 cache 崩溃修复、OOM 计时器修复，以及去掉 gVisor。没有打开的 “Windows crash” issue | 相关的是进程死掉之后的保护释放，不是 GitHub 条数。gVisor 内存问题不能当成 Windows TUN 已经验收 |
| Windows 10 / 11 | 没有区分 10 和 11 的开放 issue。Schannel 引擎要求 build 17763（1809）。默认 Go TLS 引擎没有这条限制。另有 Win7 legacy 包，Tono 不使用 | 真机要覆盖 10 和 11。TLS 保持默认 Go 引擎，不切 `engine: windows` |
| ARM64 | 官方有 `sing-box-…-windows-arm64.zip` 和 wintun arm64 DLL。Tono 合同只有 `windows-amd64-v2` | 没有 ARM64 产品目标就不做。有设备再单开构建目标 |
| 进程路径大小写 | **PR #4346 仍开放**（2026-07-24 提出，2026-09-30 仍 open）。Windows 路径大小写不敏感，sing-box 的 `process_path` / `process_name` 仍区分大小写 | **相关。** Windows DIRECT 的进程规则可能漏匹配。合入上游或在 Tono 侧规范大小写之前，不能把 DIRECT 进程匹配当成已等价 |

## 4. 哪些 Windows 行为绑在 mihomo 上

保护层（WFP、适配器 DNS、解除顺序）属于 Tono Service，不属于 mihomo。`disarm` 先证明 DNS 已恢复，再停内核、再拆 WFP。停内核而不释放时，阻断保持。这条顺序换 sing-box 也要原样留下。

绑在 mihomo 行为上、换内核必须改的部分：

1. **启动参数与配置格式。** Service 用 `-d/-f` 加 YAML，外加命名管道 `-ext-ctl-pipe`。产品连通路径是 `build_owned_runtime_with_ports` → `RuntimeBundle.yaml`。`ensure_owned_runtime_config_is_safe` 只认 Mihomo YAML。合同写明不能把 JSON 塞进 `yaml` 字段。要新的 JSON 字段和拒绝旧载荷的门。`sing_box::build_runtime` 今天没有被 `apps/windows/app` 调用。被挡住的草稿在 PR #203。
2. **TUN 参数方向相反。** 现网 YAML 是 `stack: gvisor`、`strict-route: true`、`dns-hijack`。sing-box 模板是省略 stack、`strict_route: false`、`dns_mode: disabled`。Service 注释写明：mihomo 在 strict-route 下会把发往 `127.0.0.1:53` 的查询重新分类，所以系统 DNS 指到 TUN 上的 `198.18.0.2`。换内核后仍由 Service 写这个地址，内核只回答它，不自己改网卡 DNS。
3. **fake-ip 网段不一致，会直接失败。** mihomo 运行时和 `is_fake_ip` 只承认 `198.18.0.0/16`。测试明确断言 `198.19.0.1` 不是 fake-ip。sing-box 模板的 fake-ip 是 `198.19.0.0/16`（为了躲开 `198.18.0.1/30`）。不先对齐探测或模板，连通证明会失败；此时若 WFP 已经锁上，机器没有网络。这是开关能打开之前的硬门槛。
4. **DIRECT 热重载。** 现路径是 `begin_direct_runtime_reload` 把 WFP 收进阻断括号，再 `PUT /configs?force=true`。sing-box 的 Clash API 不能靠 PUT 换整份配置（M0 已核对源码）。重载必须是受保护的停/起，或者失败时先放开网络再重试。停在“WFP 已锁、内核已死、DNS 仍指向 198.18.0.2”是禁止状态。
5. **控制器语义。** `/version`、选择组、连接列表大概率还能用（模板有 Clash API）。需要重新证明的是：`/dns/query` 的 JSON 形状、`/rules` 里 DIRECT 的 AND 规则、`chains[0]` 是否仍是最后一跳（`route_ledger.rs` 按 mihomo 的顺序读）、`/traffic`。`unified-delay` 是 mihomo 配置，没有对应开关就不能假设延迟探测语义不变。
6. **HY2。** Windows 准入把 `fingerprint` 当作叶子证书 DER 的 SHA-256（64 hex）。Rust emitter 对选中的 HY2 返回 `UnsupportedCertificatePin`。alpha.7 的 `certificate_sha256` 是同一哈希的标准 base64（`openssl x509 -outform der | openssl dgst -sha256 -binary | openssl enc -base64`）。本轮错误 pin 的回环请求失败，正确 pin 能通。emitter 还没发出这个字段。
7. **错误码（#706）、自愈（#703）、漫游（#705）、遥测（#707）。** 这些 PR 都还开着，基于 mihomo。#706 解析现有错误字符串里的 `TONO_` / `CORE_`；sing-box 的句子对不上，分类表要单独补。#703 的自愈是编排层，换内核后仍要“保护降下时才换路，失败则放开”。#705 在停内核前再探一次；sing-box 自己也会收路由/接口通知，不能两套各拆一次。#707 的聚类在控制面，客户端上报里的内核身份今天来自 `core-identity.json` 的 mihomo tag，要改成 sing-box revision。#704 修的是 mihomo HY2 `Early: true` 和调用方 context；补丁不会跟着 sing-box 走，HY2 的 0-RTT 要在 sing-box 上重测。

可以留着的：WFP 状态机、DNS 恢复、会话 IPC、`PrepareCoreStart`、端口和控制器密钥、节点准入、`DirectPlan` 的语义、接口名 `Tono` 的 LUID 证明。

`StartClash` 这个名字按仓库不变式，只在专门清理里改，不塞进这次迁移。

## 5. 协议与家宽

客户目录里实际提供的出口只有两种，其他类型在控制面和两端准入都被拒绝（Trojan、VMess、Shadowsocks、TUIC、WireGuard、普通 HTTP/SOCKS 出口都不是产品协议）：

| 能力 | 现网 mihomo | sing-box 合同 / alpha.9 |
|---|---|---|
| VLESS Reality TCP | 发出。`flow` 仅 `xtls-rprx-vision`，uTLS 必须是显式 chrome，禁止 `skip-cert-verify` | Rust 与 macOS emitter 都会发。回环上 alpha.9 与 1.14.2 都能完成带 vision 的握手 |
| Hysteria2（同一节点的 ` · hy2`） | 发出 DER `fingerprint` | macOS 走目录里的 SPKI（`certificate_public_key_sha256`），没有 SPKI 的节点标不可用。Windows emitter 仍拒绝。alpha.9 可以用 `certificate_sha256` 表达现有 DER，本轮已用官方二进制验证正确 pin 可通、错误 pin 失败。这比 SPKI 更严：同密钥换发的新叶子不会被接受，和今天 mihomo 一致 |
| 家宽 `homeSocks5` | `dialer-proxy: Tono-Exit` | `detour: Tono-Exit`。SOCKS 优先于 `homeProxy` |
| 家宽 `homeProxy` | 选择组指向目录节点名 | 规则指向该节点 tag |
| DIRECT | YAML 规则 + WFP 端口/进程租约 + `PUT /configs` | emitter 能生成规则。热重载和 `/rules` 证明还没有接到 Service |

HY2 没有 pin 的路径继续拒绝。不把 DER 换成“不校验”，也不把 SPKI 填进 insecure。

## 6. 性能

协调对象是正在跑的 [Protocol handshake performance vs Clash](https://cursor.com/agents/bc-30050b5e-e4f8-5e13-b094-49c7205f73ab)。2026-09-30 10:29 UTC 拉到的记录里，它还在读连接路径，**没有**写出可复用的 harness，也没有下载内核。本轮因此自己做了回环测试，没有动它的分支。

方法：Linux 上官方 CLI（不是 Tono 的 amd64-v2 构建）。sing-box alpha.9 当 Reality 与 HY2 服务器，客户端分别是 alpha.9、v1.14.2、mihomo v1.19.30。内层是本机 TLS，`https://127.0.0.1:18443/`，Reality 带 `xtls-rprx-vision` 和 chrome uTLS，HY2 带 pin。每个进程预热后 25 次请求，另有 8 次新进程的第一次请求。没有 TUN，没有 WFP，没有生产节点，服务器也不是节点上的 Xray。

官方二进制 SHA-256：alpha.9 Linux `fa7785db…d337ec`，1.14.2 Linux `fc9c6e6a…98d7b8`，mihomo `3e92df24…1076ae`。

curl 的 `time_total`，单位毫秒：

| 客户端 | 协议 | 热请求 p50 | 热请求 p90 | 新进程第一次 p50 | 含进程启动的第一次 |
|---|---|---|---|---|---|
| sing-box 1.15.0-alpha.9 | Reality | 4.57 | 4.92 | 5.68 | 75 |
| sing-box 1.14.2 | Reality | 4.66 | 5.05 | 6.13 | 71 |
| mihomo 1.19.30 | Reality | 3.57 | 4.10 | 4.85 | 39 |
| sing-box 1.15.0-alpha.9 | HY2，DER pin | 3.48 | 3.73 | 6.92 | 72 |
| sing-box 1.14.2 | HY2，仅 SPKI（没有 DER 字段） | 3.55 | 3.80 | 6.81 | 71 |
| mihomo 1.19.30 | HY2，DER fingerprint | 3.76 | 4.08 | 5.30 | 39 |

回环上三者同一数量级。mihomo 的 Reality 热路径还略短，进程起来也更快。alpha.9 和 1.14.2 的握手几乎一样。**老板看到的速度差不在这次握手里。** 1.15 的发布说明把收益写在新 TUN 栈的吞吐、能耗和内存上；那一层在这台 Linux VM 上不能开 `auto_route` 来测（会改这台机器的默认路由）。Windows 吞吐必须在真机上、同一节点、与现网 mihomo gVisor 对照。

Tono 自己的连通时间里，更大的一段是编排：fake-ip 证明、DNS IPC、WFP 加锁重试、整条 HTTPS 探测。性能调查的记录里引用了现有注释（Reality 探测常见数百毫秒、加锁重试、`find-process-mode`）。换内核消不掉这段。

## 7. Alpha 风险与怎么钉、怎么退

**配置相对 1.14 的断裂（alpha.9 仍要遵守）：** 省略 `stack` 才是新栈；写 `gvisor` 是在选择弃用路径。`dns_mode` 默认 `hijack`。`certificate_sha256` 是 1.15 才有的字段，1.14.2 直接拒绝。`multi_queue` 同样不被 1.14.2 接受。HTTP 出站在 alpha.7 默认 HTTP/2；Tono 家宽走的是 SOCKS，不走这条。1.14 的 DNS 旧字段（地址过滤、`independent_cache`、内联 ACME）在 1.16 会删，当前模板用的是新 DNS 服务器形式。

**1.15 alpha 自身：** 历史被重写过，不能假设 alpha.3 的每个 SHA 都在 alpha.9 里；要以 alpha.9 上 `check` 通过的那份 JSON 为准。发布节奏是数天一版，pin 不能写成“最新 alpha”。下一版可能再改 JSON。

**钉死一个 alpha 的做法（沿用现有工具）：**

- 只认 tag `v1.15.0-alpha.9` 与 commit `132b38e9caaba1a1959354d518e54d2d08419afe`。
- 用 `tooling/scripts/build-sing-box.sh` / `certify.py` 在干净源码上编：记录 go.mod、go.sum、Go 版本、CGO=0、tag、ldflags banner、每个目标的二进制 SHA 和 manifest SHA。官方 zip 只作调查，不进安装包。
- Go 版本按 candidate 固定。上游发布二进制是 go1.26.8；现有 macOS 产物是 go1.27.1。新 pin 要重新选出一个版本并写进 manifest，不能混用两个工具链的哈希。
- 签名仍走 Tono 现有的 Windows 签名和 macOS 公证。签完之后的哈希才是安装包要核对的哈希。上游 CLI zip 不是 Tono 的签名产物；`SFW-*.exe` 是另一款图形客户端，不能拿来当 `tono-core`。

**退回 mihomo：** 安装包里继续放现在的 `tono-core.exe`。开关默认关。打开开关的那一次连接若 `check` 或启动失败，不装 WFP。已经连上之后内核崩溃或健康检查失败：先走现有释放（DNS 恢复被证明，然后拆 WFP，用户回到原来的网络），再决定要不要用 mihomo 重连。在“WFP 仍锁着”的状态下直接换二进制，要等真机量过黑洞时间才能做；量过之前的退路是先放开，再起 mihomo。不需要卸载。开关本身不写进系统 DNS。

macOS 要不要一起动：要钉到**同一个** commit，但单独做，并且排在 Windows 默认切换之前。理由：macOS 已经在跑 alpha.3 这一代栈；alpha.9 带上证书 pin 和 TUN 读循环、网络重置的修复；M0 的 macOS 形状能被 alpha.9 `check`。它仍是一次内核替换，要在 Mac Studio 上浸泡。不要和 Windows 第一次打开开关绑成同一次客户发布。长期不要一边停在 alpha.3、一边 Windows 用 alpha.9。

## 8. 分阶段

1. 开关默认关，客户通道不动。mihomo 二进制留在包里。
2. 更新 candidate / `release.json` 的草案到 alpha.9 的 commit，用 certify 编出 linux 检查核、`windows-amd64-v2`、`darwin-arm64`。用 alpha.9 对 M0 reference 和 **当前 macOS 产品实际发出的 JSON** 做 `check`。1.14.2 只留作“这份 JSON 不被稳定版接受”的对照。
3. Rust emitter 把现有 64 hex DER 写成 `certificate_sha256`（base64），错误 pin 必须失败。同一改动里对齐 fake-ip：要么模板改到 `is_fake_ip` 承认的 `198.18/16` 且躲开 `.1` 和 `.2`，要么同时改探测。两套网段不能同时存在。
4. Service 增加 JSON 运行时字段。启动后的内核仍叫现有安装名的策略可以另案处理；数据面文件不能再是 YAML。`strict_route` 保持 false，`dns_mode` 保持 disabled，接口名保持 `Tono`。DIRECT 重载改成不会在锁着的 WFP 上停住。
5. 老板的 Windows 10 与 Windows 11 设备，开关打开。先 Reality，再 HY2，再家宽。
6. 允许列表里的 canary。失败自动把该设备的开关关掉并释放保护。
7. macOS 钉到同一 commit，Mac Studio 浸泡通过后再谈 Windows 默认值。
8. 默认改成 sing-box 的条件：第 9 节全部有记录，并且一次退回 mihomo 的演练里，从内核死亡到普通上网恢复的时间被量过。

## 9. 必须在真机上做的 Windows 测试

VM 做不了这些。每一项都要记录：开关状态、内核 SHA、从失败到重新能打开普通网页的时间。

1. Windows 10 与 Windows 11，x64。干净安装，以及从现网 mihomo 覆盖升级。ARM64 没有产品目标就不要用一份 x64 包去冒充。
2. Reality 连通：fake-ip 落在探测承认的网段，系统 DNS 是 `198.18.0.2`，WFP 锁在名为 Tono 的 Wintun 上。断开后 DHCP DNS 和默认路由回来。
3. 连通中杀掉 sing-box：保护必须放开，机器恢复原网络。再测 Service 重启、用户注销、重启，以及“想保持保护”的开机恢复。任何一条留下全阻断且没有内核，就是失败。
4. 睡眠/唤醒、Wi-Fi 漫游、DHCP 续租、插拔扩展坞、只变 IPv6 默认路由（#705 的场景）。短抖动不应拆内核；默认出口真的换了才重建，重建期间不能黑屏。
5. 与 Hyper-V、VirtualBox 或另一款 VPN 同时存在。`strict_route` 保持关闭。
6. HY2：正确 DER pin 可通；错误 pin 失败且不会降成不校验。同一节点 Reality 与 HY2 切换。
7. 家宽 SOCKS（`detour`）和 `homeProxy`。家宽不可用时目录行为与今天一致，不改成直连漏出去。
8. DIRECT 重载：规则生效，失败时网络回来。进程路径用与规则大小写不同的真实路径试一次（#4346）。
9. 开关从开到关：不卸载，mihomo 能在同一次会话里重新连上。演练时先释放再起 mihomo。
10. 同一节点的吞吐对照（老板看到的测速），以及一次完整连通耗时对照。回环握手不能代替这项。
11. 安装器：残留 Tono 适配器、BFE 停掉、更新中途失败。这些门今天会挡住安装，换内核后仍要挡住，并且不能把 DNS 留在 `198.18.0.2`。

## 10. 同时开着的工作

本轮看过的开放 PR 与这次决策的关系：#702 macOS 上行漫游、#700 macOS 广播路由，都是 sing-box 已经在 macOS 上的问题，支持“macOS pin 要跟过去”，不支持 Windows 立刻默认切换。#703 自愈放开、#705 网络抖动先确认、#706 失败后放回原网络，是无网络这条约束的现成方向，sing-box 开关要接同一套，而不是另写一套更硬的阻断。#704 的 HY2 补丁留在 mihomo。#707 的遥测要能区分内核身份。#203 是已经挡住的 Windows sing-box 生命周期草稿，本报告不把它当成已经接上。#663 仍在等 TUN 路由就绪，和 fake-ip/路由证明是同一类窗口。

性能 agent 尚未提供 harness。若它稍后把 Xray 节点上的分阶段计时做出来，用那份数字补第 6 节的 WAN 列；本报告的回环数字只说明握手不是速度差异的来源。
