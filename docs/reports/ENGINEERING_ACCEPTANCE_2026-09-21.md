# Tono 工程整改与组合验收记录 — 2026-09-21

本记录对应[所有者任务书](https://github.com/raydocs/tono/blob/8189417eebcc946e742da7c1f4d37e3dda004ee0/docs/ENGINEERING_QUALITY_ACCEPTANCE.md)，不是部署、客户发布或发布门关闭许可。第 1–8 节保留工程交付时的历史状态；所有者随后授权的 main 合并、内部候选与测试准入结论见第 9 节。没有改客户更新源、签名发布、节点操作、远端 D1 或权限放宽。

## 1. 源码与交付身份

- 仓库 `raydocs/tono`；组合分支 `fix/g1-engineering-acceptance-20260921`；[Draft PR #267](https://github.com/raydocs/tono/pull/267) → `main`。
- 主线程、macOS/services 两个独立实现 Orb、后续独立审查 Orb 均读取环境确认 `AMP_INITIAL_AGENT_MODE_KEY=gpt-6-astra-max`。没有用普通 Ultra 或不明模式 subagent 替代；同时最多两个子 Orb；主线程是 Windows 生命周期的唯一实现者。
- 实施基线 [26d798ce8e888d1bf42a12e1c0fcc23a5f7799c3](https://github.com/raydocs/tono/commit/26d798ce8e888d1bf42a12e1c0fcc23a5f7799c3)，不是任务书分支，也不是旧 main。它保留 #262 的 [4b3f21afc90bb57c4d2a6300258ca06c9ab98ebf](https://github.com/raydocs/tono/commit/4b3f21afc90bb57c4d2a6300258ca06c9ab98ebf)、#258 → #244 → #242 → #240、#263/#264/#265、现 main 与既有 #179/#189 安装器修复 [3451ce5c041be60901cbbdcd7b91effd7e8c6e1f](https://github.com/raydocs/tono/commit/3451ce5c041be60901cbbdcd7b91effd7e8c6e1f)。采用普通合并，未改写已发布历史。
- 刷新后的远端：main [d27a216881105d43bf689b81342560036ba0b702](https://github.com/raydocs/tono/commit/d27a216881105d43bf689b81342560036ba0b702)，release/windows [0171990d500853a507a7fbcc075947f36b022173](https://github.com/raydocs/tono/commit/0171990d500853a507a7fbcc075947f36b022173)，release/macos [bdc75a4e8b25767ef9a2dff954df37c54f0dfcd1](https://github.com/raydocs/tono/commit/bdc75a4e8b25767ef9a2dff954df37c54f0dfcd1)。#262 及依赖 PR 仍开放；代码的祖先关系不等于 GitHub PR 已合并。未纳入无关 Dependabot 更新。
- macOS [#268](https://github.com/raydocs/tono/pull/268)、services [#271](https://github.com/raydocs/tono/pull/271)、macOS 报告 [#272](https://github.com/raydocs/tono/pull/272) 已通过实际提交集成到 **本组合分支**，不是 main。对应代码 `cff1da32`、`d663c4ac`，报告 `6061e251`、`711f29d4`；完整身份与日志见[macOS 分项记录](ENGINEERING_MACOS_2026-09-21.md)和[services 分项记录](ENGINEERING_SERVICES_2026-09-21.md)。
- 当前行为验收源码 [c74106ca8c44d192c3aa0f908028d9e38761575d](https://github.com/raydocs/tono/commit/c74106ca8c44d192c3aa0f908028d9e38761575d)。PR merge checkout [b365e09a1b53b4feb733f3bdd122dbc0da9e1b4f](https://github.com/raydocs/tono/commit/b365e09a1b53b4feb733f3bdd122dbc0da9e1b4f) 与它的 Git tree 均为 `c48ae084af29a7c411b6729e8c40994dcb33d3f7`，本地 `git diff --exit-code` 为0。运行 head 与 checkout 是不同字段；下表明确区分，实际checkout还须以各job日志为准。
- 首次报告交付 [2806ca887d3c692d011ae710d0dd13a6b721961c](https://github.com/raydocs/tono/commit/2806ca887d3c692d011ae710d0dd13a6b721961c) 只增加本报告，除报告外代码/测试/依赖/配置与上述行为源码相同；第 6 节的托管原生结果是其沿用的同代码证据，不是该文档SHA的新执行。
- 2026-09-22 CI续办 [a50b875ab2bf250ad91a7d60fae0b33ac08c9d29](https://github.com/raydocs/tono/commit/a50b875ab2bf250ad91a7d60fae0b33ac08c9d29) 已成功推送，仅修改 Services workflow 的 collector 路径触发与测试步骤；没有修改产品代码、测试、依赖或运行权限。新配置的实际托管执行另列于第 6 节，不再把全部配置称为与首次报告相同；本次报告更新不冒称新SHA的原生执行。

## 2. 第一方覆盖清单

“审查”仅指列出的生产边界、调用点与测试，不是目录逐行审计。“通过”只能由第 6 节实际执行提供。下列清单也交代没有深查的模块；没有把它们写成全仓通过。

| 模块与接口 | 状态 / 归属 | 本轮范围与未证明部分 |
|---|---|---|
| Windows React 产品壳、仪表盘、节点页、托盘、手动备用通道；Tauri 命令 | 已审查并修复 / G1、G2.3 | 节点选择后的后续 Connect 改读后端已确认状态，保留保护中/切换中的单写者；DOM 测试涵盖旧 UI idle / 后端已热切换。状态读与下一次 Connect 仍非原子，后端拒绝竞争不会变成第二连接，但托盘仍可能显示操作拒绝。没有视觉改版。 |
| App `state`、任务注册、`connection`/stages/transaction/cleanup/disconnect/reconnect | 深查并修复 / G1 | 连接代际、超时、取消、锁移交、重试句柄、控制器发布、断开后元数据、账户关闭。受控 channel/时钟反例运行真实状态/注册/提交边界；外部 IPC 注入，不 mock 整个状态机。未覆盖所有时序排列。 |
| 节点选择、DIRECT、catalog/policy 同步、monitor/probes | 已审查 / G1、G2 | 保留 #262 选择与 DIRECT 串行边界、#240 真正 TUN 成功不受诊断 loopback 阻塞、#242/#244 既有恢复/目录语义；同步提交与后台注册检查账户代际。没有降低流量验证、改变出口策略或新增自动 hy2 切换。真实网络需实机。 |
| App 账户、恢复、HTTP transport、共享 Core auth、Credential Manager 适配 | 深查并修复 / G1、G2 | stale logout、restore 401、55s UI 超时、JSON 401 重放、凭据写入/删除 FIFO 与完成确认。只有本地短锁；系统 vault 不在产品锁内。长时间 OS 阻塞仍可能保持关闭 admission，不能被假装取消。 |
| Service IPC、会话认证、Core 管理/监督、desired state、runtime staging | 定向审查 / G1、G3 | 现有 protocol epoch/revision/capability、owner/session、pipe 与 LocalSystem SCM PID 绑定、Core hash 路径、配置暂存；没有新增权限。状态读 unknown 不等于 absent。托管测试不证明用户已安装这些二进制。 |
| WFP、DNS/NRPT、TUN/路由、网络/电源事件 | 已审查并修复 / G1 | 卸载策略恢复失败不得报告 DNS 恢复；DNS 自写窗口保留事件并延后比较物理网络。真实 WFP 形状测试与 stubbed Service 生命周期分开。netmon IPv6-only 变化及 IP Helper 读卡顿未验证；不得把 IPv4 fixture 当原生拓扑证明。 |
| Service install/uninstall、NSIS、App update journal、Core identity packaging | 定向审查 / G3 | 既有安装拒绝/恢复修复被纳入基线；新修复收紧卸载 NRPT 错误分类。#26 安装器绑定的认证 handoff receipt 与真实升级仍受阻，未伪造新协议；未运行 candidate install、签名或更新推广 workflow。 |
| macOS SwiftUI/AppState/AccountSession/ConnectionCoordinator/helper/PF/DNS | 独立审查、主线程集成 / G1 | 单一释放所有者、DNS 快照错误保留；14 个领域的细目和原生 red/green 见 macOS 报告。真实 PF/TUN 流量、SC 读不到与自动 DNS 的区分、睡眠/崩溃仍未证明。 |
| macOS 本地 audit、更新 journal、helper 安装合同 | 已修复 / G2、G3 | 失败写入队列保留最新 256 条/256 KiB并记录丢失；不再把旧 Mihomo 或 build number 当运行 Core/源码身份；helper 合同 4.4.0 强制旧 daemon 升级。没有新身份 IPC、遥测字段或上传同意变化。 |
| Worker 账户/会话/设备、目录、策略、诊断接收 | 独立边界审查、组合执行 / G2.1/.2/.4 | 设备凭据、撤销、roster readiness、revision/digest、策略签名、失败去重/长度/身份；合并密码脱敏修复。目录加密 + SHA-256，不是 Ed25519 签名目录；策略才是 Ed25519。未做完整 IdP/生产 Access 或所有 billing/admin 审计。 |
| exit-agent、home-agent、collector | 独立边界审查、合并修复 / G2.5、ops 3.4 | roster/config/ACK、进程 marker、重试与私有持久化、计量；collector 的非零 journal 结果与脱敏。#4/#5 的外部计量边界保持拒绝，未迁移。没有实际 Xray/Tailscale/SSH 执行。 |
| Ops console、旧 admin 共享库、API contract、acceptance | 定向审查、CI 功能检查 / G2.9、ops 3.1/3.4 | 失败证据真伪、接收与页面边界；不是全 UI 审计。历史 succeeded journal 不会自动修正；空白观测文案和旧 digest freshness 仍欠明确策略/代表性 DOM 证据。一般 ops unit suite 不在现 CI 中，未宣称执行。 |
| `tono-core` config/node/catalog/policy/connection/update-journal | 相关调用点审查、锁定依赖测试 / G1–G3 | 三个 Windows workspace 不合并；既有解析、签名、持久化断言保留。没有全量 parser fuzz 或全状态空间穷举。 |
| `tono-plugin-core`、`tono-authenticode`、logger；App crates client/service-client/logging/draft/signal/limiter/i18n/sysinfo | 边界盘点，非逐行审计 / G1、G3 | 通过消费者 native 编译与既有调用/测试检查，不把依赖测试等同逐包独立执行。旧 Verge 通用页面、编辑器和开发 sidecar 不属于本轮产品改造；不改特权路径兼容名称。 |
| Linux/Ubuntu packaging、未来 CLI、mobile | 未交付能力，不认证 / 架构边界 | 仓库仅有 macOS、Windows 产品树；Linux 尚无生产 nftables，不能按桌面 UI 可启动推断保护可用；没有增加旁路 Core。移动端/CLI 不制造“验收通过”。 |
| tooling、共享 helper scripts、CI、锁文件/第三方补丁 | 定向审查 / G1–G3、ops | 固定 hosted OS labels、锁定安装、三个 Rust workspace、Core pin/产物身份、测试隔离、release 权限边界；没有升级依赖。Services collector 路径/测试曾被 workflows 权限阻止，2026-09-22已补齐并在push/PR实际通过，见第 6、7 节。设计资源、历史归档、无关脚本不做重写或全面审计。 |

## 3. 六类症状的区分路径

这些是调查分支，不是客户事故归因；没有收到本轮客户运行包、进程与网络证据。

| 症状 | 候选阶段 / 需要的区分证据 | 已做的可重复验证 / 缺口 |
|---|---|---|
| 无法连接 | catalog/账户未就绪、Service协议、Core启动、保护/DNS、TUN流量；需要同 attempt 的 stage/code/cause 与 Service owner/session | stale owner/controller、账户关闭与身份、失败原因保留回归；真实出口握手、证书/凭据/线路原因仍未知。 |
| 连接很慢 | SCM、vault、阶段预算、诊断探测与实际 TUN 探测、重试排队 | 保留已有非阻塞 SCM/journal 与 advisory probe 修复；55s 只限制 UI 等待，不取消真正 release；不把超时后继续的工作叫已失败清理。客户延迟分布未测。 |
| 界面卡顿 | 持锁系统查询/磁盘写、状态轮询、重复任务、日志重试 | DOM 状态回归、重试任务注册、异步 vault FIFO、macOS audit 有界；没有在编辑用 MacBook 跑 native；实际 UI帧时/系统调用卡顿未测。 |
| 显示已连接但无流量 | 旧UI、迟到controller发布、Core/Service身份错配、DNS/路由/WFP与出口不可达 | controller代际反例、已有真实流量证明不降级；Core日志只提供有限观测，不从 EOF 推断封锁。需要实机 app/service/core PID及保护/路由/流量读回。 |
| 切换后断网 | 旧选择/DIRECT交错、清理误伤新会话、UI多发Connect、网络事件丢失 | 保留#250串行化，新增状态读回、被替代任务/迟到结果及DNS窗口回归；原生同网卡换网关/Wi-Fi/IPv6-only仍欠故障注入。 |
| 断开后无法恢复网络 | release未完成、DNS/NRPT快照仍未还、Core仍活、第二owner误disarm | Windows卸载NRPT失败、macOS失败快照保留、Core-stop拒绝后不disarm、UI消失后释放继续；真实系统恢复与重启/崩溃证据未执行。 |

## 4. 修复闭环与结构决定

| 缺陷 / 归属 | 最小反例与修复 | 证据 |
|---|---|---|
| W1 #247 重试失去旧句柄 / G1 | 两次注册覆盖槽位，旧 loop 未 abort；注册/取消在同一 state 临界区，代际只由一次新尝试认领 | RED R1；`retry_replacement_cancels_the_displaced_loop_before_losing_its_handle`。 |
| W2 #249 卸载 NRPT失败被adapter fallback吞掉 / G1 | adapter恢复成功但NRPT仍失败时错误返回Recovered；按策略恢复失败与adapter失败分类，只有后者允许fallback，快照保留 | RED R1；`uninstall_does_not_report_dns_recovered_while_nrpt_restore_fails`。 |
| W3 #251 UI用旧 idle 追加Connect / G1 | backend已完成热切换而组件props仍idle；servers/tray/manual backup读已确认status，保留后端single-flight | 本地RED命名测试 `does not turn an accepted switch…`；GREEN DOM套件与最终前端检查。修正一个仍模拟idle的backup fixture，没有删断言。 |
| W4 #248 / W5 #246 关闭与释放责任随UI消失 / G1 | held logout期间Connect被接纳；取消断开caller后连接时钟/重试信息残留 | RED R2；`sign_out_owns_admission_until_logout_finishes_even_without_its_caller`、`release_owner_finishes_session_metadata_after_the_ui_waiter_is_cancelled`。account_close与release_operation是不同作用域，后者完成不提前结束前者。 |
| W6 迟到验证覆盖新controller / G1 | A验证返回后B已认领，A仍发布secret/port | RED R2；`retired_verification_cannot_publish_a_controller_over_the_replacement`；同步提交校验代际，stale cleanup只补偿捕获的会话。 |
| W7 跨账户logout / G1、G2 | A logout响应迟到，B已adopt，A删B refresh或用B重试 | RED R2 core；`held_logout_cannot_revoke_or_wipe_a_replacement_session`；logout使用捕获身份，不接管替代账户。 |
| W8 #259 DNS自写窗口丢真实网络变化 / G1 | notify在自写期间直接丢弃；改为保留pending，窗口后读取排除DNS的拓扑，变化才通知 | RED R3；`a_real_network_change_during_dns_write_is_deferred_not_discarded`；失败读保留待查，非原生拓扑全面证明。 |
| W9 失败原因随重试清空 / G2 | attempt A失败，B清空live error/换凭据，支持信息缺A原因 | RED R4；`retained_failure_keeps_bounded_scrubbed_cause_when_retry_clears_live_error`；捕获A代际和脱敏cause，迟到A不得修改B，也不从B凭据重新解释A。 |
| W10 审查发现close消费UI超时 / G1 | Service release超过55s，close已跳过logout/开放登录；真正release成功后账户仍Ready | RED R5；`account_close_joins_release_past_the_ui_budget_before_reopening_admission`；owner等待实际LifecycleOperation，55s仅在UI waiter。 |
| W11 restore 401检查到副作用窗口 / G1 | A检查generation后B登录，再执行A release/logout影响B | RED R5；`expired_restore_reserves_account_ownership_before_its_first_side_effect`；expired/missing共享原子generation检查+close reservation；保留User失败不退账户、dead session失败仍显示保护的差别。 |
| W12 vault写/删异步乱序 / G1 | old write晚于logout delete落盘，或old delete晚于B write落盘 | RED R5；`delayed_vault_mutations_cannot_resurrect_or_erase_a_replacement_token`；单owner FIFO、最多64待办+1个OS调用。queue满/关闭拒绝内存突变；close await flush，未确认删除不显示SignedOut。补真实store适配的阻塞/拒绝/重试测试 `account_close_waits_for_durable_deletion_and_reports_a_failed_acknowledgement`。 |
| W13 JSON401借用B凭据重放A报告 / G2 | held A report返回401，refresh返回B token；用B重复发送A body | RED R5 core；`held_json_failure_cannot_replay_an_old_payload_under_a_replacement_account`；JSON与binary绑定identity，diagnostics/window在采集前捕获身份；保留同账户refresh合并。首次修复的immediate failure调用仍捕获太晚，未据此宣称完整关闭，见W14。 |
| W14 失败即报在status await后重新认领账户 / G2 | A连接失败等待Service status，允许的替换登录B已adopt但不退connect generation；A随后被标成B并上传 | 聚焦回归 `held_failure_status_cannot_attribute_an_old_attempt_to_replacement_login` 使用真实admission、账户adoption、reconcile_failure、ApiClient/HTTP适配，只注入Service与远端响应；同账户对照必须上传。修复在连接admission前捕获account generation/API identity，作为不可变失败结果传过timeout、connect/retry/switch/monitor。旧账户不向B的audit scope/失败端点写证据，但原连接的网络清理仍继续；不改变替换登录产品规则。原生red/green见第6节。 |
| M1–M4 / G1–G3 | macOS重复释放owner、DNS读取失败丢快照、audit失败队列无界、update伪造Core/源码identity | macOS分项记录有真实native red/green；保留完整原因和已撤回的“cached catalog logout”假设，不伪造缺陷。 |
| S1 #269 / G2、ops；S2 #270 / ops3.4 | password仅标签被替换而值仍留存；SSH255/journal1被报ok | services分项记录：实际run_jobs上传、completeJob/D1写入边界；两条Python及两条Worker red；已修复且无扩展数据披露。 |

### 为什么需要所有者整改，而不是再加几次检查

检查generation后再await仍会留下检查到副作用窗口；abort句柄不撤回已经提交的IPC/系统调用。现在账户关闭先原子预约，持有责任直到释放和本地凭据删除完成；用户等待超时不转移责任。网络释放继续由原有Service特权事务执行，不让App发明恢复事实。

DIRECT/选择使用policy串行边界，再进入privileged lifecycle锁，再短暂读取/提交Tono inner；state锁不跨Service/网络/vault I/O。account reservation只在inner内登记，退出后才获取release所有者。App→ApiClient state的短锁用于adopt/capture identity；ApiClient不会回调获取App锁。vault queue锁只排序内存/入队，OS操作在单writer的blocking任务内。失败转release可移交writer，加入已有release则先放掉自己的writer，避免等待自身。

凭据队列的顺序就是进程内持久化版本序，不增加磁盘schema。删除错误保持Error并允许明确重试；永久卡住的OS调用不会被55s UI预算假装完成，最多占一个blocking线程。它仍可能阻碍进程正常退出，真实vault/进程故障需要实机。

对照了[Synara固定源码](https://github.com/Emanuele-web04/synara/tree/f3cffcb66bc205c5900bc7720b61d37b7cb39d5f)的 `backendSupervisionPolicy`、`exclusiveApplyQueue`、CI和audit记录：借鉴有界诊断、在途操作合并、已执行与待验证分账，不照搬500ms重启预算、Electron偏好队列或权限模型。Tono还必须处理不可撤回的Service/PF/WFP效果。锁文件为Tauri2.11.5、Tokio1.53.1、keyring3.6.3、vendored kode-bridge0.4.2；[匹配版Tokio说明](https://docs.rs/tokio/1.53.1/tokio/task/fn.spawn_blocking.html)明确运行中的blocking任务不能靠abort停止，不能把timeout当取消证明。依赖/补丁版本未改。

## 5. 诊断与运行身份的边界

- 本地Windows失败保留 originating attempt UUID、process-local connection generation、节点/transport/catalog revision、阶段/稳定码、脱敏原因链、步骤耗时及最多16条白名单probe outcome。只有当前attempt能写last failure；更换账户后清空。cause在原凭据仍可获得时移除已知secret/IP/结构化敏感值，限制2000字符加省略号；没有把整个配置或原Core日志附到远端上传。
- Core日志观测仍只读：3s IPC预算、编码8MiB拒绝、64KiB/200行tail分析，只输出固定标签/计数。这个tail **不与attempt强绑定**；`tls_handshake_eof`是观测不是封锁、UUID错误或服务端拒绝结论。
- Service已有snapshot_generation、active_operation、owner/session、Core PID/generation、desired generation、保护/DNS状态。pipe服务进程需匹配SCM注册的LocalSystem PID；protocol按epoch/revision/capability判断，不要求App/Service/Core语义版本号相等。Core启动hash与runtime staging/endpoint digest是各自边界，不能把磁盘manifest当“当前进程正在使用它”。
- macOS helper 4.4.0安装合同对应DNS行为更新；journal不再写旧Mihomo `v1.19.30` 或把 `CFBundleVersion=73` 填作commit。可获得的catalog revision保留；未知Core/build来源保持unknown。helper进程/Core/config的完整运行证明仍缺。
- Windows/macOS源码版本是0.0.73，并不证明客户安装升级。没有本轮客户App二进制hash、Service注册路径/进程、helper/Core启动身份、实际配置digest、policy/catalog应用读回，也没有真实用户网络可比性记录。新源码不能解释旧0.0.34/0.0.67安装的全部行为。

## 6. 自动化证据账本

### 失败先行（均保留；不是构建失败冒充行为复现）

| ID / checkout源码 | 命令、环境与日志 | 决定性结果 |
|---|---|---|
| R1 [474a9dfe68a7f46dce184e7481ac453b283051ec](https://github.com/raydocs/tono/commit/474a9dfe68a7f46dce184e7481ac453b283051ec) | Windows2025 push [35656964818](https://github.com/raydocs/tono/actions/runs/35656964818)，App job106523070639 `cargo test --locked`；Service job106523070698 `cargo test --locked --features standalone,client,test` | App482pass/1fail（W1）；Service301pass/1fail（W2）。失败后real WFP步骤未运行。 |
| R2 [6a947259bcc2eba553431dd052350e129af4f9a5](https://github.com/raydocs/tono/commit/6a947259bcc2eba553431dd052350e129af4f9a5) | push [35658530110](https://github.com/raydocs/tono/actions/runs/35658530110)，App106527974294同上；Ubuntu Core106527974506 `cargo test --locked -p tono-core` | App483pass/3fail（W4/W5/W6）；Core263pass/1fail（W7，B refresh被清成None）。同run前端有backup fixture失败，修fixture不等于native修复。 |
| R3 [a96bb5d2e84acf0a9be73a6ed79dd69f21156872](https://github.com/raydocs/tono/commit/a96bb5d2e84acf0a9be73a6ed79dd69f21156872) | Windows2025 push [35658850752](https://github.com/raydocs/tono/actions/runs/35658850752)，Service106529016273同上 | Service302pass/1fail（W8，DNS窗口丢事件）；同run其它尚未修复的red不叫green。 |
| R4 [daadc3a71a91403965db4615fb2e7bc67fbef300](https://github.com/raydocs/tono/commit/daadc3a71a91403965db4615fb2e7bc67fbef300) | push [35661011919](https://github.com/raydocs/tono/actions/runs/35661011919)，App106535967078同上 | 486pass/1fail（W9，connectionGeneration为Null而不是41）。 |
| R5 [022014382f132d5ebbf4326ae0cee857344e37e6](https://github.com/raydocs/tono/commit/022014382f132d5ebbf4326ae0cee857344e37e6) | push [35662428187](https://github.com/raydocs/tono/actions/runs/35662428187)，App106540517782、Core106540518105，同上命令 | App486pass/4fail（W9/W10/W11/W12），vault实际旧值而非replacement；Core264pass/1fail（W13，发2次而非1次）。|
| R6 [7aae9b4f8a51d2d706dda97bd30fc35beee40f8c](https://github.com/raydocs/tono/commit/7aae9b4f8a51d2d706dda97bd30fc35beee40f8c) | Windows2025 push [35665341120](https://github.com/raydocs/tono/actions/runs/35665341120)/App106549732051，`cargo test --locked`；checkout日志明确为7aae9b4f | 491pass/1fail（W14），`held_failure_status_cannot_attribute_an_old_attempt_to_replacement_login` 的实际HTTP请求数left2/right1，exit1；失败后journal integration步骤skipped。不是编译或fixture失败。 |
| macOS red/green | 5fcd3037/run35657636957，8812ec3d/run35659309157 → cff1da32/run35660304788；详见macOS记录 | 分别M1/M2和M3/M4真实断言失败；后续344tests/1既有skip/0fail、helper四套自测通过。不是最终组合证据。 |
| services red/green | services记录的源码fingerprint、实际Python/Worker命令 | 真实上传/存储敏感值、非零journal报ok反例；修复后25Python、40定点Worker通过；首次511/500预算回归单独修正，没有加阈值。 |

最初组合 [5c3a1d2a8c58b052a016f8f73b0b730be7484070](https://github.com/raydocs/tono/commit/5c3a1d2a8c58b052a016f8f73b0b730be7484070) 的三个push workflow成功，但独立审查仍发现W10–W13，随后用R5重现并修复。这直接说明“CI绿”不是完整工程验收。该源码另一个Services PR run [35660494018](https://github.com/raydocs/tono/actions/runs/35660494018)/job106534310687失败：`dense fleet: long names truncate rather than reflow` 在 `states.spec.ts:26` 读 `.node-card` 数量0（应>40），86pass/1fail。未删此断言，也没有把它归为已证明的基础设施故障；该次run保持失败。

### 2026-09-21组合执行（逐项核对实际 checkout 与命名结果）

| 环境 / 命令 | 精确来源 | 当前结果 / 限制 |
|---|---|---|
| Ubuntu24.04 `cargo test --locked -p tono-core`，工作目录`apps/windows` | c74106ca push [35666408431](https://github.com/raydocs/tono/actions/runs/35666408431)/job106553060085，checkout为c74106ca | 265unit +10config integration +1frontend contract +3journal integration，全通过；held JSON/logout均ok。 |
| Ubuntu24.04 `pnpm typecheck`; `pnpm test`; `pnpm test:dev-control`，工作目录`apps/windows/app` | 同push/job106553060103，checkout为c74106ca | typecheck成功；35files/270tests通过；CI路径合同6、包装/固定Core身份合同97通过。DOM证明旧idle UI收到已连接/切换中backend状态后不再追加Connect；支持详情含保留的代际/原因。仅DOM/交互，无外观修改；不证明IPC/真实流量。 |
| Windows Server2025 `cargo test --locked`，工作目录`apps/windows/app/src-tauri`；`cargo test --locked -p tono-core --test update_journal_atomic`，工作目录`apps/windows` | 同push/job106553059778，checkout日志为c74106ca；整个Windows push四job成功 | `492 passed; 0 failed`；W1/W4/W5/W6/W9/W10/W11/W12/W14各命名回归均ok，包含真实HTTP attribution回归；Windows journal3passed。既有singleton doctest为1ignored。release-only sidecar/resources为CI占位，不能把App suite当已运行真实Core或安装包。 |
| Windows Server2025 Service `cargo build --locked --features standalone,client --bins`; `cargo test --locked --features standalone,client,test`，工作目录`apps/windows/service` | 同push/job106553060104，checkout为c74106ca | build成功；303主库unit、38 bin unit、26integration通过、0fail；既有`windows_runtime_file_lock_holder`为父测试启动的ignored helper入口，不把它算独立通过。W2/W8命名回归均ok。 |
| 同host `TONO_REQUIRE_REAL_WFP=1 cargo test --locked --features standalone,client --lib core::wfp::real_engine_tests::the_kernel_accepts_a_filter_with_many_same_field_conditions -- --exact --nocapture` | 同job106553060104，单独枚举后执行，无`test` feature | 1passed、0fail、298filtered；真实filter engine接受该形状，不等于Windows11、实包防漏或完整网络恢复验收。 |
| macOS26.6.2 arm64/Xcode26.6/SDK26.5，`xcodebuild -project apps/macos/Tono.xcodeproj -scheme Tono -configuration Debug CODE_SIGNING_ALLOWED=NO ENABLE_USER_SCRIPT_SANDBOXING=NO test`；Release改用`-configuration Release -derivedDataPath apps/macos/build`并执行`build`；runtime-byte检查 | PR [35666413118](https://github.com/raydocs/tono/actions/runs/35666413118)/build106553431961，head c74106ca，日志checkout为b365e09a | `BUILD SUCCEEDED`；`Executed 344 tests, with 1 test skipped and 0 failures`、`TEST SUCCEEDED`；M1/M3/M4逐个passed；既有`testEmitInstallScriptWhenRequested` opt-in skip。sing-box/helper接受Swift生成bytes，SHA256 `1ad5035b9f94d6d7ec249de0c50c8fc9dc2b35498cf0a41976f52bb8756817af`。既有actor-isolation警告未隐藏。 |
| 同macOS run，`sudo apps/macos/Tono/Resources/tono-core-helper --self-test` / `--lifecycle-self-test` / `--core-lifecycle-self-test` / `--staging-self-test`；input/policy jobs | privileged106553432012、input106553075996、policy106553431901均成功，checkout b365e09a；整个run四job成功 | M2输出`DNS restore read-failure regression passed: failure retains snapshot; retry restores all services`；四套helper检查完成。一次性host的PF anchor不接主规则，因此不是流量防漏证明。 |
| Ubuntu24.04 Worker `npm run typecheck`; `npm test`; `../../tooling/scripts/test-policy-signing-contract.sh`，工作目录`services/control-plane` | PR [35666413158](https://github.com/raydocs/tono/actions/runs/35666413158)/106553075578，head c74106ca，日志checkout b365e09a | typecheck成功；43files/890tests、policy4/4通过；整个Services run八job成功。 |
| 同Services run：contract、agents、local migration | contract106553075854、agents106553075870、migrations106553075970，逐job日志checkout b365e09a | `npm run check:contract && npm run check:budgets`、console build成功；定点Vitest routes3/fixtures2/generator11；Node tooling66；Ruby20runs/258assertions；三条agent Python命令82/15/24 OK。迁移仅local D1 replay，无remote操作。 |
| 同Services run：`npx playwright test --shard=N/4 --ignore-snapshots`，工作目录`services/ops-console` | shard1–4分别106553075959、106553075918、106553075928、106553075947；逐job日志checkout b365e09a | 87+87+77+86=337passed；9项既有docs截图捕获skip。当前dense-fleet断言通过，不抹掉历史失败。既有`--ignore-snapshots`只提供功能验证，不是视觉验收；无手动重复触发。 |
| Linux Orb `python3 ops-panel/tests/test_jobs.py -v` | 组合源码scope `ops-panel`，fingerprint `4c70356aa1f108c81c177414b26306b645081fe23c09fd4f4f5c7cec06d71cd7` | 25tests OK；后续Windows改动不改变该scope，acceptance_status确认current。当时尚未接入CI，续办证据见下。 |

上表Windows push、macOS PR和Services PR已全部完成成功；并行自动Windows PR [35666413213](https://github.com/raydocs/tono/actions/runs/35666413213)亦返回success，仅记录状态、不重复计入命名测试证据。没有手动重跑以制造绿灯。`acceptance_ci_evidence`保存Windows App和macOS helper回执；前者命名提取截断、后者未自动提取自测输出，PR来源也由工具标为checkout-unverified。主线程另读完整job日志核对上述checkout、结果与命名反例，不把提取缺失说成工具已证明通过。

首次报告差异核对：提交2806ca88前，`git diff --exit-code c74106ca8c44d192c3aa0f908028d9e38761575d -- . ':(exclude)docs/reports/ENGINEERING_ACCEPTANCE_2026-09-21.md'` exit0，工作树只有本报告新增。该历史检查不适用于后续新增workflow的整棵树；不把它记作新配置的验证。

### 2026-09-22 CI续办（原权限阻塞解除）

所有者通知已更新并要求继续后，实际push已接受 [a50b875ab2bf250ad91a7d60fae0b33ac08c9d29](https://github.com/raydocs/tono/commit/a50b875ab2bf250ad91a7d60fae0b33ac08c9d29) 的workflow修改；没有推断具体更换了哪种凭据或权限设置。相对2806ca88仅增加 `ops-panel/**` 的push/PR触发范围和 `Operator SSH collector jobs` 步骤，沿用 `ubuntu-24.04` 与原有权限。未手动派发或重跑workflow。

| 执行 / 来源 | 决定性证据 |
|---|---|
| Linux Orb `python3 -m unittest discover -s ops-panel/tests -p 'test_*.py'` | 25tests OK，exit0；scope为workflow与`ops-panel`，fingerprint `a9970c2750915a9825eeb841aae55a1b60d58cd5d1549d8f7b61c2f1774393c5`。测试注入SSH/网络适配，不对节点执行操作。 |
| Linux Orb一次性Node断言，使用App锁定的`js-yaml`解析实际workflow | push/PR都匹配collector源码与测试、不匹配无关docs；固定host、准确测试命令、步骤未设置`if`且未忽略失败、顶层`contents: read`均符合断言，exit0。完整命令保留在本线程回执；scope为workflow和App manifest/lock，fingerprint `dcfa088b54782cded04a3e18785ca8d7cf913339f28462d478aff3ce73ded4d5`。 |
| Services push [35688650199/job106620754318](https://github.com/raydocs/tono/actions/runs/35688650199/job/106620754318)，`service-agents`，Ubuntu24.04.5 | 日志checkout明确为a50b875a；新增步骤实际运行上面的`unittest discover`命令，`Ran 25 tests in 0.160s`、`OK`，step/job成功。既有agent命令82/15/24亦OK。 |
| Services PR [35688652742/job106620762457](https://github.com/raydocs/tono/actions/runs/35688652742/job/106620762457)，同job/host | run head为a50b875a，日志checkout为 [f7db13ecfc5474da3d2d0eb3558143b7981b6200](https://github.com/raydocs/tono/commit/f7db13ecfc5474da3d2d0eb3558143b7981b6200)，不是将run head冒充checkout。新增步骤同命令，`Ran 25 tests in 0.159s`、`OK`，step/job成功。既有agent命令82/15/24亦OK。 |

读取两份实际job日志并fetch PR checkout后，a50b875a与f7db13ec的Git tree均为 `f0abef74cd76aeda9bdf7fb2b7eabbd9aa5cc673`。2026-09-22 04:58 UTC查询显示两条Services run各8个job全部success；除上述agents日志外，不把其他job状态冒称已重新核对命名测试。`acceptance_ci_evidence`保存了push job回执，实际25项摘要可读；本地两份定点回执仍对应当前scope。本次文档更新沿用该CI配置证据，不是对文档SHA再执行测试；此前原生行为证据仍以各自checkout为准。

没有跑MacBook native、发布级全量审计、真实系统故障试验、全parser fuzz、一般ops-console unit suite、签名/安装/升级/客户线路；未执行不写通过。子Orb报告/模型判断是审查意见，不是可替代命令的验收回执。

## 7. 独立审查、阻塞与最小外部动作

独立Astra Max对5c3a1d2实际diff及生产调用链反证，提出四个P1（W10–W13）；主线程复核后用R5重现，组合修复5eed22d7。有限复审确认W10–W12在源码中解决，但发现W13的早期生产调用边界仍有W14：不是401重放，而是在第一次HTTP派发前把旧失败认成新账户。该次复审明确阻止验收，未以已绿CI推翻它。W14先抽出原有adoption/失败记录边界（无行为修复），再提交单一反例；修复只传递admission身份，不新增登录禁令、wire schema或释放权。

[最终有限复审](https://ampcode.com/threads/T-01a0c5fd-c2f5-7391-81f2-456a328cc1b1)在独立clean checkout核对已发布c74106ca，确认W14 **在源码中解决**，没有找到本次修复内的具体存活反例或直接正确性/保护回归；前次已解决问题未重开。核对四条消费者及timeout owner传递、admission变更前的identity await、锁顺序、adoption锁内audit enqueue和保留的cleanup plan，并独立读取R6真实red。此结论是源码/时序审查加既有red日志，审查者没有执行native或认证最终green；最终组合执行由主线程逐job确认。未再启动全库审计，未把有限复审冒称所有WFP/PF/系统API均合格。

1. **CI权限阻塞已解除（2026-09-22）**：此前GitHub App缺workflows写权限，原补丁push被拒；local分支 `fix/g1-engineering-workflow-coverage-20260921`、commit `1e84cf1f26e87ce8ece201aec644027a847c78f4`及[主线程](https://ampcode.com/threads/T-01a0c5d0-1c0d-77a0-b272-0a931282c5b5)的 `services-ci-collector-coverage.patch`（SHA-256 `aab05dec3ec90bda0aa05fb86a81d31414c083114c727b33a0c245a0ef799913`）保留为历史证据。所有者通知更新后，本轮一次正常push已被接受，原workflow改动以 [a50b875a](https://github.com/raydocs/tono/commit/a50b875ab2bf250ad91a7d60fae0b33ac08c9d29) 交付，push/PR的collector步骤均实际通过。无需再应用旧补丁或修改Actions运行时token权限；没有使用权限绕过。分项services报告中的BLOCKED/NOT SHIPPED描述的是此前状态，由本节续办记录关闭。
2. **运行身份/恢复证据缺口**：实际App/Service/helper/Core版本、路径、PID、hash与应用配置digest需要从指定设备获取；还欠SC unreadable与自动DNS区分、IP Helper慢/失败/IPv6-only、WFP/PF/TUN实包、断网/睡眠/崩溃/真实vault。保留unknown不等于这些路径已认证。
3. **G3外部协议/设备阻塞**：[Issue #26](https://github.com/raydocs/tono/issues/26) 的installer-bound认证handoff与安装/更新证据未闭环。不能靠跳journal相位、弱化权限或未签名构建充当客户更新资格；本轮未改变该策略。
4. **ops既有外部阻塞**：[#4](https://github.com/raydocs/tono/issues/4) paired legacy/named accounting receipts缺失，切换拒绝保留；[#5](https://github.com/raydocs/tono/issues/5) 缺per-peer generation/retirement证据，不猜epoch。不部署或试验计费切换，不把这些任意升级为新客户发布门。
5. **覆盖限制**：一般ops UI/历史digest freshness、未交付Linux/CLI、所有特权系统API、所有剩余第一方文件未逐行认证；清单已给范围和原因。没有宣称找出全部bug。

## 8. 分开回答验收问题

**A. 代码与工程层面是否达到本轮要求？** 本轮有限清单内的已确认正确性缺陷已完成代码修复、失败先行回归、最终组合自动化与独立反证复审；没有剩余的已确认P1源码修复项。collector CI wiring现已交付且托管执行通过，不再是权限阻塞。**仍不能判定整份任务书全部验收完成**：运行身份采集与若干原生恢复边界的证据仍不完整。代码/测试/CI/分项及组合记录以Draft交付；不把源码修复、托管green或模型意见提升成全系统保证。

**B. 是否具备进入后续实机验收的条件？** 最终组合native和有限复审已收齐，**具备进入受控内部设备诊断的源码基础**，可在另行获准、可恢复的指定设备上按精确源码/二进制身份开展实包保护与恢复场景。**尚不具备正式已安装/受保护更新验收的完整候选条件**：普通App CI使用占位发布资源，未交付获准的签名安装候选；#26安装器身份合同和实际组件/config身份仍待闭环。剩余外部动作是另行确定候选/设备授权与身份采集，不再需要交付CI补丁；本轮不自动执行这些设备或发布操作，G1–G3与客户渠道保持原门禁。

## 9. 2026-09-22 合并与内部测试候选续办

所有者 raydocs 明确要求合并可合并的整改，并评估能否替换尚未公开的现有测试版本。本节只推进该范围；不等于客户发布、设备网络操作或修改签名准入的授权。

### 已合并源码，不再是 Draft 交付

- [#267](https://github.com/raydocs/tono/pull/267) 从 Draft 转为 ready 后普通合并，实际 main merge 为 [0e20f2df671a528d80c2366d65aca3df1830117a](https://github.com/raydocs/tono/commit/0e20f2df671a528d80c2366d65aca3df1830117a)。已测 head [1fe84fd5ae383cfe82801232e95d859c402a4e24](https://github.com/raydocs/tono/commit/1fe84fd5ae383cfe82801232e95d859c402a4e24)、PR checkout [66d86528b7f02046544fce1515cea8f54cebf11a](https://github.com/raydocs/tono/commit/66d86528b7f02046544fce1515cea8f54cebf11a) 与实际 merge 的 tree 均为 `937749187d8ef9e268a2086aaf967ce148a6bee5`。合并前 Windows/macOS/Services 共 16 项检查成功；不把等树核对称为 merge SHA 上的新执行。
- 任务书 [#266](https://github.com/raydocs/tono/pull/266) 随后普通合并，main 为 [25e56707f91c3c6c69a30b4d76b46e087543c99e](https://github.com/raydocs/tono/commit/25e56707f91c3c6c69a30b4d76b46e087543c99e)。与前一 merge 只差任务书及文档入口，产品/测试/依赖/workflow 未变。Windows 候选明确使用这个源码，而不是浮动的“最新 0.0.73”。
- #268/#271/#272 的实际提交已随组合进入 main；GitHub 也把 #179 记为已合并。#189/#240/#242/#244/#258/#262/#263/#264/#265 的发布 head 均已是 main 祖先，已附集成出处并关闭冗余 PR；这些是 **closed as integrated**，不虚称另做了九次 GitHub merge，也没有删除分支或改写历史。
- 已用限定证据关闭源码缺陷 #239/#243/#245/#246/#247/#248/#250/#260/#261/#269/#270。#241/#249/#251/#259 保持 open：分别欠已安装恢复、真实 DNS/NRPT、跨入口展示时序、原生网络事件证据；已补注源码修复与剩余验收的区别。#26 和 #4/#5 仍开放，不用代码合并代替协议/设备/计量证据。
- 未纳入未审查的 Dependabot 更新、iOS #204 或仍受阻的 Windows sing-box 产品迁移 #203。没有为“合完所有 PR”扩大本次整改。

合并后自动触发的 [Windows35691122450](https://github.com/raydocs/tono/actions/runs/35691122450)、[macOS35691122398](https://github.com/raydocs/tono/actions/runs/35691122398)、[Services35691122458](https://github.com/raydocs/tono/actions/runs/35691122458) 也已完成成功，run head 均为实际 merge 0e20f2df；没有手动重复派发。直接读取 Windows App job106628133809 和 macOS build job106628386416 的日志，二者 checkout 均明确为该 SHA：前者 `cargo test --locked` 为 `492 passed; 0 failed`，超时关闭、vault 删除确认/乱序、旧失败跨账户归属回归均 `ok`，journal integration 为 `3 passed`；后者沿用第 6 节相同无签名 xcodebuild 命令，`Executed 344 tests, with 1 test skipped and 0 failures`、`TEST SUCCEEDED`。其余 job 此处记录 API 的成功状态，不冒称再次逐一核对所有命名断言。App CI 仍含占位发布资源；下一节的真实候选打包证据单独记录。

### 候选产物与实际验证

| 平台 / 阶段 | 来源与结果 | 不能据此宣称 |
|---|---|---|
| Windows 0.0.73 内部安装候选 | 单次派发现有 `windows-candidate.yml`：[run35691265073](https://github.com/raydocs/tono/actions/runs/35691265073)，两个 job 成功；build106629018538 日志 checkout 为 25e56707。`pnpm tauri build --bundles nsis` 生成一个包，`pnpm release:preflight --payload-only` 输出 `local NSIS payload OK`。 | 打包成功不代表可覆盖安装；下面实际 repair 失败，候选未获替换资格。 |
| Windows 安装检查 | 单次派发现有 `windows-installer-smoke.yml`，绑定 `candidate_run_id=35691265073`：[run35693574024/job106635490996](https://github.com/raydocs/tono/actions/runs/35693574024/job/106635490996)，checkout 同为 25e56707。全新安装、Service Running、Core pin、卸载和 DNS 不变均通过；第二次 `/S /UPDATE` **退出 2，同版本修复失败，job 退出 1**。 | 不把 cleanup 成功覆盖 primary failure；不是 Windows 11 或旧版受保护升级验收，也不能从 outer exit2 猜出 helper 拒绝原因。 |
| macOS 0.0.73 内部签名候选 | [#273](https://github.com/raydocs/tono/issues/273) 记录源码/配置阻塞：candidate-only 签名路径只准入旧 `stability/desktop-0.0.72-20260908` 且校验版本 0.0.72。普通 macOS CI 的 zip 使用 `CODE_SIGNING_ALLOWED=NO`；本轮没有尝试签名或公证任务。 | 不是一次公证失败，也不是可直接发给外部测试者覆盖安装的 Developer ID 签名包；不能放宽到任意 PR ref 或要求绕过系统安全检查。 |

Windows [候选 artifact10679403673](https://github.com/raydocs/tono/actions/runs/35691265073/artifacts/10679403673) 包含安装器和 manifest，GitHub 返回有效期至 2026-09-29 06:07:38 UTC。下载后 `sha256sum` 得到安装器 SHA-256 `fbc84460c68258585530c58f1200c52b44bfce40c51fbc2c96e23aa6acdb2d61`，与 manifest 相符；不要和 GitHub ZIP 的 digest `e866258de5736895d205759c4f317e643c0f4ac7d6fa31f61815e5c35056c375` 混用。manifest 实际为源码 25e56707、版本 0.0.73、`candidateOnly=true`、`releaseAccepted=false`、`updaterSigned=false`、`authenticodeSigned=false`；Core pin 为 `1185613100cc5b0d3b138160a66e108777b3d2aa935761fa619f68ba2c786123`。候选使用真实同源码 Service/固定 Core、关闭自动更新，不是普通 App unit CI 的占位资源；这些构建身份也不是用户当前运行进程的身份证明。

实际 smoke 命令为 `tooling/scripts/test-windows-candidate-install.ps1 -CandidateDirectory $env:CANDIDATE_DIRECTORY`，保留原有一次性 hosted Windows、拒绝已有安装及严格源码/digest 检查。[失败 JSON artifact10679622431](https://github.com/raydocs/tono/actions/runs/35693574024/artifacts/10679622431) 明确为 `freshInstall=true`、`sameVersionRepair=false`、`uninstall=true`、`dnsUnchanged=true`、`physicalUpgradeQualified=false`。NSIS/Service 源码有多个 preflight、事务及 journal 拒绝分支；现有 smoke 没有保存 NSIS detail/helper 输出，**根因尚未证明**，不把这个 outer exit2 当作已确认的 exit76、可忽略的重启要求或认证交接问题。已向 [#26 补充实测证据](https://github.com/raydocs/tono/issues/26#issuecomment-5772016253)；下一次定点诊断须在正常 cleanup 前保存失败详情，不重复盲跑、不重建同一包，也不跳 journal/权限检查来制造通过。

### 替换现有测试版本的边界

**本次判断：目前不能把这个候选当作现有测试版本的直接替换包。Windows 的同版本覆盖已实际失败，macOS 还没有本源码的合格签名候选。** 有限审查源码修复与 main CI 通过不等于安装验收，也不等于未知 bug 清零。交付替换测试包还须分开满足：

1. 明确平台、源码 SHA、候选 run、archive/installer SHA-256 与组件 manifest；不能只写“0.0.73”或把磁盘 manifest 当运行进程证明。
2. Windows 先定位并解决上述同版本替换失败、收齐修复源码对应的成功安装证据，再在获准、可恢复的 Windows 11 测试设备上记录原安装版本、组件/配置身份、连接/断开/切换、失败恢复与真实网络前后状态。macOS 先批准可信精确源码的签名候选路径，再补签名/公证及已安装 helper 的设备证据。
3. 手动替换前正常断开并确认网络已恢复，保留旧包与恢复手段；如果安装器以 exit76 或未恢复 journal 拒绝，保留日志并停止，不删除 journal 或跳过保护来取得“安装成功”。本轮没有在任何用户日常设备上执行这些步骤。
4. 不把手动候选安装推广成受保护在线升级：#26 的 installer-bound 认证交接仍未解决，Sparkle、Windows 更新源、签名/发布与 G1–G3 门禁不变。

本次续办只更新本记录，不修改产品、测试、依赖或 workflow；文档核对不需要重跑 native suite。没有新建全仓审查或后台跟进计划。
