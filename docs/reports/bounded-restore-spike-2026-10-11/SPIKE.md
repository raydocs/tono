# 抢占式解除：真机可行性实验设计（2026-10-11，待 Sol 审）

- 范围：只验证 [PROPOSAL.md](PROPOSAL.md) §9 赖以成立的前提。**不改 Tono 产品源码，不出包，不做正式实现。** 实验用的小程序（harness）放在本目录下的 `harness/`，等本设计审过后再写。
- 授权：所有者 2026-10-11 同意先做本实验、请 Sol 审设计与结果；正式架构在结果出来后由所有者决定。“1–2 天”只是实验本身的估计，不是实现或交包承诺。
- 读法：每个实验给出 **假设 → 依赖它的设计结论 → 步骤 → 判定 → 不成立时的后果**。

## 0. 证据分级（每条结论必须标注）

| 级别 | 含义 | 能支撑什么 |
|---|---|---|
| **D** 文档保证 | Apple / Microsoft 公开文档或 man page 明确写出的语义 | 可作为设计依据，仍做一次实测确认在目标系统版本上成立 |
| **S** 源码依据 | Apple 开源代码（configd、launchd 公开部分）或 Tono 自身源码 | 说明实现方式，不保证未来版本不变 |
| **O** 实测观察 | 本实验在指定系统版本上观察到的结果，含次数与时序覆盖 | 只说明“在这些条件下未观察到反例”，**不等于所有时序已证明** |
| **U** 未证明 | 以上都不能支撑 | 设计必须把它当作可能不成立处理（报“未知”或换方案） |

结果报告中禁止使用“已证明全部时序”“全部通过”。重复测试只能写“N 次、覆盖这些时机、未观察到反例”。

## 1. 环境与安全

- **Mac**：一台专用测试 Mac（不是所有者日常机），macOS 版本与当前客户主力版本一致，另加一台最新正式版（如可得）。优先用可快照的 macOS 虚拟机做破坏性实验（PF、configd、launchd 在 VM 中语义相同），关键结论（M1、M3、M5）在实体 Mac 上至少复跑一轮，因为网卡和 configd 插件可能不同。
- **Windows**：Windows 11 虚拟机（Hyper-V 或 VMware，开启快照），另加一台实体机复跑 W1、W3。
- 每台机器两个账户：管理员、标准用户。
- **可恢复性**：每个实验从快照开始；VM 有控制台访问，断网时仍能操作；实体机准备本地管理员账户和恢复步骤。
- **数据**：日志只记录时间戳、命令、退出码、网络状态读数；不记录账号、令牌、个人数据。推到 GitHub 前人工检查。
- **执行方式**：由所有者在测试机上执行，或通过 Remote Control 在测试机上运行。云端容器无法运行任何一项。

## 2. 通用测量工具（harness，待写）

| 名称 | 平台 | 作用 |
|---|---|---|
| `netwatch` | Mac | 订阅 SCDynamicStore 通知（`State:/Network/Global/DNS`、`State:/Network/Service/.*/DNS`、`Setup:/Network/Service/.*/DNS`、代理键），并每 200 ms 读取一次 `pfctl -a tono.killswitch -sr` 和 `pfctl -s info`；输出带单调时间戳的变化日志 |
| `netwatch.ps1` | Windows | 每 200 ms 枚举 Tono provider 下的 WFP 过滤器数量、各接口 DNS（`Get-DnsClientServerAddress` + 注册表 `NameServer`）、目标服务状态与启动类型 |
| `reach` | 两平台 | 每秒访问一个普通网站和一个 AI 服务（只记成功/失败/耗时） |
| `killer` | 两平台 | 等待目标进程在管道输出阶段标记后，按指定抖动（0–50 ms 均匀分布，或固定点）发送 SIGKILL / TerminateProcess，并记录实际发送时刻 |

