# 审查与修复轮次记录（2026-09-22—23）

本页记录这一轮工程审查怎么做、查了哪些范围、哪些没查，以及下一轮可以直接复用的约束。
**发现的状态、编号和去重以 [FINDINGS_LEDGER](../FINDINGS_LEDGER.md) 为准**；本页不重复条目，
也不粘贴原始报告。交付和验证事实见 [INTERNAL_CHANGELOG](../INTERNAL_CHANGELOG.md)。

## 1. 流程

```
分块并行审查 → 对抗核实 → 修复 PR（每缺陷一分支）→ 独立 diff 审查 → 二轮修正 → 串行合并
```

| 阶段 | 做法 | 本轮结果 |
|---|---|---|
| 审查 | 按块（R1 macOS 连接、R2 Windows 连接、R3 DNS、R4 升级事务）并行只读审查，固定基线提交 | 22 条发现 |
| 核实 | 每条发现交给独立核实者，以**推翻**为目标；推不翻才算确认 | 19 条确认、3 条降级、0 条驳回 |
| 修复 | 一个缺陷一个分支一个 PR；同根因的结构问题合并为一个结构修复；每个行为一个窄回归；同 PR 更新 INTERNAL_CHANGELOG | #294–#312 共 19 个 PR |
| diff 审查 | 另一个模型只读审查每个 PR 的 diff；叠枝 PR 以父 PR 头为基；不信 PR 自述 | 可合并 7、小改 9、返工 3；#312 修法比原问题更差，已关闭 |
| 二轮修正 | 只改审查点名的问题，保护只能更严；推送后等 CI | 各 PR 按审查意见迭代 |
| 合并 | 单人串行合并，逐个 rebase 解决 INTERNAL_CHANGELOG 插入点冲突 | 写入时已合 #294–#297、#299、#302，其余进行中 |
| 隐秘 bug 搜寻 | 第三轮换角度：没人看过的地方、跨组件假设不一致（H1 数据面规则、H2 特权组件信任边界、H3 客户端信任/账户隔离、H4 控制面） | H1 6 条、H2 4 条、H3 6 条、H4 2 条 + 1 条附注 |
| 搜寻后闭环 | 发现 → 核实（尝试推翻）→ issue → 修复 → PR，全部由各自 agent 独立完成 | issue #313–#341 与修复 PR #316–#342 陆续开出，状态见总账 |

两条硬性要求贯穿每一轮：

- **每份报告必须交覆盖清单**（A 节）：每个入口/交错一行，写「安全（依据 文件:行）」或「缺陷 → Fx」。
  「没有发现」必须由完整覆盖清单支撑；未能检查的写进 C 节。
- **去重以 FINDINGS_LEDGER 为准**：审查前必读；已知、已修、在修的不报；
  能证明修复不完整时给出新反例，标「修复不完整/回归」。

## 2. 覆盖范围

| 块 | 覆盖 |
|---|---|
| R1 macOS 连接 | `AppState+Connect` → `ConnectionCoordinator` → 特权运行时协调、KillSwitch、helper（socket、PF、Core、电源）；睡眠/唤醒/网络变化/健康监视/验证；切节点与热重载；目录/策略安装；登出/账户丢失；AppDelegate 事件接线 |
| R2 Windows 连接 | GUI 命令层（connection/account/quit/catalog/restore/update）、连接 FSM 与 transaction/switch/reconnect/disconnect/cleanup/monitor/controller/failure/stages/status/probes，DIRECT 局部 |
| R3 DNS | 两端 DNS 应用、失败与重启恢复；快照、NRPT/DoH 旁路、紧急出口、状态上报 |
| R4 升级事务 | 原生升级 v1 生产路径的中断恢复：两端 helper/Service、独立执行器、successor 收养、回滚、恢复判定 |
| H1 数据面 | 实际下发的 macOS PF anchor 规则、sing-box 路由，Windows WFP 过滤器表、mihomo 规则；签名策略可表达的范围 |
| H2 特权组件 | macOS helper socket 权限、调用方签名认证、路由 gate、`/core/*` 配置目录与摘要、`/killswitch/arm` 字段、`/dns/enable`、特权写入位置、`/helper/upgrade`；Windows 命名管道 DACL、服务端身份、调用方 SID/token 认证、owner 限定路由、更新路由映像校验、core 路径白名单、StartClash 内容与 asset 复制、多用户 |
| H3 客户端信任 | 目录/策略的完整性与签名边界、revision 单调性、账户切换后的本地状态（目录、routing、偏好、报告、遥测、日志）、令牌存储与 refresh、时钟 |
| H4 控制面 | 认证/授权（设备 token、refresh、ops、exit-node、Access、OIDC、OTP）、IDOR、目录与策略签发、计量上报、D1 动态 SQL、静态资产/下载、限速 |

