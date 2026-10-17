## 2026-10-11 · 下一版智能分流 nightly 与 Home DNS 防护设计提案
- 归属：SHIP_PLAN G1/G2 的下一版设计准备；不进入 0.0.75 G4 冻结候选，不关闭发布门。
- 来源：源码参照 [main a8b0be2d5701dbabdb644699547398bdefb99a26](https://github.com/raydocs/tono/commit/a8b0be2d5701dbabdb644699547398bdefb99a26)；分支 `docs/home-strict-smart-routing-nightly`，本 PR 未合 main。该源码不冒充 owner 的已确认稳定包。
- 缺陷修复：无产品修复；引用既有 #1145 / #1280 和 DNS findings，不重复创建或宣称关闭。
- 新增/优化：[完整设计提案](../reports/smart-routing-nightly-2026-10-11.md)：同一 App 可选测试模式、独立 nightly 分发，保留宽 Home 名单与本机 → 云节点 → Home 的两跳链；提出 Home DNS 完整链路、默认直连、特权准入、故障隔离及审查要求。
- 工程与测试：只新增文档；包含区别错误实现的设备验收矩阵、G0/负对照、Claude 审查问题、一周试用和回退边界。未编写 harness，未改变源码/协议/策略/CI。
- 验证：在 Linux orb 核对准确 main 的相关源码及现有 Issue；本 PR 的本地链接、文档限定范围和 whitespace 检查见 PR 验证回执。产品测试、网络抓包、Mac/Windows 设备验收、故障实验均未执行；无既有 CI 结果被冒充本设计的行为证明。
- 候选/发布：仅设计文档，无新候选、签名/公证或发布；不触发 workflow，不改 Sparkle / windows-updates / 生产策略。A13 保持暂停，不并入 #1504/#1569 的代码或未经证明的能力。
- 剩余限制：默认 DIRECT 下独立严格 Home 防线、浏览器/缓存/IP 绕行约束、有效 DNS 准入、稳定包身份、DUT/带外恢复、云名单和可安装回退候选尚待明确。设计审阅不等于实现、实验或生产批准；后续阶段需相应准入。

### 2026-10-11 续记 · Cloud 可换，assigned Home 保持
- Owner 补充：云第一跳故障/节点供应商额度耗尽时，手动切 Cloud 仍保持 assigned Home 与完整链 DNS；自动选节点仅为后续设想，本轮不实现。
- 源码与要求分开：现有按用户 Home 绑定与 Cloud 选择是独立配置；绑定/凭据相同不证明实际公网 IP 不变，egressIpv4 元数据及运维额度估算不冒充数据面固定身份/供应商执行证据。补固定/粘性身份前提、切换窗口验收与 Claude 审查入口，不承诺平台风控通过、无缝会话或副作用请求自动重放。
- 交付/验证：继续 [Draft PR #1571](https://github.com/raydocs/tono/pull/1571)，仍只有上述两份文档；续记的准确 head、本地文档校验和 CI 状态以 PR 回执为准。无产品/设备/网络测试，无 nightly 包、自动切换或发布；家宽连续性机制及切换证据仍待明确。
- 运营前提补充：owner 确认保持同一家宽供应商与用户原 assigned Home，由运营维护固定分配；客户端不自行轮换。提案将“尚未决定是否固定”与“实际配置/切换证据尚未核验”分开，不把运营承诺升级为抓包或持续出口证据。

### 2026-10-11 续记 · 游戏与默认 DIRECT 的可选实验模式
- Owner 明确范围：保留宽 Home 名单；YouTube/Twitch/Pornhub 等拟列入经审阅的云名单；其余受支持普通流量默认直连，包括游戏。此选择取代只读讨论里“只补国内白名单、未命中仍走云”的收窄建议；稳定模式不变、实验默认关闭，不远程强开。
- 现有实现与新增合同分开：国内直连已有基础，但普通游戏UDP/任意端口不在既有PF/WFP许可中。补§2.2、源码定位、游戏正负路径验收和用户本地公网出口提示；保留Home/云优先、DNS分流、失败不降级与未识别流准入边界。Home末端DoH是额外候选增强，不把当前云DoH误称ISP明文泄露。
- 交付/验证：仍仅更新原提案/changelog；准入机制、具体云域名/依赖、游戏/IPv6支持面及故障独立防线待审阅和设备证据。准确head及本地文档检查/CI见PR回执；无产品实现、实验、nightly、合并或发布，A13暂停不变。

### 2026-10-16 · 已授权桌面实施，先闭合现有 PR 与三个产品决定
- 继续原 #1571 和 #1572，不新建替代实现；本 PR 当前仍只改提案/changelog。0.0.76 客户 RC、正式 feeds 与移动端不动，不合并、出包或发布。
- 纠正旧基线：并入并核对 [origin/main 345774bc](https://github.com/raydocs/tono/commit/345774bc9b163f5c16af47c37adbc036b0bd11ca)。#1569 恢复 generation/writer 终结合同已合，#1646 Windows DIRECT 签名策略绑定已合；复用并核对适用面，不再把它们写成全部未实现，也不把合入当设备验收。
- 实施顺序：先完成 #1572 的 Home 扩域、视频例外与跨端回归；owner 确认 Core 故障可用性、未分类流量、Home resolver 三个取舍后，锁同一模式合同，再做双端编译/特权 DNS及物理许可、恢复生命周期、G0设备与试用。推荐不是已批准政策，默认 DIRECT 模式尚未实现。
- 当前 Windows final/DNS detour 准入与普通 DNS 依赖云路径是必须实施的新合同边界；ATYP=domain 只证明委托解析，不证明 Home resolver。#1071/#1504 和 #1605 收尾保持独立，旧 head 的 major 或 CI 不能充当当前结论。
- 验证：本轮仅文档链接/范围/whitespace检查，准确 head 回执见 PR；产品、设备、DNS/QUIC、故障/升级/回退和一周试用未执行。设计阻断仍按提案 §0 交 owner 具体选择，不用新功能掩盖旧恢复风险。

### 2026-10-17 · 三层合同与同源名单准备
- 归属：SHIP_PLAN G1/G2 的后续桌面版本；继续原 Draft #1571，不合并或发布。并入 [main b3c61853 / #1572](https://github.com/raydocs/tono/commit/b3c6185309bcba13627038ccaaf60de596db829d)，#1572 已准确 head CI/独立审查后合入，不再作为未合依赖。
- 最新 owner 政策取代历史默认 DIRECT：原21视频云例外先于Home；AI及原166项具名Home组→云→assigned Home，其余确认非AI国内→DIRECT、海外→云，未知拒绝。Owner选择A保留原Google/Gmail、GitHub、Reddit/TikTok及具名依赖，不把这些服务事实归类为AI，也不扩共享父域。游戏按地域和已支持协议，不一概直连。
- 新增/优化：[决定128](../decisions/128-2026-10-17-desktop-three-tier-routing-boundaries.md)保留严格fail-closed、未知拒绝与固定已审DoH边界，不把未回答的三个安全取舍冒充owner批准。当前无新的产品问答阻止继续桌面实施。
- 工程与测试：Windows Core/Service既有共用`direct_domains.rs`成为三端名单的唯一手写来源；新增生成/校验CLI及一条公有CLI回归，只同步Mac原数组。ci-gate无条件changes任务检查漂移，Rust-only名单编辑也覆盖；保持原4 Model API、166 Home、21视频的精确值和顺序。未新增country列表、三层模式开关、运行时/特权协议或物理许可。
- 已运行（Linux Orb）：`bash tooling/scripts/test-policy-signing-contract.sh` exit0，CLI回归1 passed/0 failed、域名4/166/21一致，原签名合同5/5；随后将同步门移至ci-gate独立步骤，签名脚本恢复原状。独立Python比对main b3c61853→工作树：三数组值/顺序不变，数组外Swift无行为变化，Rust仅说明注释，`git diff --check`通过。最终head的检查/独立审查及CI以PR回执为准，不将本地源码比较冒充原生执行。
- 未执行：三层国内/海外编译与准入、国内独立DNS/Home固定DoH、模式生命周期、原生/设备/G0、DNS/IPv6/UDP/QUIC、换云/恢复/升级和一周试用。#1071/#1504、#1605/#1643保持独立；不沿用旧head审查定罪新head，不称本PR解决它们。
- 候选/发布：仅源码准备；0.0.76 RC、稳定feeds、版本/标签不变，无新包或移动端改动。下一单元为同源地域快照及客户端/特权端同一有界合同，不以客户端final修改或放宽旧Service gate替代。

### 2026-10-17 续记 · 双端有界三层运行时与严格会话
- 归属：SHIP_PLAN G1/G2 后续桌面版，继续原 Draft #1571。以上各日期“设计/准备-only”描述仅对应当时提交，本轮已增加运行时代码；未合并/发布。
- 双端编译器与Mac Helper/Windows Service共用精确route/DNS图，保留21视频→166 Home→国内/海外→未知拒绝顺序；Home固定DoH经云→Home，海外经云，国内固定DoH绑定物理NIC。分类快照v1仅10国内/11海外完整主机名，不冒充全量地域覆盖；IPv6、业务UDP/QUIC、LAN及未分类流拒绝，不扩大Home/视频表。
- Windows strict合同持久化运行时摘要、owner/token/generation与release generation，云物理端点由准入图派生，拒绝稳定模式stage/DIRECT覆盖，watchdog不再30tick自动释放strict。Mac Helper绑定root快照摘要、generation及strict意图，重启/Core死亡只恢复block；root UID/NIC许可不冒充Core PID隔离或Helper启动前开机保护。显式带栅栏release仍可恢复网络。
- 模式默认关闭、Connect一次捕获；没有客户UI开关。变更模式/规则/云节点须先显式Disconnect，旧会话不能被后改偏好替换。健康Core在云证明失败但国内受保护DNS/TLS证明成功时保留国内能力并报告降级，不把它记为Home/云通过；Windows冷启动仍要求云路径证明。
- 回归源码覆盖顺序/身份/协议/DNS、缺Home拒绝、旧稳定编译不变、严格准入负例、捕获模式、持久化重启无旧grant及显式release、Mac国内降级。准确head的本地检查、原生CI和独立high结果以PR验证回执为准；没有执行结果的原生/Red/设备测试不记通过。
- 剩余：不是所有国内/海外业务可用；页面依赖/游戏/自带DoH/未知IP仍可能拒绝。设备DNS真实路径、第二跳出口/固定身份、模式切换恢复、网络变化/睡眠/重启、升级/回退、G0及一周试用未验收。#1071/#1504、#1605/#1643独立保留，不称解决。
- 候选/发布：0.0.76 RC、feeds、版本/标签、移动端不变；仅源码Draft，未新建包、合并或客户推送。

### 2026-10-17 续记 · 首轮运行时CI/独立审查的集中修正
- 首轮准确head [0c60a578](https://github.com/raydocs/tono/commit/0c60a578b0d3bc76197fd5d134f3617959914eed) 的 [CI39018619586](https://github.com/raydocs/tono/actions/runs/39018619586) 失败：Windows Service摘要LowerHex编译、Mac构建来源fixture缺新增合同输入，以及Mac三层回归的保留地址Home fixture/两条未本地化提示。仅修定点原因，不删断言、不跳测试、不放宽public地址准入。
- 独立high对该head判定3个安全Major：live Core运行图绑定、Windows strict继承stable LAN物理许可、丢失strict记录后的启动恢复。各记独立finding；本次集中补拒绝运行中strict绑定、strict撤回LAN FilterSpec、grant前独立持久strict判据与显式release清除。stable原合同保留。相关minor（verified Bootstrap重启保留云pin）一并收紧为Blocked floor。
- 既有Mac真实Core生命周期回归扩展显式/推断两条绑定拒绝，Windows真实FilterSpec仲裁及Service传递断言覆盖LAN/IPv6/SSDP边界，单条持久恢复回归覆盖缺失/损坏/不可读会话记录、失败release与显式成功release。准确新head CI/增量独立复核以PR回执为准，未执行的native Red不记通过。
- 本轮仍非全量地域分类或客户功能验收：快照仅10国内/11海外完整主机、实验默认关闭且无客户UI。设备真实DNS、第二跳身份/换云、网络变化/睡眠/重启、升级回退和G0/试用仍待真机；不动候选/feeds，不合并或发版。