“网络单调性”判定（C1）：从解除开始到观察窗结束，PF/WFP 阻断与 DNS 指向 127.0.0.1 只能从“有”变成“无”，不能再出现“无 → 有”。

## 3. Mac 实验

### M1　DNS（持久 SCPreferences）写入者被杀后，是否还有迟到提交
- **假设**：`SCPreferencesCommitChanges` 由 root 客户端在持有 preferences 锁时原子替换存储文件；客户端死亡后锁被释放，之后不会再有它的提交。`SCPreferencesApplyChanges` 只是让 configd 应用**当前存储值**。
- **依赖它的结论**：DNS 写入者被 SIGKILL 并回收后，解除写入的 DNS 不会被迟到写入覆盖（PROPOSAL §9.1）。
- **源码核对（S）**：在 apple-oss-distributions/configd 中查 `SCPCommit.c`、`SCPLock.c`、`SCPApply.c` 与 PreferencesMonitor 插件，写明锁的实现（文件锁还是 configd 会话锁）、提交是否由客户端直接写文件、Apply 时 configd 读取的是什么。
- **步骤**：
  1. harness `scw` 对测试服务循环执行：Lock → 设 DNS 为 127.0.0.1 → Commit → Apply → Unlock。每个阶段向管道输出标记。
  2. `killer` 在以下时机发送 SIGKILL：持锁后提交前、提交调用中（标记后 0–5 ms 抖动）、提交后 Apply 前、Apply 中。每个时机 300 次。
  3. 回收后立即由 `scw --restore` 写回原始 DNS（Commit + Apply），记录 Lock 等待时间。
  4. `netwatch` 观察 120 s。每轮检查 `preferences.plist` 能否通过 `plutil -lint`。
- **判定**：
  - 成立：所有轮次中，恢复后存储值与 `State:` DNS 都没有回到 127.0.0.1；锁在回收后 1 s 内可取得；文件始终完整。记为 O，并附源码依据 S。
  - 不成立：任何一次回退或文件损坏。
- **不成立时**：DNS 只能报“未知”，或改用 M2 的临时值方案。

### M2　临时 DNS 值（随写入进程死亡自动撤销）是否可用
- **假设**：用 `SCDynamicStoreAddTemporaryValue` 写入的 `State:` DNS 能作为系统解析器生效，并在写入进程死亡时被 configd 自动删除。
- **依赖它的结论**：M1 不成立时的后备方案。即使 M1 成立，它也决定“重启电脑后 DNS 是否必然干净”。
- **步骤**：
  1. harness 创建独立服务 ID 的 `State:/Network/Service/<uuid>/DNS`（以及需要的 IPv4 主服务排序），用 `scutil --dns`、`dscacheutil -q host` 确认生效。
  2. SIGKILL 该进程，测量 configd 删除这些键所用的时间（200 次）。
  3. 测试 DHCP 续租、切换 Wi-Fi、睡眠唤醒时是否被覆盖。
- **判定**：生效、删除时间有上界，并且在网络变化时仍保持，才可列为可选方案。否则记为不可用。

### M3　`launchctl disable` 能否作为持久启动隔离
- **假设**：被 disable 的 system 域服务，不会被 KeepAlive、`bootstrap`、`kickstart` 或开机加载启动；只有 `enable`（或 `load -w`）能解除。
- **依赖它的结论**：released 期间，主 daemon 和 update executor 都无法被启动（PROPOSAL §9.2）。
- **步骤**：分两组。一组用模拟 KeepAlive 任务（每秒写一个文件）；另一组在已安装当前正式版 Tono 的测试机上使用真实 label：`com.raydocs.tono.core-helper` 和 `com.raydocs.tono.update-executor`。
  1. `launchctl disable system/<label>` 后执行 `kill -9` 主进程，观察 120 s 内是否被重新拉起。
  2. 逐一执行 `launchctl bootstrap system <plist>`、`launchctl kickstart -k system/<label>`、`launchctl load <plist>`、`launchctl load -w <plist>`，记录退出码、输出，以及服务是否运行。
  3. 重启后检查服务是否加载、是否运行。
  4. 依次运行当前和之前至少 3 个已发布的 macOS 安装包（以及 App 内修复 helper 流程），记录 helper 是否被启动，以及安装脚本是否调用 `enable` 或 `load -w`（同时用 `sudo log stream` 和 `fs_usage` 观察）。
  5. 更新路径：在 disable 状态下触发一次更新（测试通道），观察 executor 是否运行、是否 bootstrap 新 daemon。用 helper 已有的 update self-test 场景模拟 rollback，检查 rollback 后的 daemon 是否运行。
  6. 卸载重装：删除 plist 后重新安装，检查 disabled 覆盖是否仍然有效（覆盖按 label 保存）。