## 3. 未覆盖（取各报告 C 节）

以下范围本轮没有查，或只做了源码推导，下一轮优先考虑：

- **全部结论都是源码推导**，没有编译或实机复现。时间参数（utun 空窗、`sing-box check` 耗时、
  睡眠通知次序、launchd KeepAlive 竞争）、NTFS 崩溃截断、wintun 孤儿适配器别名、
  WFP RECV_ACCEPT 行为、mihomo 嗅探语义、DHCP 端口绑定、sing-box 进程匹配都需要设备证据。
- **特权组件（H2 未深入部分）**：macOS `restoreAtLaunch` 与 PF 主钩子写入只核对了打开方式；
  App Management 能否阻止同用户进程修改非 /Applications 下的 bundle 未实机验证；
  Windows `install_service.rs` 与 `update_executor.rs` 的事务语义以 R4 为准；固定版本 mihomo 对 YAML
  文件路径的限制按上游行为推断；WFP recv-accept 层对 allow-lan 类入站的拦截未逐条核对。
- **Windows 引擎层**：`windows_kill_switch.rs` 的 DIRECT reload 事务内部、emergency disarm、
  watchdog verify；`wfp` FFI 与会话标志；IPC 服务端在客户端断开时是否取消 handler；
  DNS 操作锁与 Core 管理锁的交互；`signed_apps.rs` 注册表发现与 WindowsApps 分支；
  非系统盘默认 ACL。
- **macOS 细节**：`KillSwitchPF` 规则渲染与 anchor 状态处置（R1 未逐行，H1 已查规则正文）、
  `ProtectedDNSManager` 实际写入的服务器集合与 scoped resolver、多 Network Location、
  节点切换是否取消网络环境任务；回滚持续失败时执行器无 IPC 出口（低概率前提）。
- **升级下载侧**：release-host Worker 的 `desktop/v1` 路由；下载只作为不可信输入核对了大小/摘要/重定向。
- **控制面**：Tailscale enrollment 链（生产疑似关闭）、ops 账目/月结/配额时区、ops v1 各 handler 逐项输入校验；
  生产配置事实（exit 凭据 rollout phase、`OPS_ROLES`、目录中是否有 catalog 型 home 块与 hy2 孪生块）本机无法确认。
- **客户端 TLS**：reqwest/rustls 根证书库来源、macOS ATS 例外；exit-agent roster 删除的实际同步周期。
- **未纳入的平台与路径**：iOS（#204 草稿）、Linux/CLI、hy2 UDP 与 home SOCKS 链路的 PF/WFP 细节、
  Home-US/Tailscale 路径（当前构建禁用）、SwiftUI 与 Windows 前端的点击/刷新时序。
- **已知测试覆盖缺口**（不是 bug，找到具体失败再报）：Windows 原生 DNS 夹具未跨真实 DLL export/
  `GetAdaptersAddresses`，无「native setter 卡住 → facade 超时 → 迟到返回进兼容路径」组合回归；
  Windows 持久化/重启未注入全部失败、迟到替换或断电；macOS DNS-SD 无确定性挂住 deallocate 与
  timer/success 竞争；macOS listener 未穷举 post-begin 交错、无 parser fuzz；SC 不可读、偏好锁、
  Credential Manager 阻塞、睡眠/崩溃/多网卡 DHCP/RA 未认证；真实数据面、身份与诊断、性能、UI 未认证。

## 4. 可复用的审查约束

### 4.1 所有阶段通用

- **固定基线**：开工前记录并核对 HEAD SHA；报告里的 文件:行 都基于这个 SHA。
  已发布候选的源码与当前 main 不同，不能混用。
- **只读**：审查/核实/diff 审查不改仓库、不做 git 写操作、不评论或批准 PR。只写自己的报告文件。
- **执行地点**：按 AGENTS.md，编辑机不跑 xcodebuild、swift build/test、原生 cargo、Tauri；
  control-plane `vitest` 与前端单文件检查可以本机跑。原生验证交给 CI，不要把 CI 绿写成已验证。
- **状态分开写**：「已修复」只表示源码进基线；CI 绿、issue 关闭、进 main、签名、设备通过、
  客户发布是不同事实。
