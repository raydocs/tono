# 下一版智能分流 nightly：Home 链路与 DNS 防护设计提案

日期：2026-10-11；实施准备续记：2026-10-16。状态：**owner 已授权桌面实施和测试；#1572 已开始续修，本 PR 的默认 DIRECT 模式仍未实现。§0 的三个产品取舍待确认，不将实施授权当作原设计矛盾已解决。**

归属：[SHIP_PLAN](../SHIP_PLAN.md) G1/G2 的后续桌面版本；保持现有 0.0.76 客户 RC 和正式 feeds 不变，不修改 G1–G3 勾选。具体产品版本由 owner 另定。

原始源码参照：[main a8b0be2d](https://github.com/raydocs/tono/commit/a8b0be2d5701dbabdb644699547398bdefb99a26)；本次重新核对并并入 [origin/main 345774bc](https://github.com/raydocs/tono/commit/345774bc9b163f5c16af47c37adbc036b0bd11ca)。§3 原始行号属于旧参照，不冒充当前行号。现有 [0.0.76 RC](https://github.com/raydocs/tono/releases/tag/tono-desktop-0.0.76-rc.20261016.1) 是客户测试候选，不是本模式的稳定资格或可直接覆盖任意旧版本的证明。

本次在原 PR 继续设计合同与实施分解，不改变 App/Core/Helper/Service 或生产状态。实施、定点测试、独立审查可继续；合并、打包、签名、部署、发布或客户扩量未获授权。A13 / #1504 仍不恢复；#1569 已合入，不能再称未合依赖，但其存在不等于本模式的恢复/设备验收通过。移动端仅考虑复用合同，本轮不实现 iOS/Android，不改 rw8/Tono-droid。

## 0. 实施入口：先完成有共识的范围，再闭合产品取舍

### 已确认与当前源码事实

- **先 #1572，后 #1571：** [Home 扩域 PR #1572](https://github.com/raydocs/tono/pull/1572) 保持现有默认云出口；166 个 Home 后缀和 21 个明确云视频例外延续已批准政策，不等于智能模式。YouTube 的 Google API 子域等具体例外先于宽 Google Home 和进程 fallback；除这些明确例外，Home 仍不得被签名云/DIRECT 规则覆盖。Twitch 仍属本模式待锁定名单，不能声称 #1572 已覆盖。
- [#1569 已于 2026-10-12 合入](https://github.com/raydocs/tono/pull/1569)：当前 Mac `ReleaseAuthority.swift`/`ReleaseWorker.swift` 和 Windows `core/release/` 已有 release generation、Connect 准入与 unfinished writer/broker 终结证据。应复用并核对模式摘要/旧 writer 的适用面，不另造 ownership 框架；不把合入或源码审查当作真实系统 effect 已恢复。
- [#1646 已于 2026-10-13 合入](https://github.com/raydocs/tono/pull/1646)：Windows Service 对新 Start/Stage 拒绝 DIRECT，替换文档需签名策略与成员关系准入。不能再把 [#1280](https://github.com/raydocs/tono/issues/1280) 的旧“只有形状校验”描述套用全部当前入口，也不能把它当成任意默认 DIRECT 或策略新鲜性已经获准。
- Windows 当前 `sing_box_runtime.rs` 仍要求 `route.final = Tono-Exit`，HTTPS DNS 必须 `detour = Tono-Exit`；编译器 DIRECT 没有独立 resolver。普通 DNS 若依赖断开的云节点，“普通网络独立”目标就不成立。这是需要客户端和 Service 同一有界新合同的实现工作，不只是设备证据缺失，也不能简单撤掉现有拒绝。
- Home SOCKS 的 `detour = Tono-Exit` 可从配置核实；抓到 SOCKS `ATYP=domain` 只证明委托 Home 解析，不能确认供应商使用哪个 resolver。当前云 DoH 不是本地明文泄露；Home 解析位置/实际出口必须另测。

### 三个决定点：推荐不是已批准政策

结合 [原审查](https://github.com/raydocs/tono/pull/1571#issuecomment-6117460125) 及 [更正](https://github.com/raydocs/tono/pull/1571#issuecomment-6117533750)，以下由 owner 选择，不能靠跳过断言或把 unsupported 改叫 protected 解决：

| 决定 | 推荐方案 | 另一方案及代价 | 确认前边界 |
|---|---|---|---|
| Core/Helper/Service 死亡、卡住时普通网络是否也要继续 | 整机保持 fail-closed；普通网络独立只适用于 Core 健康、Home/云单跳故障 | 坚持通用浏览器共享 CDN 下独立阻断 Home 且普通网络恢复：现有 PF/WFP 缺少可用分类身份，模式不准入 | 不用窄 AI hold 或短暂重启代替严格防线；不承诺原 §5 场景3已经可实现 |
| 未分类缓存 IP、自带 DoH、ECH、未知 UDP 的去向 | 单列未分类并拒绝；只有已确认受支持普通业务可 DIRECT | 云出口 fallback 可保本地 IP 不直出，但不能保证 Home 最终身份；不等于严格 Home | 未分类不默认 DIRECT；哪些普通游戏可证明身份仍需支持矩阵，不将非443 UDP自动视作普通 |
| Home 数据解析是否接受供应商 resolver | 保留原提案固定、可审阅 DoH 经云→Home的严格要求，先锁端点/备用/缓存及 Service 准入 | 允许供应商解析：须确认 resolver/位置、变更保障与支持边界，且是对原要求的产品变更 | 不仅凭 ATYP=domain 宣布两跳 DNS 验收；不把当前实现升级为任一方案已完成 |

### 最小实施顺序与退出条件

1. #1572 原 Draft：修政策合同红灯、双端四编译器/视频优先级/DIRECT 守卫及独立探针回归；准确 head CI + high 路由审查，仍不合并/出包。
2. owner 确认上表后，在原 #1571 锁一个不可变模式合同：Home/云视频/已分类普通/未分类四类、普通 DNS 独立路径、支持客户端与 IPv4/UDP 边界。只支持实际评审的 sing-box 产品路径；兼容 YAML 不静默承载新模式。合同可供未来移动端复用，不先新增移动端接口。
3. 同一合同同时落入客户端编译器、Helper/Service 准入及物理许可；先验证开关关闭的稳定模式未变，再验证普通 DNS/游戏的正例和 Home/视频/未知流的负例。Mac root/Core 任意端口许可、Windows 新 DNS detour 或 final 不得通过删除现有校验实现；各自先给有界机制和回归。
4. 复用当前 release generation/writer 账本，核对模式切换、迟到 DNS、Core/daemon 故障及再次 Connect。必须单独保留 [#1071/#1504](https://github.com/raydocs/tono/issues/1071) 的 Mac abandoned upgrade AI-hold 缺口和 [#1605](https://github.com/raydocs/tono/pull/1605) 的 Windows DNS 恢复收尾；未合修复、旧 head 的 major 或绿色 CI 均不自动转成当前实现结论。这两项不与分流扩域混为已解决。
5. G0/带外恢复就绪后，再做双端设备 DNS/QUIC、Home A→B→C 云切换、故障/升级回退的正负对照；没有对应证据不开放默认 DIRECT 测试模式。一周小范围试用及任何新候选/正式推广仍需另行授权。

以下各节保留原要求和验收矩阵。与上表相关的可行性结论仍待决定，不能抽取旧句子作为已批准的新合同。

## 1. Owner 已表达的目标与本提案的边界

- 同一 App 代码里新增用户主动选择的测试模式，先通过独立 nightly 候选分发。稳定客户版和客户更新源不动，不新增第二个争抢同一 Helper/Service 的 App。
- 保留现有宽泛 Home 名单，包括 AI、Facebook/Instagram、Gmail/Google 登录、支付/验证码及安装更新依赖。这里不再提议缩小名单。
- **Home 是链式代理的家宽第二跳：本机 → 云节点 → Home → 目标服务。不能将其改成本机直接连接的独立家宽出口。**
- 指定的其他海外网站只走云出口，owner 举例为 YouTube、Twitch、Pornhub；具体域名及依赖须审阅后锁定。其余受支持的普通流量默认直连，包括国内游戏，不再逐个给普通游戏补直连白名单。本地手机、NAS、打印机等应可用。
- Home 必须优先安全，不能为连接成功改用云端最终出口或直连。普通业务不应因 Home 单独故障被整机拖断。
- 候选先验证安全，再让明确加入的用户稳定使用一周；不是七天后自动发布，也不是对服务商封号/地区政策的保证。

本提案增加的严格验收要求不是已有能力：Home 业务的上游 DNS 也经完整两跳链、故障时独立阻断 Home、跨代操作不能覆盖新会话。其具体实现必须单独评审。若平台无法同时证明这些要求和普通网络故障隔离，**该平台的测试模式不准入，不能静默变成较弱模式**。

Home 末端上游 DNS 是本提案额外提出的增强，不是现有链路重建的理由，也不能反推当前经云 DoH 等于 ISP 明文泄露。默认直连的改造与该增强分开评审、记录证据和锁定候选合同；不能偷偷降低本提案的严格候选要求，也不能把它们混称为“现有功能已验证”。

## 2. 路由目标：Home 优先，而不是按国家 IP 决定安全

```text
Home 名单的受支持业务 ──→ 云节点 ──→ Home 家宽 ──→ AI / 名单内服务
指定海外网站         ──→ 云节点 ───────────────→ 网站
其他普通业务         ──→ 本地物理网络 ─────────→ 网站
明确允许的本地资源   ──→ 本地网络接口 ─────────→ 手机 / NAS / 打印机
```

规则语义拟为：有效协议与本地入口检查 → 已批准的具体云视频例外 → Home 域名/可信应用规则 → 其他已审阅云名单 → 已分类普通 DIRECT；未分类单列，去向按 §0 决定。局域网是另一个有明确边界的许可，不能覆盖 Home 规则或为 Home DNS 开洞。IP 字面量、DNS 回答和既有连接另有准入要求，不能假定它们总携带域名。

“国内直连”是体验目标，不是 GEOIP,CN 优先的安全实现。共享 CDN、国内域名的海外依赖、DNS 重绑定和国内 AI API 子域，都必须按实际业务规则处理。除明确批准的具体云视频例外，宽 Home 名单不准被签名的云/DIRECT 名单覆盖；重叠按 Home 处理。未在 Home/云名单但已分类的普通海外网站可能直连不可用；没有名单命中不能证明业务已分类，也不能宣称所有海外网站自动可用。

名单内共享依赖用于普通工作时也走 Home：例如 Gmail、Stripe、npm、GitHub raw。Home 故障时这些请求同样会失败；“普通网络隔离”只指不属于 Home 的业务，不承诺所有页面/工作流毫无影响。不能为它们阻断整个 Cloudflare、Google、Azure 或 ASN。

### 2.1 云第一跳可替换，assigned Home 与其 DNS 路径保持

Owner 的补充目标：云节点故障、节点供应商流量耗尽或不稳定时，可以更换云第一跳；**不重新分配 Home，不把 Home 流量改为云端最终出口或 DIRECT**。本提案约束已有手动切节点及将来的切换行为，不实现自动选节点、健康调度或额度驱动切换。

**运营前提已由 owner 确认：家宽供应商保持同一个，用户继续使用原 assigned Home，由运营侧维护固定分配。** 客户端不自行轮换 Home 或供应商；后续审查以这一运营约束为前提，不把随机分配家宽作为默认方案。实际配置与切换中的出口/DNS连续性仍需验收，运营承诺不代替网络证据，也不等于ISP公网地址终生不变。

- 切换前后保持同一授权 Home 绑定与最终家宽出口，Home DNS仍经新云第一跳 → 同一 Home → 批准解析器；解析类别、主备解析器策略和禁止链外fallback的合同不变。DNS答案随TTL/CDN变化不等于泄露，不要求每次答案相同。
- Cloud选择、Home绑定和会话代次是不同概念。Cloud变更必须重证新链；旧会话/旧Core的迟到effect不能因Home没变而获准写新状态。缓存复用需要同一已证明Home解析上下文及有效来源，不能把复用缓存报成新链已验证；Home身份/策略改变仍重新准入。
- **同一个Home绑定、SOCKS地址或凭据，不保证同一个公网IP。** 供应商可能逐连接轮换，ISP也可能改地址。要承诺出口连续性，需明确固定/粘性家宽分配机制与其有效期，并用受控接收端对比切换前后实际出口。单次出口探测只证明当时；若供应商可在后续连接轮换，不能凭一次探测授予持续固定身份资格。最终IP改变或无法确认时停止Home新业务准入，不能把新身份静默称作原Home；具体检测/约束机制仍需设计审查。
- Home本身故障与云第一跳故障分开处理：前者不能靠换云终点或随机换家宽“修好”；绑定迁移另走明确授权和重新准入流程，不藏在故障切换里。节点供应商额度与用户套餐/账户授权也不同，切节点不得绕过后者；运维额度估算不是供应商实际执行/当前可用性的证明。
- 保持最终IP有助于减少因频繁更换出口引起的身份变化，**不保证平台风控通过或不封号**。第一跳切换仍可能中断TCP/AI流式会话，不能承诺无缝续传，也不能自动重放AI请求、付款或工具执行等有副作用的操作。

“DNS保持一致”在这里指同一受保护解析合同和Home末端路径，不只是resolver名字一样；网站主要看到的是业务连接的最终出口。当前数据面绑定分离已有基础，但Home完整链DNS及出口连续性资格仍是待实现/验证项。

### 2.2 Owner 明确选择默认直连实验模式，不只是扩大国内白名单

最新澄清以本节为准：**Home 名单 → 云第一跳 + assigned Home；已审阅云名单 → 云出口；其余受支持普通流量 → DIRECT。** 这是用户显式可选的第二种模式；稳定模式仍保留当前默认云出口。前一次只读讨论中“仅扩大国内白名单、其余仍走云”的收窄建议不再作为本次目标；若以后只交付那个备选范围，必须明确标注，不冒充本模式完成。

- 普通游戏的登录、下载、对局与语音是目标体验；普通 TCP/UDP 不受现有国内域名表或 reviewed web 端口集合限制。当前未命中 UDP 的拒绝与 IPv6 支持边界必须逐平台处理，不能只把 MATCH/final 改成 DIRECT，再宣称游戏已可用；不承诺所有游戏/反作弊驱动兼容。
- Home 的域名、地址与可信应用保护仍先匹配；Home SOCKS 链不支持的 UDP/QUIC 不得掉进普通 DIRECT。云名单也需明确 UDP/QUIC、DNS与传输失败规则；不支持时拒绝或由客户端重建受支持连接，不偷偷回退直连，不自动重放有副作用请求。
- 云名单要包括实际播放/登录/CDN依赖，不能只加入首页域名；共享命名空间不能一概全走云，Home重叠仍优先。未列出的海外业务会直连，可能无法访问，这是模式语义，不是自动翻墙或自动加规则的承诺。
- 优先评估复用现有 TUN/Core 对流量分类，再通过绑定物理接口的 DIRECT 出口发送。具体路径需评审；不能先撤掉 TUN、PF/WFP 或让所有 App 任意出物理网，再依靠域名规则“补保护”。现有端口/进程许可不足以实现普通游戏任意端口的直连，新许可须与 Home/云约束一起审查，不直接扩大 root/Core 的所有端口许可来绕过准入。
- 默认 DIRECT 是数据路由选择，不等于把系统 DNS 放回 DHCP。继续用受控解析入口分离 Home、云和普通查询，保留基础设施 bootstrap 与 LAN命名边界；普通游戏能直连不意味着其 DNS入口可使 Home查询直出。缓存/IP字面量/自带DoH无法被识别的风险仍按§4.3处理，不能从“未命中名单”推导“已证明是普通流量”。
- 正常运行时 Home单独故障不应影响已分类普通游戏；Core/特权组件死亡时的独立防线仍是§5的准入项。用户选择实验模式不授权降低 Home保证，也不把 fail-open 变成合格的故障处理。

## 3. 当前已有的能力，以及不能沿用的证明

以下是基线源码事实，不是设备抓包或线上配置证据。

| 项目 | 当前源码 | 对新模式的意义 |
|---|---|---|
| 默认路由 | Mac `ConfigPipeline+Runtime.swift:856–862` 的 MATCH，以及 `ConfigPipeline+SingBoxProduct.swift:355–367` 的 final；Windows `runtime-template.json:25–34` 都指向 Tono-Exit | 当前是默认代理，改一个 final/MATCH 不够；PF/WFP、DNS 和特权准入也依赖旧合同 |
| 已有国内直连 | Mac `ConfigPipeline.swift:111–176` 内置国内suffix，`AppState+Catalog.swift:738–798` 在有效policy下构造plan；Windows `config.rs:39–87` 和 `connection/direct.rs:2177–2184` 在native pins存在时附加国内suffix | 国内直连不是从零建立；但补这张表仍是白名单，不等于名单外默认直连 |
| 物理出口许可 | Mac `tooling/scripts/core-helper/KillSwitchPF.swift:510–559` 是session tuples/有TUN时root reviewed ports；Windows `wfp_model.rs:909–1016` 是有TUN的Locked状态下staged Core tuples/reviewed TCP ports | 既有许可不覆盖普通游戏任意UDP端口；改路由最终规则不自动获得许可，也不能撤防火墙代替新合同 |
| Home 链 | Mac `ConfigPipeline+SingBoxProduct.swift:196–203`、Windows `sing_box/runtime.rs:312–348` 中 SOCKS5 的 detour 为 Tono-Exit，Home 不做最终云出口兜底 | 保留两跳；其他 home_proxy 表示必须证明同一拓扑后才能准入，不能只凭名字叫 Home |
| Home绑定与Cloud选择 | `services/control-plane/src/catalog.ts:175–231` 按用户读取Home绑定，停用/缺失Home返回503；Mac `AppState+Proxy.swift:135–164` 改selectedNodeName、`AppState.swift:2879–2896` 单独取Home；Windows `connection/core_select.rs:219–237` 分别传selected和Home | 切Cloud不需要重新分配Home，这是配置构造事实，不是切换中无泄露/无迟到effect的设备证明 |
| 家宽IP及节点额度 | `services/control-plane/src/home.ts:130–146,245–270` 的egressIpv4是绑定元数据，未进入上述catalog路由构造；`ops/quota.ts:354–372` 给运维周期额度/估算 | 未找到由此强制固定实际公网IP或自动安全切节点的证明；绑定/预期IP/实际出口/供应商额度不可混算 |
| 上游 DNS | Mac `ConfigPipeline+SingBoxProduct.swift:214–235,335–346`、Windows `runtime-template.json:3–18` 默认为云出口 DoH；Mac 的部分 DIRECT DNS另走国内 DoH | 加密且经云出口，不等于上游 DNS 经家宽末端，也不等于任意客户端无法绕行 |
| 客户 DNS 身份 | fake-IP；Mac `ConfigPipeline+SingBoxProduct.swift:236–244` 拒绝旧 slot；controller 查询需要真实答案 | 必须保留客户端/控制查询分离及过期身份拒绝；fake-IP 答案本身不证明上游出口 |
| Mac 实际 resolver | `SystemProxy.swift:538–697` 读取有效 DNS、动态 split DNS 和 `/etc/resolver`；`AppState+Connect.swift:440–480` 要求系统查询及浏览器配置通过 | 读取失败不是安全；单次读回不证明未来不会被别的 writer 改写 |
| Windows 连接 DNS 探测 | `connection/probes.rs:368–496` 允许 system/TUN 任一 fake-IP 成功 | 必须区分 TUN 监听成功与实际系统 resolver 成功；TUN-only 不能作为新模式严格准入 |
| Windows 有效策略 | `dns/resolver_policy.rs:3–111` 单列 advisory；查询/读失败不能证明冲突，也不证明安全 | 新模式需要自己的有效策略与 Home 端到端准入，不能只检查适配器注册表或 last_error |
| 浏览器 | Windows `browser_dns.rs:1–145` 是 Chrome/Edge 已知配置位置只读检查；两端另有约一分钟周期复查 | 不覆盖便携版、启动参数、内存状态和所有 App；复查周期不是零泄露机制 |
| 故障后的 AI 窄层 | [selective-fail-open](../selective-fail-open.md)、Windows `selective_layer.rs:1–6` 明确 best-effort | 不能覆盖缓存/IP 直连/自带 DoH/全部共享 CDN；不能作为新模式的独立严格防线 |
| LAN | [决定 085](../decisions/085-2026-10-10-macos-local-network-devices-setting.md)：Mac 默认关闭；Windows `wfp_model.rs:664–777` 有 LAN 许可且阻止 Core 使用它 | 有基础，但不证明所有手机功能、企业网或 IPv6 on-link 可用；两端不完全相同 |

路径入口：[Mac runtime](../../apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift)、[Mac resolver](../../apps/macos/Tono/Core/SystemProxy.swift)、[Windows runtime](../../apps/windows/crates/tono-core/src/sing_box/runtime.rs)、[Windows DNS proof](../../apps/windows/app/src-tauri/src/tono/connection/probes.rs)、[Windows resolver policy](../../apps/windows/service/src/core/dns/resolver_policy.rs)、[Windows browser preflight](../../apps/windows/app/src-tauri/src/tono/browser_dns.rs)、[Windows route sampler](../../apps/windows/app/src-tauri/src/tono/connection_routes.rs)。

既有条目须按最新实现和评论核对，而非重复创建或沿用旧缺陷描述：[Windows GPO/NRPT #1145](https://github.com/raydocs/tono/issues/1145)、[#1280（当前签名策略绑定已由 #1646 部分处理）](https://github.com/raydocs/tono/issues/1280)、findings 中 `WIN-DNS-RACE-MASKS-SYSTEM`、`WIN-NRPT-NO-REFRESH`、`WIN-DNS-ENABLE-NO-FLUSH`、`MAC-CONTINUITY-ONLINK-PF`。这不宣称所有条目都已实机复现，或一律阻断无关文档工作。

## 4. Home DNS 合同：入口、解析、缓存与数据流都要约束

### 4.1 “不泄露”必须明确给谁，以及何时成立

要求：受支持、已准入的 Home 业务，其 DNS 问题不得从用户物理公网出口发给 ISP、路由器 DNS、普通 DIRECT DoH，或从云端第一跳直接发给递归 DNS；实际目标连接的最终出口必须是批准的 Home。上游 DNS 走本机 → 云节点 → Home → TLS 验证的递归解析器。

只经云节点 DoH并不是本地明文泄露；但它不满足本提案更严格的家宽末端 DNS 路径要求。DoH 递归解析器仍能看到查询域名，权威解析也仍会发生；这里不承诺匿名、解析器看不到域名、平台永不封号或任意本地恶意/root 程序都无法绕过。

严格资格只授予已明确支持的客户端、系统、协议和网络组合。测试模式默认 DIRECT 不是“任何程序产生的任何 AI 请求都能识别”的证明。第三方代理、另一 VPN、企业策略、系统加密 DNS、自带 DoH、ECH、端口变化或未知版本超出已证明边界时，不能仍显示 Home 严格保护已成立。

### 4.2 一个受控本地 DNS 入口，三个经过审阅的上游类别

候选正常路径继续让需要域名分流的客户使用受控本地 DNS/fake-IP 入口，在 Core 内区分 Home、云和普通 DNS；**不把整机 DNS直接改回 DHCP 并假定域名规则仍可靠**。这是候选结构，不是 Core 死后的可用性方案。

- Home DNS：专用、固定 IP 端点的 DoH/TCP，经云 → Home 完整链；TLS 名称/证书校验保留，不增加 skip-cert-verify。不使用不受 Home SOCKS5支持的 UDP/QUIC。
- Home 的主/备解析器都经同一批准链。超时、SERVFAIL、REFUSED、NXDOMAIN 等响应按明确合同处理；所有 Home 解析失败的末尾必须拒绝，不能跌入 cloud/DIRECT/default DNS。NXDOMAIN 不能被重试到普通 DNS“修好”。
- CNAME、HTTPS/SVCB、AAAA 和后续递归/地址拨号按同一受保护解析上下文处理；CNAME 改到共享 CDN 不能重新按普通域名分类并漏出。真实地址查询、controller 查询、预取也不能另走较弱路径。
- 缓存按解析类别、策略代次与 Home身份隔离或失效，负缓存也一样；云/普通DNS的旧答案不能混入Home缓存并被报成“本次Home解析已验证”。同一已证明Home上下文中的缓存命中可用，但要保留来源和有效期；不同账户/绑定/网络/模式切换重新准入。
- 家宽代理和云节点自身地址是基础设施 bootstrap，不是 Home 业务 DNS。必须有经过审阅的、单独批准的解析或固定地址路径，校验端点与记录；Home 的可用性不能依赖先经它解析它自己。固定 DoH IP只是消除解析器端点的依赖循环，不解决 Home hostname、API 或云节点 bootstrap 的全部问题。
- 云 DNS只供云类业务；普通 DNS经批准的直连解析路径。开始测试前固定普通解析器选择、网卡绑定、企业内部命名空间与门户处理，不让系统未受控地把 Home 查询混入这些类别。
- LAN `.local`/mDNS 和明确企业内部资源单列。允许访问路由器网页不等于允许 Home 向路由器查询；Home 域名解析到 private/link-local 不能绕过保护去直连。不得覆盖企业 DNS/GPO 或开放整个私网 DNS作为补救。

这些更改须检查两端实际 Core 版本/能力及所有被支持的运行时。不能将 sing-box 的 detour/fake-IP 结构未经验证复制给 Mihomo，也不静默用旧 runtime 运行新模式。两跳DoH会增加延迟和Home负载；在同条件下分别测冷/暖DNS、TLS建连、复用/缓存和故障恢复，不能为得到更快数字开启链外fallback。

### 4.3 缓存及绕行不是 DNS 端口规则能解决的

阻断物理 53/853 能约束常规 DNS/DoT/DoQ 的部分出口，不会辨认 HTTPS/443 里的 DoH；IPv6、非标准端口、DNSCrypt 等也需明确支持边界。不使用全网 443 或整段 CDN 阻断作为补救。

- 接入前缓存的 A/AAAA、已存在 TCP/QUIC、旧 fake-IP slot、负缓存必须有转移规则。冲刷系统缓存不等于清除了浏览器或 App 的缓存，也不终止现有连接。
- 域名信息缺失时，不能因为“不匹配 Home 名单”就当普通 DIRECT；可能是已缓存的 Home/CDN 地址。这类客户端/流在有可执行的分类或阻断机制前不取得严格资格。
- 原生 App可评估可信程序身份；Claude Code等共享 Node/Python运行时不能仅按 node.exe/python 进程名锁定或放开。Mac PF只按地址/端口/接口/UID，不是应用身份防火墙；Windows WFP有应用条件也不等于能区分同一浏览器的 AI 与普通页。
- 浏览器配置扫描作为诊断/准入的一部分，不当作实时强制器。必须证明运行时自带 DoH、ECH、扩展代理、便携版/参数等的约束；约一分钟一次轮询不能封住变更到发现之间的流量窗口。

## 5. 故障安全与普通网络独立：当前架构尚未证明

必须分开以下场景：

1. **Home 故障、Core仍健康：** 阻断 Home 业务；允许名单外普通 DIRECT；云类按其路径可用性处理，不自动改最终 Home 身份。
2. **云第一跳故障：** Home链和云类都可能不可用。若现有安全恢复允许换云第一跳，按§2.1保持assigned Home、末端身份与DNS合同并重证新链；切换窗口也不得链外解析/拨号。不在本提案新增自动选节点/换城/传输机制。
3. **Core/Helper/Service死、卡住、重启：** 本地 DNS和按名分流可能一起消失。必须证明独立 Home防线先成立，再允许普通网络/DNS恢复；只写“守护进程会很快重启”不能关闭这项。
4. **DNS writer/broker迟到、旧重连排队：** 单次读回/超时不证明未来不会修改。未结束旧 effect仍有 owner；不能仅凭 generation/CAS宣布其已失效。新 Connect准入必须等待真实终结或有已证明的拒绝机制。

需要实现前逐平台回答：谁在 Core之外拥有 Home防线、能看见什么身份、谁能撤销、开机/重启如何恢复、怎样在普通网络放开前检查，以及哪些失败会阻止新模式准入。每个保护/DNS/代理 effect要有 guard → effect → 终结/读回/迟到处置表；锁或持久化失败不得开始一个未登记的 mutation，超时不退休 owner。系统 broker接受工作后，child退出或 reboot不自动等于 broker/持久配置/队列终结。

**这是新模式的可行性阻塞，不由本 PR选择一个未经证明的平台实现。** 不能以“已知 AI IP + DNS沉洞”替代严格机制，也不能让“停 Core→恢复普通 DNS”制造 Home 暴露窗口。反过来，保留全机 block-all只是安全回退，达不到普通网络独立；若只有这个回退可证明，新模式不对用户开放。

两类目标可能在通用浏览器/共享 CDN/非受控客户端上冲突：普通未知 HTTPS允许直连，但系统看不到其中是否是 Home业务。必须提交可执行的分类/约束机制、限定支持面，或承认无法满足并不准入。不能把未见反例、用户接受风险或七天稳定升级成机制保证。

与 A13独立的含义是不改它的释放队列/更新 fencing设计，不是这些底层能力已经与分流无关。若新模式需要仍暂停的恢复机制或尚未通过的跨进程 ownership模型，其 nightly需等该依赖另行批准；不能自行恢复 #1504/#1569工作。

## 6. 特权信任与模式生命周期

- 新模式不是 unprivileged sidecar。Helper/Service仍验证调用者、完整运行时与保护策略，不允许 App在IPC里任意提交 DIRECT规则；[现有 #1280](https://github.com/raydocs/tono/issues/1280) 的适用缺口必须在新模式准入中明确关闭。
- 一份被审阅的不可变模式合同同时描述路由、DNS、Home身份和许可。持有者记录 mode、策略摘要、session/Core身份与实际生效组件证据；只接受匹配且新鲜的回执。签名证明授权来源，不证明策略安全；Home底线不得被签名 cloud/DIRECT规则覆盖。
- 使用明确 capability和合同读回门。App本地版本、一个 /version字符串或未知字段没报错，不足以证明守护进程已实施新模式；旧/不可读/不匹配的 Helper/Service拒绝启用，不盲调用新接口。
- 新模式默认关闭、不迁移已有设置、不远程自动开启；稳定模式保持原有合同。新增代码即使开关关着仍需验证对稳定模式没有回归，不能用“默认关闭”替代证明。
- 首版只允许在未连接且旧工作已结清时改选择；不为了切模式自动断开、解除保护或做热切换。清洁 disconnected必须有证据，不是UI布尔值。已有 teardown/reload/DNS effect未终结时，Connect不准入；界面给出等待/无法确认，不无期限转圈。取消等待不取消旧 effect的所有权。
- LAN保留明确选择；不静默改 stable版的默认关闭行为。nightly中的允许本地设备仍需用户选择，且不绕过 DNS/Home准入；on-link/global IPv6、企业VPN与手机发现另行测试，不能把RFC1918等同于全部本地设备。
- 无Home绑定或绑定无效不能用云出口冒充此模式的Home保证；禁用测试模式并解释。恢复到已有模式也要用户明确选择，不静默降级。
- 显式退出/恢复网络属于用户结束保护，应展示真实分项结果；DNS/代理/AI hold读不回或旧writer仍未终结时不能说全部恢复。这里不新增queue-independent release，不承诺60秒恢复或改变现有更新合同。

## 7. UI 与证据：当前 readback 和未来稳定性分两轴

设置建议：“智能分流（实验）”，解释Home宽名单、其他海外代理名单和默认直连。开关明确标注nightly、支持边界和不保证服务商账号风控。

必须直白告知：**未列入 Home/云名单的普通流量使用用户本地公网出口，不受全局VPN代理；实验模式默认关闭，不改变已有稳定模式。** 游戏兼容性与协议支持如实列出，不把用户主动开启当作 Home 泄露或未知证据的免责。

内部及验收记录分开保存：

- **当前分项事实：** 本次系统resolver、Home DNS实际链、数据出口、PF/WFP、代理、LAN的 readback / observed / failed / unknown，以及时间、session、策略摘要、组件身份。
- **迟到稳定性资格：** 有机制支持并经场景验证 / 未证明 / 不支持。单次readback、boot观察或抽样没见泄露不授予这一资格。

当前读回正确不是“完全不可知”，但也不是“以后绝不泄露”。“Home严格防护已生效”只在当前必要证据全部通过、资格有效且无unfinished owner时显示。证据未知要撤销这个声称，并采取已证明的安全行为；轮询刷新状态不替代实时约束。

现有 `/connections`抽样约每分钟一次、有512连接上限，并报告Core声称的chain；短连接可能遗漏，不能证明DNS出口或完整无泄露。验收要用两端实际网络路径/受控resolver接收证据及时间对齐，不能从普通网站返回的IP推导AI/DNS也正确。

## 8. 实现拆分与准入：先代码合同，再设备，再用户

owner 已授权桌面实施和测试；当前执行顺序与产品决定门以 §0 为准。每个实现 PR 有自己的准确 SHA、窄回归和高风险独立审查；不把未验证原型直接打给用户，也不把实施授权扩展为候选/合并/发布授权。

1. **锁基线和合同：** 确认owner稳定包及组件；冻结宽Home清单、云出口清单、支持客户端/OS/Core版本、普通DNS/企业网策略。未审 cloud名单不靠热门网站全表或国家IP猜测；固定nightly包内非秘密名单优先，任何远端变更需独立授权/审阅，不重解释现有v1–v4 DIRECT策略给旧客户端。
2. **平台可行性/ownership评审：** 提交§5独立Home防线、数据身份与DNS生命周期的具体实现设计，解决明确反例。拒绝原型依赖或平台能力不足时停止该平台，不宣布两端都可做。
3. **路由与DNS实现：** 保留既有Home链与优先级，加入已审阅云名单和默认DIRECT的普通TCP/UDP路径；同步Core与特权许可，明确IPv6/游戏支持面。Home末端DoH增强单独锁定与实现，DNS失败终止、CNAME/缓存/协议规则不得因放宽普通流量退化。客户端、Helper/Service使用同一合同及准入。策略编译测试从公开结果验证Home优先于cloud/DIRECT、普通游戏端口真能直出、无链外解析，不只断言配置键存在。沿用现有测试文件，每个行为最窄回归，不铺私有helper/mock调用顺序测试。
4. **故障及LAN实现：** 与系统writer/恢复所有权的边界明确后才实现；批准的设备上验证Core故障、分项恢复和LAN。修改Helper/Service必须更新对应协议/合同，App、Core、特权组件同SHA配套。
5. **nightly入口与UI：** 同一产品的显式可选模式，发布仅测试候选。新增受限候选入口，不把签名workflow放开到任意PR；[现有macOS candidate](../../.github/workflows/macos-release.yml) 只允许指定稳定候选ref，不能当作已有任意nightly通道。沿用 [BUILD_AND_TEST](../BUILD_AND_TEST.md) 的宿主与签名边界。
6. **设备安全验收 → 小范围一周 → 发布决定：** 各阶段由owner确认受众/设备/动作；未过设备安全门，不拿真实AI账号替代验证。正式更新源、版本与升级/恢复验收走独立发布批准，不因nightly稳定跳过下一版G3。

## 9. 设备 G0 与可区分错误实现的验收场景

本 PR未执行任何一项。两台测试设备、权限、恢复路径和测试受众尚未指定/确认。

**G0先于故障实验：** 明确可恢复Mac/Windows DUT与OS/架构、管理员授权、外部于DUT网络的控制/恢复途径；先证明断网后仍能操作并恢复。保存原PF/WFP、DNS有效及持久配置、NRPT/GPO、路由、代理、服务、LAN开关和稳定包；预演支持的回退，不任意覆盖公司GPO或清整个防火墙。CI/VM只提供其实际环境证据，不能替代真实Wi-Fi/睡眠/企业策略/手机发现。使用受控域名/解析器/测试账号，保护凭据，不做TLS中间人或第三方不知情的注入。

在G0与对应阶段授权之后，至少覆盖以下可区分输入，每项同时记Home正/负路径和普通业务对照：

| 场景 | 错误实现会怎样 | 必须看到的结果 |
|---|---|---|
| Home与cloud/DIRECT重叠；国内AI子域对普通父域 | 规则顺序使AI直连 | Home优先；普通兄弟域走其合法类别 |
| 名单外普通TCP/UDP受控目标，含UDP 27015等非reviewed端口；游戏登录/下载/对局/语音与稳定模式对照 | 只改final，仍被Core终止UDP或PF/WFP端口限制拦住；仅网页可用冒充游戏通过 | 实验模式普通流量确实从本地出口到达，无需新增游戏域名白名单；Home/云对照仍走各自链路；真实游戏/反作弊兼容性单独记结果 |
| Home/云服务尝试UDP/QUIC、直接IP及复用旧连接；同时运行普通UDP对照 | 为游戏放开通用UDP时，Home或云失败也直出 | 普通UDP可用但受保护业务不落入DIRECT；受控观测能发现短暂绕行，不只看最终规则 |
| Home主备DoH故障、超时及NXDOMAIN | 跌入默认DNS/用另一类别“修好” | Home终止，无链外查询；普通查询仍按其路径 |
| CNAME/HTTPS记录到共享CDN | 别名重新分类后DIRECT解析/拨号 | 原Home上下文保持；同CDN普通站不被整段误封 |
| 接入前缓存A/AAAA、已有TCP/QUIC、旧fake-IP及跨类别缓存 | 没域名就按普通直连，或云解析缓存冒充Home来源 | 拒绝或受控收敛，不漏；普通长连接影响如实记录，缓存来源不被伪报 |
| Chrome/Edge配置中途变化、便携/参数DoH、ECH | 扫描间隔或漏扫描窗口内直连 | 强制机制阻止绕行，或该配置不准入；不能仅事后报警 |
| system查询失败但TUN成功；foreign NRPT/GPO、Mac supplemental DNS | 把监听器成功/写注册表当系统通过 | 分项证据不被掩盖，不强制抹除外部策略，不声称严格通过 |
| Home第二跳断，云第一跳仍通 | 偷退云IP | Home数据和DNS均失败；名单外普通业务继续 |
| 云A故障/节点供应商额度耗尽，手动改云B，再改云C；含切换失败及旧Core迟到 | 重绑Home、只验证云出口、DNS临时另走或旧代覆盖新链 | 同一assigned Home；受控数据及DNS接收端看到批准Home出口，切换全窗口无链外业务；新链重新准入，普通业务作对照，不靠跨云绕过账户限制 |
| SOCKS端点/绑定不变，但供应商逐连接轮换或实际家宽IP改变 | 单次探测通过就声称所有后续请求身份固定 | 观察能检出身份变化；未经证明的固定/粘性机制不获持续资格，Home新业务不准入；同绑定不冒充同公网IP |
| Core/daemon死亡与重启、已缓存数据直连 | 沉洞无效，普通恢复先放开Home | 独立Home阻断已成立后才放普通；做不到就不准入 |
| 卡住/迟到DNS effect、取消等待后新Connect、重复操作 | CAS更新UI但旧OS操作覆写新会话 | unfinished owner挡准入或有已证明的拒绝；当前readback与未来资格分开 |
| LAN开关、手机/NAS/打印机、IPv4/IPv6、Home解析私网地址 | 为本地设备打开路由器DNS或绕行 | 合法LAN可用，Home不直连私网/路由器DNS；不宣称全手机功能已覆盖 |
| 旧/错配Helper/Service、无Home绑定、策略不可读 | 盲调用后静默降级 | 模式拒绝准入，稳定模式仅由用户明确选择 |
| 退出/恢复/卸载/回退，代理或AI删除读回失败 | 普通网页通就说恢复成功 | 分项真实结果与残余可恢复；不遗留无主规则/凭据 |
| 开关关闭，与稳定包同条件对照 | 新代码改变原模式行为 | 路由、DNS、失败处置、升级和隐私合同未回归；未知项如实保留 |

先验负对照必须证明观测能发现泄露：在隔离且另授权的环境故意制造链外查询/短暂旧effect，受控接收端与抓取端必须捕获；时序要包含请求前后、解除与新Connect，不能只在最终稳态截图。DoH内容加密时，用受控resolver接收记录或明确的出口证据，单靠看到443包不能证明查询内容或Home出口。负对照漏检就停止依赖它的后续验收。

物理网卡可见批准云入口的加密连接是正常链路，不是AI明文直连；判定要区分云入口、Home/DoH终端、普通DIRECT，不能把“物理网上有包”全判泄露。阴性窗口未见包仅是有覆盖限制的观察，不证明所有将来运行。

## 10. 一周试用、候选与回退

- 先取得安全门的具体机制审查与设备证据，再由owner指定受众/平台/账号；用户知道实验边界，明确选择新模式。没有创建schedule，不承诺后台自动监测或一周后自动推进。
- 记录每个受测候选的准确source SHA、策略摘要、包/组件哈希、签名/公证、OS、网络、Home版本/身份、模式及暴露窗口。连续一周不能混算多个包；保护机制实质修改后重做受影响安全验收，修正版重新计试用窗口。
- 首要零容忍项：受支持Home范围内有链外DNS/数据、错误出口、unknown被报成verified、旧effect改写新会话。普通业务故障、长期未知、无法退出/恢复也停止扩量并定位；不能只用“没有投诉”判稳定。性能/失败率与稳定包同条件比较，接受阈值在试用前由owner固定，不事后降低。
- 自动诊断沿用 [隐私合同](../diagnostics-privacy.md) 和用户已有选择；不为本实验默认上传域名、完整IP、URL、内容或账户凭据。受控抓包单独同意、受限保存与脱敏，不提交仓库。AI相关遥测仍需其现有独立授权。
- 两个包共享同一系统Helper/Service。独立下载/更新源不等于设备隔离，不并跑；nightly安装和退回要有明确配套组件交接与系统状态证明。
- 更新floor/版本可能拒绝降级，不能把“重新装旧包”写成保证。回退按 [RELEASE_LINES](../RELEASE_LINES.md) 准备：必要时将稳定好源码重建为更高build/sequence，经批准发布恢复候选；不禁用安装/信任门。先评估是否真正需要安装floor改变及升级合同，不编造序列号。
- 通过一周仅是发布输入；正式包需对应同一已验收候选并满足签名、安装/升级、恢复、受众和发布批准。既不自动推进Sparkle/windows-updates，也不改变0.0.75包/标签。

## 11. 给 Claude 的审查问题与下一步

请先判断要求是否一致及可实现，再审后续代码；设计文档通过不等于实现、设备或生产通过。按§3基线复核引用，不沿用未合PR的能力。

1. Home链、Home DNS与云bootstrap的依赖图是否有循环？所有查询路径/CNAME/真实查询是否保留正确解析类别？
2. 默认DIRECT下，缺少域名的缓存/IP连接、自带DoH与同进程浏览器业务，具体由什么不可绕过机制分类或拒绝？PF/UID或WFP/AppId是否足够？
3. Core/daemon死亡时，谁独立保护Home、何时普通DNS可以恢复？能否同时满足普通网络独立，而不是凭窄沉洞或整机block-all给严格模式通过？
4. 有效resolver/企业策略、所有浏览器运行时变化如何约束？Windows TUN-only成功、读失败advisory和周期轮询不能继续冒充严格证据。
5. Helper/Service是否真正验证同一合同及Home底线？是否有任意DIRECT注入、旧组件混配、假回执、系统writer迟到或retired owner复活路径？
6. Home名单与普通业务、LAN/手机/GPO的误伤边界是否如实；是否遗漏CNAME、IPv6、SVCB、现有流和动态网卡？
7. G0、正负对照、跨组件时间证据、停止/回退及一周试用是否可执行？候选签名入口、更新floor和稳定模式回归是否留有绕过？
8. 云第一跳切换是否真正保留assigned Home及完整链DNS？固定/粘性家宽机制能保证什么、何时失效；能否区分同绑定与实际出口变化、节点供应商额度与用户账户限制，并拒绝有副作用请求的自动重放？
9. 默认DIRECT是否真覆盖普通游戏TCP/UDP而非现有web端口白名单？TUN/Core路径与PF/WFP新许可如何同时保留Home/云隔离，避免不支持的QUIC或无域名连接掉进DIRECT；Home末端DNS额外增强是否与这一改造分开定义和验收？

当前按 §0 推进 #1572 与本 PR 合同准备；三个产品决定确认后继续对应实现，不重新请求已经给出的实施授权。**仍未闭合：Core 故障可用性边界、未分类去向与 Home resolver 合同；普通 DNS 独立路径及特权准入需实现，家宽实际解析/身份连续性、DUT/G0/回退和升级恢复需证据。** 当前 PR 仍不是“智能分流 nightly 已完成”，不能合并、发布或更新客户 feeds。