- **判定**：每条启动路径单独给出结论，并标注证据级别。只要有任何一条非管理员路径能启动被禁用的服务，就判为不成立。
- **不成立时**：对应路径必须由新版代码在启动前检查 target；该路径若涉及旧版代码，则在 released 期间只能报“未知”，并写入已知限制。

### M4　解除组件的拉起方式与崩溃恢复（launchd）
- **假设**：在同一个 plist 中，`Sockets`（按需激活）和 `KeepAlive.PathState` 可以同时使用：标记存在时，进程退出后会被重新拉起；标记不存在时只由 socket 激活。
- **依赖它的结论**：解除组件在写完 released 后崩溃，launchd 会把它重新拉起，从头幂等重跑（PROPOSAL §9.3）。
- **步骤**：
  1. 模拟任务在标记存在时分别做三件事：(a) 正常退出、(b) SIGKILL、(c) 启动后立即崩溃，造成崩溃循环。测量重新拉起的间隔和节流行为（ThrottleInterval）。
  2. 标记存在时重启，检查开机后是否被拉起。
  3. 删除标记后，检查不再被拉起，但 socket 连接仍能激活它。
  4. 崩溃循环中，每次运行都执行一组幂等的“解除方向”操作（flush 测试 anchor、恢复测试 DNS），并在任意步骤之间被随机杀死。用 `netwatch` 检查 C1 网络单调性，持续 10 分钟。
- **判定**：
  - 每种情况的实际拉起机制要写清楚（D 或 O）。
  - 崩溃循环中不允许出现“无 → 有”的阻断。
  - 如果 PathState 与 Sockets 不能共存，就把方案改为两个 label（一个按需、一个 PathState），并重测。

### M5　PF：被杀的 pfctl 是否留下半套规则，重启后是否残留
- **步骤**：
  1. 用一份很大的测试规则集（扩大加载窗口）在测试 anchor 上循环 `pfctl -a <test> -f`，在加载过程中 SIGKILL，共 300 次。每次回收后读出 anchor，内容只能是完整的旧规则或完整的新规则。
  2. flush 后观察 120 s，规则不得重新出现。
  3. 源码核对 Tono 是否修改 `/etc/pf.conf` 或安装开机 anchor。在 daemon 被 disable 的状态下重启，确认 `tono.killswitch` 为空、PF 不阻断。
- **判定**：不出现部分规则，重启后无残留，才能支撑“Mac PF 重启后必然干净”。

### M6　终止名单是否覆盖实际进程树
- **假设**：按 label（主 daemon、executor）和进程组，加上 sing-box 路径，可以覆盖 Tono 以 root 运行的全部后代进程。源码观察（S）：helper 子进程没有调用 `setpgid`/`setsid`。
- **步骤**：在连接中、`/update/stage` 中、修复中、睡眠唤醒中，用 `ps -axo pid,ppid,pgid,lstart,comm` 记录完整进程树（pfctl、networksetup、route、ditto、launchctl、sh 准入闸门、sing-box、install-guard）。分别尝试 `launchctl kill SIGKILL system/<label>`、`kill -9 -<pgid>`、按 ppid 递归终止，比较各自留下的进程。
- **判定**：找到一种在所有场景都不留存活后代的方法，并写明它依赖什么（例如 launchd 进程组）。存在无法覆盖的进程时，列出该进程，相关分项一律报“未知”。