- **公开仓库措辞**：数据面泄漏、越权类问题在 issue/PR/文档里只写缺失约束、位置、影响和修复方向，
  标题用中性措辞，不写可复制的复现命令或绕过手法。

### 4.2 审查

- 先读 AGENTS.md、architecture、INTERNAL_CHANGELOG、FINDINGS_LEDGER，以及与块相关的协议/集成文档。
- 从用户事件或系统事件一路追到实际副作用（PF/WFP/DNS/进程/持久化），不只看单个函数。
  对每条交错写出每一步各方持有/读取/写入的状态（代际号、owner、句柄、快照），
  找出检查与使用之间的 await/线程切换点。
- 搜寻类任务从真实输入出发（用户操作、网络包、服务器响应、本地非特权进程、文件系统状态），
  重点找跨组件假设不一致：一端以为另一端做了检查，其实没做。
- 报告格式：A 覆盖清单（必交）；B 每个发现写等级（已确认/源码推导/需实机）、触发步骤、文件:行、
  实际影响（是否泄漏；不要把状态传播夸大成保护绕过）、与已知项的区别、现有测试为何漏掉、
  一个在当前实现上会失败的窄回归写法、修复方向与规模；C 未能检查的部分。
- 不为凑数猜测；风格、性能、纯测试缺口不报。

### 4.3 对抗核实

- 目标是推翻发现。逐项检查：生产调用链可达性（不是测试 fixture）；有没有漏看的上游守卫、代际检查、
  锁、重试、watchdog、后续对账，会不会自愈、多久、要用户做什么；是否与已知项同根因或属于有意的
  fail-closed 设计；影响是否夸大或低估；建议的测试是否真能在当前实现上失败；
  不放宽保护的根因修复方向。
- 结论三选一：已确认 / 降级（写新等级）/ 驳回（写推翻它的守卫 文件:行）。驳回的也进总账。

### 4.4 修复与 PR

- 从 origin/main 切分支、独立 worktree；根因修复，不遮症状；保护只能更严（fail-closed、M2、
  更新协议的 U1/U3/U4、#293 语义）；不做无关重构或格式化。
- 每个行为一个窄回归（Worker 一个 `it`、Windows 一个 `#[test]`、macOS 一个 XCTest），
  必须在修复前失败；不得为变绿改断言或加测试专用分支。新 seam 的存在性测试要如实写明它的失败方式。
- D1 schema 变更加新 migration，不改旧 migration。
- 同 PR 更新 INTERNAL_CHANGELOG（按模板，插在模板代码块之后最前）和 FINDINGS_LEDGER 对应行。
- 修复 agent 不碰 appcast/latest.json/windows-updates，不部署，不合并自己的 PR；合并、部署与发布由另一方按 [AGENTS.md](../../AGENTS.md) 的条件执行。

### 4.5 独立 diff 审查

- 不相信 PR 正文自述，自己读 diff 和周边代码；叠枝 PR 以父 PR 头为基做 diff。
- 检查：是否修掉核实报告里的根因并覆盖点名的其他入口；是否放宽 fail-closed（释放、快照删除/隔离、
  紧急出口的权限与条件、事务退休条件），新增出口是否只能由特权或显式用户意图触发；
  新竞态、代际遗漏、错误吞掉、新旧 App/Service 协议与持久化格式兼容；
  回归测试在父基实现上是否真会失败，还是新 seam 本身改变了行为；范围和 changelog 是否如实。
- 结论：可合并 / 小改后可合并 / 需返工 / 拒绝，每条问题给 文件:行 + 具体失败场景。

### 4.6 串行合并

- 一次只合一个；每个 base=main 的 PR 都会在 INTERNAL_CHANGELOG 同一位置插入，
  合并前 rebase 并把条目放到最新条目之上。叠枝链按顺序合并。
- 合并前复核该 head 的 CI；记录 pre-merge head、CI run、merge commit 与冲突处理。

## 5. 本轮教训

- 首轮盲写、只靠 CI 验证的修复，在独立 diff 审查里有 3 个需要返工、1 个比原问题更差（#312）。
  diff 审查不能省。
- 同一类问题在两端的修复常常不对称（W8 只修了 Windows；Windows 已禁止按进程名直连而 macOS 没跟进；
  macOS 已有 routing 新鲜度而 Windows 没有）。修一端时顺手检查另一端，并在总账里写明。
- 隐秘搜寻轮换了角度（规则正文、跨组件信任、控制面），找到的高影响问题多于前三轮时序审查。
  下一轮优先补本页第 3 节列出的范围。
