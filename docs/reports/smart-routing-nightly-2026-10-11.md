# 下一版智能分流 nightly：Home 链路与 DNS 防护设计提案

日期：2026-10-11；三层合同续记：2026-10-17。状态：**#1572 已合并；#1571 已增加双端三层运行时、DNS、严格会话与设置入口，正在准确 head CI/独立审查，尚未设备验收。Owner 最新明确“名单以外的都直连”：21视频云例外 → 166 AI/具名 Home → 明确云名单 → 其余受支持普通流量默认 DIRECT（含未分类），取代此前未知拒绝。已授权实施和测试，未授权合并或发布。**

归属：[SHIP_PLAN](../SHIP_PLAN.md) G1/G2 的后续桌面版本；保持现有 0.0.76 客户 RC 和正式 feeds 不变，不修改 G1–G3 勾选。具体产品版本由 owner 另定。

原始源码参照：[main a8b0be2d](https://github.com/raydocs/tono/commit/a8b0be2d5701dbabdb644699547398bdefb99a26)；本次并入 [origin/main b3c61853（#1572 合并）](https://github.com/raydocs/tono/commit/b3c6185309bcba13627038ccaaf60de596db829d)。§3 原始行号属于旧参照，不冒充当前行号。现有 [0.0.76 RC](https://github.com/raydocs/tono/releases/tag/tono-desktop-0.0.76-rc.20261016.1) 是客户测试候选，不包含 #1572 或本模式，也不是稳定资格或可直接覆盖任意旧版本的证明。

本次在原 PR 继续合同及实现，保留原名单条目和顺序。以下 §0.1 记录本轮实际源码与限制；后文设计目标不自动变成已实现或已验证能力。实施、定点测试、独立审查可继续；合并、打包、签名、部署、发布或客户扩量未获授权。A13 / #1504 仍不恢复；#1569 已合入，不能再称未合依赖，但其存在不等于本模式的恢复/设备验收通过。移动端仅考虑复用合同，本轮不实现 iOS/Android，不改 rw8/Tono-droid。

### 0.1 本轮可执行源码与明确支持面

- 同源快照：`tooling/scripts/sing-box/three-tier-template.json` v2，现有4 Model API/166 Home/21视频不变；保留10个显式国内DIRECT/11个明确云完整主机名。不需要全面地域库，其他受支持普通流量也默认DIRECT。名单和精确图的更新走源码评审、生成/漂移校验与客户端/特权组件重建，不加载 latest、用户文件或远程规则集。
- 两端编译并由 Helper/Service 精确准入同一内联 route/DNS 图。21视频先于166 Home，再明确云，最后普通公网IPv4 TCP80/443 DIRECT；已命中Home/云的解析或拨号失败终止，不回落DIRECT。IPv6、非DNS UDP/QUIC、LAN和其他普通端口拒绝；保留Home IPv4 CIDR保护。缺Home/云不准入；不支持HY2或任意游戏UDP。**ECH、应用自带DoH、缓存/裸IP可能隐藏AI身份而走默认DIRECT，不能保证未识别AI走Home。**
- 每类在Core内部显式真实解析：Home固定1.1.1.1 DoH经云→Home，海外经云，国内固定223.5.5.5 TLS DoH绑定物理NIC；客户端取得fake-IP。显式resolve后再转发已解析IP，避免SOCKS供应商的域名解析替代批准DoH。DNS答案和真实第二跳仍需抓包/受控接收端验证。
- 模式默认`stable`，Mac/Windows设置均有明确入口及中英文支持面说明，本地意图键为Mac `desktopRoutingMode` / Windows `desktop_routing_mode`，值`three-tier`。只在Connect捕获，无远程开关；保存偏好不改变当前会话/自动断开或解除保护。模式/快照/选云改变须显式Disconnect/Restore后重新Connect，不能热切换；Home凭据不自行重分配。Mac三层会话/下次意图存在时禁用LAN控件但保留stable偏好。
- Windows持久化运行时SHA、owner/token/generation、release generation和派生云端点，原Service DIRECT gate不撤；仅live受绑定Core/TUN可得TCP80/443许可，恢复只装block。Mac复用root快照/release authority绑定SHA，原生许可限定物理NIC及root UID，不冒充PID级隔离；Helper重启后重新装block，不承诺Helper启动前开机零流量。Core/特权故障、自动失败/Quit不结束strict意图，显式带栅栏release仍可恢复网络。
- 健康检测：云证明失败后，受保护国内DNS/TLS可让健康Core继续服务国内，明确降级且不计为Home/云成功。Mac启动也可降级；Windows初始准入仍要求云证明，不能声称两端冷启动云故障可用性完全一致。单一国内探测站故障仍保守恢复。主机/网络实际变化、Core死亡或双路径失败保持严格保护。
- 回归源码覆盖优先级/默认DIRECT与DNS/保护组不降级、准入负例、捕获模式、永久strict watchdog、重启无旧grant、显式release、Windows成功移除WFP后marker清除失败及Mac国内降级。Linux只执行便携/前端检查；原生CI、设备/G0、升级/回退、换云后Home出口连续性和一周试用各自单列。#1071/#1504、#1605/#1643不由本单元宣称解决。

## 0. 实施入口：先完成有共识的范围，再闭合产品取舍

### 已确认与当前源码事实

- **先 #1572，后 #1571：** [Home 扩域 PR #1572](https://github.com/raydocs/tono/pull/1572) 保持现有默认云出口；166 个 Home 后缀和 21 个明确云视频例外延续已批准政策，不等于智能模式。YouTube 的 Google API 子域等具体例外先于宽 Google Home 和进程 fallback；除这些明确例外，Home 仍不得被签名云/DIRECT 规则覆盖。Twitch 仍属本模式待锁定名单，不能声称 #1572 已覆盖。
- [#1569 已于 2026-10-12 合入](https://github.com/raydocs/tono/pull/1569)：当前 Mac `ReleaseAuthority.swift`/`ReleaseWorker.swift` 和 Windows `core/release/` 已有 release generation、Connect 准入与 unfinished writer/broker 终结证据。应复用并核对模式摘要/旧 writer 的适用面，不另造 ownership 框架；不把合入或源码审查当作真实系统 effect 已恢复。
- [#1646 已于 2026-10-13 合入](https://github.com/raydocs/tono/pull/1646)：Windows Service 对新 Start/Stage 拒绝 DIRECT，替换文档需签名策略与成员关系准入。不能再把 [#1280](https://github.com/raydocs/tono/issues/1280) 的旧“只有形状校验”描述套用全部当前入口，也不能把它当成任意默认 DIRECT 或策略新鲜性已经获准。
- Windows 当前 `sing_box_runtime.rs` 仍要求 `route.final = Tono-Exit`，HTTPS DNS 必须 `detour = Tono-Exit`；编译器 DIRECT 没有独立 resolver。普通 DNS 若依赖断开的云节点，“普通网络独立”目标就不成立。这是需要客户端和 Service 同一有界新合同的实现工作，不只是设备证据缺失，也不能简单撤掉现有拒绝。
- Home SOCKS 的 `detour = Tono-Exit` 可从配置核实；抓到 SOCKS `ATYP=domain` 只证明委托 Home 解析，不能确认供应商使用哪个 resolver。当前云 DoH 不是本地明文泄露；Home 解析位置/实际出口必须另测。

### 三层语义与已确认的 Home 保护组

最新 owner 要求锁定：**具体视频云例外 → AI/具名 Home → 明确云名单 → 其余受支持普通流量默认DIRECT，包括未分类。** 名单缺席不是非AI身份证明，只是默认路由选择；域名不可见导致未识别AI直连是必须公开的覆盖边界。不为全面地域分类阻塞实施，UDP/IPv6支持仍另列。

与 #1572 的冲突不在三层拓扑，而在**名单语义**：166 个 Home 后缀刻意包含非 AI 的 Google 搜索/Gmail、GitHub 下载、Reddit/TikTok 媒体和支付/验证码依赖，不能直接重命名为 AI 分类。21 个 YouTube/Pornhub 视频例外属于非 AI 海外走云，与新地域目标相容；`youtubei.googleapis.com` 必须继续先于宽 `googleapis.com`，不能被所谓 AI 父域吞掉。Twitch 不是 #1572 的新增批准表。

**Owner 已选择 A（“就这些都按 ai 走家宽好了”）：** 保留原 166 项为具名 Home 保护组，不分拆删除；AI/这些明确例外先于地域。这里是路由策略分组，不声称 Google 搜索/GitHub 下载等在事实层面都是 AI。范围仍为当前已批准条目及其既有后缀语义，不无限扩大共享父域；21 视频例外维持原优先级。没有新的产品问答阻止已授权的桌面实施，本 PR 仍不获合并/发包授权。

### 不再作为启动前问答的安全边界

[原审查](https://github.com/raydocs/tono/pull/1571#issuecomment-6117460125) 及 [更正](https://github.com/raydocs/tono/pull/1571#issuecomment-6117533750) 的三个问题没有因新要求被自动批准。按 [暂定安全决定](../decisions/128-2026-10-17-desktop-three-tier-routing-boundaries.md) 保留严格边界，不再要求 owner 逐项重答后才工作：

- 新模式的 Core/特权组件死亡或分类可信性丢失时保持整机 fail-closed，不为普通网络开放通用物理许可。现有显式退出/恢复网络是用户结束保护，沿用其独立合同；不以本设计假称当前旧模式的自动恢复已改变。
- 普通未分类流量按owner最新决定默认DIRECT；缓存IP/自带DoH/ECH隐藏AI身份可能进入该路径，不能假称Home。已识别Home/云不因失败降级DIRECT，旧模式默认云不变。未准入UDP/IPv6/端口仍拒绝。
- 保留固定已评审 DoH/TLS 和 Home DNS 完整两跳要求，不接受未经审阅的供应商 resolver 替代。具体受信任端点、能力与准入仍须实现/验证；`ATYP=domain` 不是解析器身份证明。

### 最小实施顺序与退出条件

1. **已完成：** #1572 准确 head [1d8dbe222](https://github.com/raydocs/tono/commit/1d8dbe222b43d3e86ab685e7ca725cc5ac4deb23) [CI38979699885](https://github.com/raydocs/tono/actions/runs/38979699885) 成功、[独立 high](https://github.com/raydocs/tono/pull/1572#issuecomment-6226391618) 覆盖闭合、无未解决 review threads 后，按本轮明确授权合入 b3c61853。未出包、未做设备验收，见 [合并前回执](https://github.com/raydocs/tono/pull/1572#issuecomment-6231242493)。
2. Home 组政策已闭合，按 §2.2 固定可维护的分类快照、DNS与准入合同；先消除 Mac/Windows/Service 的名单漂移，再加入地域分类。只支持实际评审的 sing-box 产品路径，兼容 YAML 不静默承载新模式。合同可供未来移动端复用，不先新增移动端接口。
3. 同一合同同时落入客户端编译器、Helper/Service 准入及物理许可；先验证开关关闭的稳定模式未变，再验证普通 DNS/游戏的正例和 Home/视频/未知流的负例。Mac root/Core 任意端口许可、Windows 新 DNS detour 或 final 不得通过删除现有校验实现；各自先给有界机制和回归。
4. 复用当前 release generation/writer 账本，核对模式切换、迟到 DNS、Core/daemon 故障及再次 Connect。必须单独保留 [#1071/#1504](https://github.com/raydocs/tono/issues/1071) 的 Mac abandoned upgrade AI-hold 缺口和 [#1605](https://github.com/raydocs/tono/pull/1605) 的 Windows DNS 恢复收尾；未合修复、旧 head 的 major 或绿色 CI 均不自动转成当前实现结论。这两项不与分流扩域混为已解决。
5. G0/带外恢复就绪后，再做双端设备 DNS/QUIC、Home A→B→C 云切换、故障/升级回退的正负对照；没有对应证据不开放三层测试模式。一周小范围试用及任何新候选/正式推广仍需另行授权。

以下按最新默认DIRECT政策读取；原 changelog/PR历史评论中的未知拒绝只保留溯源。当前 #1605 是 OPEN/Draft [8439e5a06](https://github.com/raydocs/tono/commit/8439e5a06a5214bc6a0b1994ab8ca9ac5e59f6c3)，包含旧 R4 审查后的 debt-commit 续修；不能把 a529 旧 Major 直接套到新 head。它与 #1071/#1504、#1643 均未由本 PR 验收或合并。

## 1. Owner 已表达的目标与本提案的边界

- 同一 App 代码里新增用户主动选择的测试模式，先通过独立 nightly 候选分发。稳定客户版和客户更新源不动，不新增第二个争抢同一 Helper/Service 的 App。
- 保留当前宽 Home 名单作为具名保护组；不把这张表冒充服务事实分类，不据此扩新域。
- **Home 是链式代理的家宽第二跳：本机 → 云节点 → Home → 目标服务。不能将其改成本机直接连接的独立家宽出口。**
- 视频/明确云名单走云，AI/具名Home走Home，其余受支持普通流量DIRECT；游戏只按已支持协议，不承诺任意游戏可用。三层模式LAN拒绝，stable本地设备偏好保留。
- Home 必须优先安全，不能为连接成功改用云端最终出口或直连。普通业务不应因 Home 单独故障被整机拖断。
- 候选先验证安全，再让明确加入的用户稳定使用一周；不是七天后自动发布，也不是对服务商封号/地区政策的保证。

本提案增加的严格验收要求不是已有能力：Home 业务的上游 DNS 经完整两跳链、Core 健康时 Home 单跳故障不拖断已分类国内业务、Core 故障时 fail-closed、跨代操作不能覆盖新会话。其具体实现必须单独评审。不能静默回退到较弱模式或把未知结果显示成已保护。

Home 末端上游 DNS 是本提案额外提出的增强，不是现有链路重建的理由，也不能反推当前经云 DoH 等于 ISP 明文泄露。地域分流与该增强分开记录证据，但两者都须满足同一候选的准入；不能把它们混称为“现有功能已验证”。

## 2. 路由目标：Home 优先，而不是按国家 IP 决定安全

```text
已识别 AI / 具名例外  ──→ 云节点 ──→ Home 家宽 ──→ 受保护服务
视频例外 / 明确云    ──→ 云节点 ───────────────→ 网站
其余（含未分类）     ──→ 本地物理网络 ─────────→ 公网IPv4 TCP80/443
不支持协议/端口/LAN  ──→ 拒绝
```

规则语义为：入口/旧fake-IP/保留地址拒绝 → 21视频例外 → 166 Home域名/既有Home CIDR → 显式国内/云 → 普通DIRECT。解析后再次拒绝私网答案；非支持端口末尾拒绝，不是任意端口放行。已匹配route为终止动作，resolve/拨号失败不重新分类或fall through。既有Home应用进程保护不被新模式冒称具备，当前图按域名/CIDR识别。IP字面量、DNS回答和既有连接不能假定携带服务身份。

不做 `GEOIP,CN` 前置。国内AI子域依然先Home；名单外海外也默认DIRECT，不称全面地域分流。共享CDN/裸IP缺乏身份时可能普通DIRECT，原Home域名上下文仍需保留，不能把已识别保护流量解析后重分为普通流。

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

### 2.2 分类数据、编译与特权准入的同一合同（目标；实际有界实现见 §0.1）

新三层模式显式可选，stable保持默认云；**其余普通流量默认DIRECT（含未分类）**，不需要全面国别库。国内AI仍先Home，明确云名单仍先云；未识别AI可能普通DIRECT，不能伪造分类覆盖率或任意AI保证。

当前已核实的复用边界：

| 所有者 | 可复用的当前实现 | 必须新增的有界合同 |
|---|---|---|
| 分类来源 | Windows `direct_domains.rs` 与 Mac `ConfigPipeline.swift` 的审核名单和 protected-child 检查 | 同一版本的 AI、Home 例外、非 AI 国内/海外类别及来源/许可/摘要；两端消费同一规范化快照，而非手写两份独立国别表。新 AI 项逐项评审，不把全部 geosite AI 标签自动变成 owner 批准 |
| 地域数据 | Mac legacy GEOIP/GEOSITE不作新模式信任输入 | 现有10显式DIRECT/11明确云hosts随包固定；其他普通目的地DIRECT。无全地域库阻塞，也不引入远端分类授权 |
| 可信装载 | Mac Helper `CoreManager.snapshot` 只复制摘要绑定的 config.json；Windows `sing_box_runtime.rs` 禁止任意 `rule_set`/文件 | 优先在有尺寸上限的规范化快照上编译内联规则，特权端验证来源摘要、模式和完整图；不因加地理规则撤掉文件/远程规则禁止项或 8 MiB 上限。放不下时不准入，另评审受信任资产协议 |
| DIRECT 授权 | Windows `direct_admission.rs` 绑定签名策略与既有形状，Mac 有 endpoint/受审应用许可 | 新模式能力版本+精确 country-DIRECT 形状、AI/视频前置保护、快照成员关系与端口/端点限制一起验证；不把 geosite 行作为签名即安全，也不借 process DIRECT 绕过目标分类 |
| 路由末尾 | 旧模式 `final=Tono-Exit` 保留 | 新模式保护组后普通TCP80/443 resolve/私网拒绝/DIRECT，剩余不支持流拒绝；final与默认DNS同步DIRECT合同，特权端精确比较，不撤stable旧门 |

**已实施的同源单元：** `direct_domains.rs` 保持现有4个 Model API、166个 Home、21个视频后缀的唯一手写来源；Windows Core/Service共用该文件和三层图，`tooling/scripts/sync-routing-domains.mjs --write` 生成Mac原三数组及App/Helper共用的 `ThreeTierRoutingContract.swift` 图。`--check` 与CLI回归进入ci-gate无条件changes job，Rust-only编辑不能跳过漂移检查。三层模式现有地域覆盖和原生准入见§0.1，不扩大到全量国家库或所有App。

Windows `prebuild.mjs` 的 MetaCubeX `latest` 下载/按 mtime 复制，以及 Mac 已有 `geoip.dat/geosite.dat` 资源，**不是现有受信任更新通道**。首版不新增远端分类更新；以后需要更新时，签名来源/版本、内容摘要、大小/语法限制、旧版本拒绝、跨账号/模式缓存失效与恢复必须在同一授权更新事务里验证，不重解释旧 v1–v4 DIRECT 策略。最后已验收快照只在同账户/绑定/合同且仍有效时可继续用；缺失、损坏或无有效快照则拒绝模式准入，不退到全直连。

DNS按业务上下文：Home固定DoH经云→Home，明确云经云，普通默认经绑定物理NIC的223.5.5.5 TLS。所有支持的客户端A查询先fake-IP，Core真实解析仍按原域名分类；不是恢复DHCP DNS。保护组解析失败终止，不改用普通resolver；CNAME/缓存身份与实际出口待设备验证。

协议边界不由新需求自动放开：Home SOCKS/Reality 不支持的 UDP/QUIC 拒绝，不物理回退；海外 UDP 仅在批准传输实际支持时走云。国内 UDP/游戏只有业务/目的端点分类及 Core 专属物理许可共同完成才开放，非 443 端口不是证明。IPv6 保留当前业务禁用边界，AAAA/字面 IPv6不能绕分类；系统 NDP/DHCPv6 维持现有许可，不以“国内”开放IPv6出站。先交付并验证有界 TCP/IPv4 路径，不把它说成所有国内游戏/IPv6已实现。

模式切换只在旧 writer/broker 已终结且明确 disconnected 时进行；记录并读回模式、分类快照摘要、签名策略修订、Home绑定、Core身份和 release generation。规则更新/回滚不能让旧 DIRECT 或迟到 DNS effect跨代复活。App/Helper/Service能力不匹配拒绝启用，不用复用旧UI开关或静默云/直连降级冒充新合同。

## 3. 当前已有的能力，以及不能沿用的证明

以下是基线源码事实，不是设备抓包或线上配置证据。

| 项目 | 当前源码 | 对新模式的意义 |
|---|---|---|
| 默认路由 | stable原final指向Tono-Exit | stable保留；三层同源图v2保护组后普通DIRECT，DNS与Helper/Service准入同步变更，非只改final |
| 已有国内直连 | Mac `ConfigPipeline.swift:111–176` 内置国内suffix，`AppState+Catalog.swift:738–798` 在有效policy下构造plan；Windows `config.rs:39–87` 和 `connection/direct.rs:2177–2184` 在native pins存在时附加国内suffix | 可复用国内规则，但不是完整国别分类；未知不能由“不在AI表”推导非AI |
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

严格资格只授予已明确支持的客户端、系统、协议和网络组合。国家分类和嗅探不是“任何程序产生的任何 AI 请求都能识别”的证明。第三方代理、另一 VPN、企业策略、系统加密 DNS、自带 DoH、ECH、端口变化或未知版本超出已证明边界时，不能仍显示 Home 严格保护已成立。

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
- 域名信息缺失且Home CIDR也未匹配时，按最新默认策略可普通DIRECT；可能实际是缓存Home/CDN地址，必须披露，不能授予“任意AI严格Home”的资格。已匹配保护上下文不得抹掉再走默认路径。
- 原生 App可评估可信程序身份；Claude Code等共享 Node/Python运行时不能仅按 node.exe/python 进程名锁定或放开。Mac PF只按地址/端口/接口/UID，不是应用身份防火墙；Windows WFP有应用条件也不等于能区分同一浏览器的 AI 与普通页。
- 浏览器配置扫描只是诊断/现有准入，不当作实时强制器；自带DoH/ECH等隐藏身份的覆盖缺口公开显示，不能靠约一分钟一次轮询声称任意AI不会默认DIRECT。

## 5. 故障安全与国内业务隔离：保持严格边界

必须分开以下场景：

1. **Home 故障、Core仍健康：** 阻断 Home 业务；已分类国内业务及其 DNS 按批准 DIRECT 路径继续，海外按云路径继续，不自动改最终 Home 身份。批准的非 AI Home 例外也会失败，不宣称所有普通页面都不受影响。
2. **云第一跳故障：** Home链和云类都可能不可用。若现有安全恢复允许换云第一跳，按§2.1保持assigned Home、末端身份与DNS合同并重证新链；切换窗口也不得链外解析/拨号。不在本提案新增自动选节点/换城/传输机制。
3. **Core/Helper/Service死、卡住、重启：** 新模式整机 fail-closed，撤销“已保护”声称，直到同一模式合同重新准入。不得先放普通网络再补 Home 沉洞；“很快重启”不是防线。用户主动结束保护的显式恢复另走现有 release 合同，不把本方案扩展成 #1504 的恢复改造。
4. **DNS writer/broker迟到、旧重连排队：** 单次读回/超时不证明未来不会修改。未结束旧 effect仍有 owner；不能仅凭 generation/CAS宣布其已失效。新 Connect准入必须等待真实终结或有已证明的拒绝机制。

需要逐平台评审 Core 专属 DIRECT 许可怎样在死亡/卡住时被撤销且全机保护仍成立；Mac 现有 root 端口许可不等于 Core 专属身份，Windows AppId 也不区分浏览器站点。新模式不能沿用旧模式自动释放普通网络的路径而只改UI文案。每个保护/DNS/代理 effect须有 guard → effect → 终结/读回/迟到处置表；锁或持久化失败不开始未登记 mutation，超时不退休 owner。系统 broker接受工作后，child退出或 reboot不自动等于 broker/持久配置/队列终结。

**Core 健康时的单跳故障隔离，与 Core 死后的全机阻断是两个不同承诺。** 不再要求现有 PF/WFP 按共享 CDN 域名在 Core 死后继续分类。普通网络独立仅在 Core/分类仍可信且对应 DIRECT/DNS路径已准入时成立；全机阻断是合法安全结果，不得以“恢复成功”展示。

普通未知HTTPS允许直连时，系统未必能看到是否实际为Home业务。本版按owner决定实现默认DIRECT并公开此覆盖边界，不承诺任意AI保护；已识别Home/云故障不降级和Core死后的整机floor是另外两项仍要实施验证的保证。未见反例或七天稳定不升级成机制保证。

与 A13独立的含义是不改它的释放队列/更新 fencing设计，不是这些底层能力与分流无关。复用已合 #1569，但若模式所需保证仍依赖 #1504/#1605/#1643 的未合修复，就列为具体阻塞，不自行恢复这些 PR，也不把其旧审查结论移植到当前 head。

## 6. 特权信任与模式生命周期

- 新模式不是 unprivileged sidecar。Helper/Service仍验证调用者、完整运行时与保护策略，不允许 App在IPC里任意提交 DIRECT规则；[现有 #1280](https://github.com/raydocs/tono/issues/1280) 的适用缺口必须在新模式准入中明确关闭。
- 一份被审阅的不可变模式合同同时描述路由、DNS、Home身份和许可。持有者记录 mode、策略摘要、session/Core身份与实际生效组件证据；只接受匹配且新鲜的回执。签名证明授权来源，不证明策略安全；Home底线不得被签名 cloud/DIRECT规则覆盖。
- 使用明确 capability和合同读回门。App本地版本、一个 /version字符串或未知字段没报错，不足以证明守护进程已实施新模式；旧/不可读/不匹配的 Helper/Service拒绝启用，不盲调用新接口。
- 新模式默认关闭、不迁移已有设置、不远程自动开启；稳定模式保持原有合同。新增代码即使开关关着仍需验证对稳定模式没有回归，不能用“默认关闭”替代证明。
- 可随时保存下次连接意图，但仅旧工作结清、显式disconnect/reconnect后捕获新模式；不自动断开、解除保护或热切换。清洁disconnected需证据，不是UI布尔值。已有teardown/reload/DNS effect未终结时Connect不准入；取消等待不取消旧effect所有权。
- 三层模式LAN拒绝；stable原局域网偏好及默认关闭不变。Mac控件在三层已选/仍由会话捕获时禁用但保留偏好；on-link/global IPv6、企业VPN与手机发现不冒称已支持。
- 无Home绑定或绑定无效不能用云出口冒充此模式的Home保证；禁用测试模式并解释。恢复到已有模式也要用户明确选择，不静默降级。
- 显式退出/恢复网络属于用户结束保护，应展示真实分项结果；DNS/代理/AI hold读不回或旧writer仍未终结时不能说全部恢复。这里不新增queue-independent release，不承诺60秒恢复或改变现有更新合同。

## 7. UI 与证据：当前 readback 和未来稳定性分两轴

Win/Mac设置现有稳定/三层入口，中英文及新旧外观；保存仅下次显式连接生效，不自动断开或解除保护。渲染/持久回读测试与实际设备资格分开。

必须直白告知：**21视频例外云、166 AI/具名Home、明确云、其他受支持普通流量默认DIRECT（含未分类）；ECH/缓存IP/自带DoH隐藏AI可能直连，不保证任意AI走Home。普通DIRECT仅公网IPv4 TCP80/443，UDP/QUIC/IPv6/LAN阻断，Core死仍fail-closed。默认stable不变。**

内部及验收记录分开保存：

- **当前分项事实：** 本次系统resolver、Home DNS实际链、数据出口、PF/WFP、代理、LAN的 readback / observed / failed / unknown，以及时间、session、策略摘要、组件身份。
- **迟到稳定性资格：** 有机制支持并经场景验证 / 未证明 / 不支持。单次readback、boot观察或抽样没见泄露不授予这一资格。

当前读回正确不是“完全不可知”，但也不是“以后绝不泄露”。“Home严格防护已生效”只在当前必要证据全部通过、资格有效且无unfinished owner时显示。证据未知要撤销这个声称，并采取已证明的安全行为；轮询刷新状态不替代实时约束。

现有 `/connections`抽样约每分钟一次、有512连接上限，并报告Core声称的chain；短连接可能遗漏，不能证明DNS出口或完整无泄露。验收要用两端实际网络路径/受控resolver接收证据及时间对齐，不能从普通网站返回的IP推导AI/DNS也正确。

## 8. 实现拆分与准入：先代码合同，再设备，再用户

owner 已授权桌面实施和测试；继续同一个 #1571，每个交付 head 有准确 SHA、窄回归和高风险独立审查；不把未验证原型直接打给用户，也不把实施授权扩展为候选/合并/发布授权。

1. **锁基线和合同：** 确认owner稳定包及组件；冻结宽Home清单、云出口清单、支持客户端/OS/Core版本、普通DNS/企业网策略。未审 cloud名单不靠热门网站全表或国家IP猜测；固定nightly包内非秘密名单优先，任何远端变更需独立授权/审阅，不重解释现有v1–v4 DIRECT策略给旧客户端。
2. **平台可行性/ownership评审：** 提交§5 Core故障fail-closed、单跳故障隔离、数据身份与DNS生命周期的有界实现，解决明确反例。能力不足时停止该平台，不宣布两端都已具备。
3. **路由与DNS实现：** 保留视频/Home/明确云优先，其他受支持普通流量默认DIRECT，同步Core与特权许可；保护组DNS/拨号失败终止，不fall through。用独立预期覆盖名单优先、普通未知域名/裸IP、fake-IP默认DNS、私网拒绝与unsupported端口，不把数据结构通过冒称设备流量通过。
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
| 已分类国内/海外两个普通受控目标，含UDP 27015等非reviewed端口；游戏登录/下载/对局/语音与稳定模式对照 | 所有游戏直连，或只改final却仍被PF/WFP拦住 | 国内从本地出口到达，海外从云到达；未完成准入的协议明确拒绝，不冒充所有游戏已通过；Home对照仍走两跳 |
| Home/云服务尝试UDP/QUIC、直接IP及复用旧连接；同时运行普通UDP对照 | 为游戏放开通用UDP时，Home或云失败也直出 | 普通UDP可用但受保护业务不落入DIRECT；受控观测能发现短暂绕行，不只看最终规则 |
| Home主备DoH故障、超时及NXDOMAIN | 跌入默认DNS/用另一类别“修好” | Home终止，无链外查询；普通查询仍按其路径 |
| 云失联但Core健康；国内A解析/HTTPS与海外/Home负对照 | 国内DIRECT的resolver仍依赖云，或为了成功恢复DHCP DNS | 国内批准加密DNS和DIRECT仍工作，海外/Home失败或重证新云，不物理回退 |
| 规则快照缺失/篡改/超限/旧版本、更新中止、回滚与旧Core迟到 | 只校验App摘要，特权端接受任意国别规则；失败退全直连 | 不匹配/无效合同拒绝准入；同一模式/账户/有效快照才可保留，旧DIRECT/DNS effect不跨代 |
| CNAME/HTTPS记录到共享CDN | 别名重新分类后DIRECT解析/拨号 | 原Home上下文保持；同CDN普通站不被整段误封 |
| 接入前缓存A/AAAA、已有TCP/QUIC、旧fake-IP及跨类别缓存 | 把无法识别的AI直连说成已保证Home | 旧fake-IP拒绝；未识别公网IPv4 TCP80/443可普通DIRECT，明确记录覆盖边界，不假称缓存Home来源 |
| Chrome/Edge配置中途变化、便携/参数DoH、ECH | 声称扫描即保证任意AI保护 | 若隐藏域名/CIDR则可默认DIRECT，UI和验收必须披露；已识别Home正对照仍不降级 |
| system查询失败但TUN成功；foreign NRPT/GPO、Mac supplemental DNS | 把监听器成功/写注册表当系统通过 | 分项证据不被掩盖，不强制抹除外部策略，不声称严格通过 |
| Home第二跳断，云第一跳仍通 | 偷退云IP | Home数据和DNS均失败；名单外普通业务继续 |
| 云A故障/节点供应商额度耗尽，手动改云B，再改云C；含切换失败及旧Core迟到 | 重绑Home、只验证云出口、DNS临时另走或旧代覆盖新链 | 同一assigned Home；受控数据及DNS接收端看到批准Home出口，切换全窗口无链外业务；新链重新准入，普通业务作对照，不靠跨云绕过账户限制 |
| SOCKS端点/绑定不变，但供应商逐连接轮换或实际家宽IP改变 | 单次探测通过就声称所有后续请求身份固定 | 观察能检出身份变化；未经证明的固定/粘性机制不获持续资格，Home新业务不准入；同绑定不冒充同公网IP |
| Core/daemon死亡与重启、已缓存数据直连 | 沉洞无效，普通恢复先放开Home | 新模式全机fail-closed，诚实显示阻断；Core重证前不放普通网络，显式恢复按独立合同 |
| 卡住/迟到DNS effect、取消等待后新Connect、重复操作 | CAS更新UI但旧OS操作覆写新会话 | unfinished owner挡准入或有已证明的拒绝；当前readback与未来资格分开 |
| LAN开关、手机/NAS/打印机、IPv4/IPv6、Home解析私网地址 | 为本地设备打开路由器DNS或绕行 | 合法LAN可用，Home不直连私网/路由器DNS；不宣称全手机功能已覆盖 |
| 旧/错配Helper/Service、无Home/无云绑定、策略不可读 | 盲调用后静默降级或把Home改为云/直连 | 模式拒绝准入；运行中单跳故障按类别隔离，稳定模式仅由用户明确选择 |
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
2. 地域分类前如何保持Home特定子域/视频例外优先？缺少域名的缓存/IP连接、自带DoH/ECH是否确实拒绝，而非凭CN地址或未命中AI表放行？
3. Core/daemon死亡时DIRECT许可是否撤销且全机fail-closed？Core健康时的Home/云单跳故障隔离，是否仍依赖故障的云DNS？
4. 有效resolver/企业策略、所有浏览器运行时变化如何约束？Windows TUN-only成功、读失败advisory和周期轮询不能继续冒充严格证据。
5. Helper/Service是否真正验证同一合同及Home底线？是否有任意DIRECT注入、旧组件混配、假回执、系统writer迟到或retired owner复活路径？
6. Home名单与普通业务、LAN/手机/GPO的误伤边界是否如实；是否遗漏CNAME、IPv6、SVCB、现有流和动态网卡？
7. G0、正负对照、跨组件时间证据、停止/回退及一周试用是否可执行？候选签名入口、更新floor和稳定模式回归是否留有绕过？
8. 云第一跳切换是否真正保留assigned Home及完整链DNS？固定/粘性家宽机制能保证什么、何时失效；能否区分同绑定与实际出口变化、节点供应商额度与用户账户限制，并拒绝有副作用请求的自动重放？
9. 国内/海外游戏是否按同一可信快照与实际协议能力走不同出口，而非扩大root任意端口？特权端是否拒收App的错误/过期分类图、任意规则文件和混配合同；Home末端DNS是否单独有完整路径证据？

当前 #1572 已合；#1571 按已确认 Home保护组和三层语义继续实施，不重新请求已经给出的授权。**仍未实现：共享地域数据及双端编译/特权准入、独立国内DNS、Home固定DoH、模式生命周期/故障约束；家宽实际解析/身份连续性、DUT/G0/回退和升级恢复仍需证据。** 当前 PR 不是“智能分流 nightly 已完成”，无合并、发布或更新客户 feeds 授权。