### M7　安全边界（Mac）
- **步骤**：
  1. 验证 launchd `Sockets` 的 `SockPathMode`、`SockPathOwner`、`SockPathGroup` 实际生效：属主和权限符合配置，其他本地用户无法连接。
  2. 用 harness 原型验证 `LOCAL_PEERTOKEN` → `SecCodeCreateWithAuditToken` 的签名检查：未签名客户端、同一用户的其他程序、带 `get-task-allow` 的构建都被拒绝。
  3. 检查解除组件的二进制路径和目录 ACL（root:wheel、不可被用户写入）。
- **设计审查项（不靠实验）**：解除组件只接受请求 ID 和期望代数，不接受路径、命令、服务名或参数，并且不做客户端提供内容的格式化执行。

## 4. Windows 实验

### W1　服务 Disabled 与恢复计划任务能否作为持久启动隔离
- **背景（S）**：`TonoService` 的恢复动作是 5/10/30 s 后重启（`install_service.rs` 中的 `configure_windows_service_recovery`）；另有计划任务 “Tono Update Recovery v1”（`update.rs:1222`）。
- **步骤**：
  1. 把服务启动类型设为 Disabled，然后 `TerminateProcess` 服务进程，记录 SCM 是否尝试重启及事件日志（例如 7000/7031）。
  2. 用 `sc start` 和 App 内的启动路径尝试启动服务。
  3. 重启电脑后检查服务状态。
  4. 禁用恢复计划任务，然后逐一触发它的每个触发器（开机、登录、定时），检查是否运行。
  5. 查清该计划任务运行时会做什么（源码 S），重点是会不会重新安装或重新启用服务。
  6. 依次运行当前和之前至少 3 个已发布的 Windows 安装包，以及自动更新路径，记录是否把服务改回自动启动并启动它。
- **判定**：每条路径分别给出结论。非管理员路径（自动更新、计划任务、App）只要能绕过 Disabled，就判为不成立。管理员手动重装记为已声明的限制。

### W2　进程树覆盖（Job Object）
- **背景（S）**：`core/manager.rs` 对 sing-box 使用了带 `KILL_ON_JOB_CLOSE` 的 Job Object；其他子进程是否在 Job 内需要核实。
- **步骤**：在连接中、更新中、修复中、DNS 写入中，用 `Get-CimInstance Win32_Process`（父进程 ID 加创建时间）记录服务的全部后代进程。`TerminateProcess` 服务后，检查哪些后代仍然存活。
- **判定**：找到一种不留存活后代的方法，并写明前提。例如把整个服务放入 Job，或按“父进程 ID + 创建时间”递归终止，同时防止 PID 复用误杀。

### W3　WFP/BFE：提交中与提交后的终止
- **步骤**：harness 使用**测试专用的 provider/sublayer GUID**，不复用 Tono 生产 GUID，避免误删真实规则。
  1. 开始事务并添加 N 个持久过滤器，在提交前 `TerminateProcess`：确认 0 个过滤器残留。
  2. 在 `FwpmTransactionCommit0` 调用中终止（用大事务扩大窗口，按标记加抖动，300 次）：结果只能是全部存在或全部不存在。
  3. 提交后终止：过滤器保留。由删除 harness 按 provider 删除，并测量所需时间；分别在空闲时和 BFE 繁忙时（并发大量枚举）各测一次。
  4. 用测试 GUID 验证：重启后持久过滤器仍然存在。重启不能作为 Windows 的兜底，因此必须由解除组件删除。
- **判定**：第 1、2 步都没有出现部分提交，才能支撑“WFP 不会迟到生效”。BFE 本身停止或挂起的情况无法安全模拟，记为 U，在方案中按“未知”处理。

### W4　DNS（`SetInterfaceDnsSettings`）写入者被杀
- **步骤**：思路同 M1。在调用中、调用返回后分别 `TerminateProcess`，每种 300 次。之后写回原始值，观察 120 s 内注册表 `NameServer`/`ProfileNameServer` 和 `Get-DnsClientServerAddress` 有没有回退；同时检查 DNS Client 服务是否会重放旧值。
- **判定**：同 M1。

### W5　解除服务的拉起方式与崩溃恢复（SCM）
- **背景**：SCM **只在异常退出时**执行恢复动作，不读磁盘标记；正常退出不会重启。
- **步骤**：
  1. 模拟服务配置恢复动作“重启”，在步骤之间随机被终止，测量重启间隔，以及恢复动作计数何时重置。
  2. 开机后谁来继续未完成的解除，分别测两种设计：(a) 解除服务设为自动启动，没有待处理标记时立即正常退出；(b) 设为按需启动，由计划任务在开机时检查标记再启动它。比较两者的可靠性和攻击面。
  3. 崩溃循环 10 分钟，检查 C1 网络单调性。
- **判定**：写清实际采用的机制，以及它依赖的是 D 还是 O。崩溃循环中不允许出现“无 → 有”。

### W6　安全边界（Windows）
- **步骤**：
  1. 为解除服务设置 SDDL，只授予交互用户 `SERVICE_START`。以标准用户身份尝试 `sc stop`、`sc config`、修改 binPath、修改恢复动作，都应被拒绝（`sc sdshow` 留证）。
  2. 检查服务二进制路径的 ACL（Program Files，只有管理员可写），以及 `ImagePath` 是否带引号。
  3. 调用 `StartService` 时传入参数（`lpServiceArgVectors` 会原样传到 ServiceMain），确认 harness 原型完全忽略这些参数。
  4. 请求通道（命名管道）设置 ACL，用 `GetNamedPipeClientProcessId` 取得客户端进程并校验其签名。用未签名客户端和其他用户的进程分别尝试，都应被拒绝。
- **判定**：任何一项能让标准用户影响服务身份、路径、参数或请求内容，就判为提权入口，方案必须先改，再进入实现。

## 5. 结果如何决定架构

| 结果 | 对架构的影响 |
|---|---|
| M1 成立 | Mac DNS 保持持久配置，写入者回收后读回可以作为“已恢复”依据 |
| M1 不成立，M2 可用 | Mac DNS 改为临时值方案（规模增加，另行估算） |
| M1、M2 都不成立 | Mac DNS 在写入者被强制终止后只能报“未知”，所有者决定能否接受 |
| M3 / W1 有非管理员路径可以绕过 | 该路径必须先改为新代码并在启动前检查 target，否则抢占式方案不成立，回到所有者决定（包括 #1504 的 (c) 方案） |
| M4 / W5 无法可靠拉起或会造成网络振荡 | 去掉自动续跑，改为“未完成即报未知，需用户再次点击恢复或使用紧急入口” |
| M6 / W2 有无法覆盖的进程 | 该进程相关分项永久报“未知”，或改为由该进程在启动时检查 target |
| M7 / W6 发现提权入口 | 实现前必须修改设计 |

## 6. 交付

- 结果报告 `RESULTS.md`（本目录）：逐个实验给出系统版本、机器类型、次数、时序覆盖、原始日志摘要（不含个人数据）、证据级别和结论。未完成项和不确定项单独列出。
- harness 源码和执行脚本放在 `harness/`，每个脚本记录 SHA。
- Sol 审两次：本设计一次，结果一次。实施者不审自己的结果。
- 本实验**不改**以下内容：`tooling/scripts/core-helper/`、`apps/macos/Tono/`、`apps/windows/service/src/`、`apps/windows/app/`。与 Amp 的 #1504 没有文件重叠。
