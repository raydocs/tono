# 恢复正常网络：根因判断与最小方案（2026-10-11，v2，待真机可行性实验，未改代码）

> 状态：方向已获所有者支持，**正式实现未批准**。先做 [SPIKE.md](SPIKE.md) 的可行性实验，由 Sol 独立审实验设计与结果，再决定正式架构。优先级：§10 v4（门控效果槽位与机器级协调者，Sol 第三轮复审后）> §9 > §0–§8。“可靠恢复”的定义以 §9.0 为准。§3–§4 中的 30 s `_exit`、“删除意图文件”等早期表述已被 §10 取代，仅作历史保留。本文所有行数、工期估计都**未经认证**，实验结果出来前没有依据。

## 0. 结论

- **根因不是某几个漏掉的检查，而是解除的方式**：现在的“恢复正常网络”是协作式的，排在长任务同一条串行通道后面，并且依赖每个旧任务自己发现栅栏、自己撤回。这条路上“有界”和“旧任务不再动手”都无法证明。#1504 十轮审核一直在补“又一个没自查的位置”，(c) 设计把它推广成所有写入都走一把跨进程锁 M，方向成立，但要改动每个写入点（其自估 3,400–5,400 行、3–4 周）。
- **建议改为抢占式解除**：先写持久栅栏，再由一个独立的新进程终止所有 Tono 特权写入进程并确认它们已退出，然后只由这个进程做清理和逐项读回。被 SIGKILL 且已回收的进程不可能再写，这是内核保证，不需要几十个写入点逐一配合。
- 不需要大重构。大部分清理步骤 #1504 的 `--emergency-disarm` 已经写好（PF 先 flush、DNS、AI、读回、二次读回），新增的是独立入口、进程终止、持久代数和 Connect 闸门。
- Windows 存在同样的结构问题（见 §2.5），用同样思路处理。
- 目标是所有者 2026-10-11 定义的有界状态反馈（§9.0）：有界给出真实状态，不承诺系统故障下 N 秒内必然恢复。

## 1. 依据（读到的版本）

- main `a8b0be2`（helper 4.52.49）。
- PR #1504 head `2d757c1`，open，未合并，+6,082/−639，50 个文件。Amp（作者 Ruirui Wan）最后一次推送 2026-10-11 08:11:57Z，即仍在活跃修改。最近状态：R10 代码 FAIL，(c) 第三轮设计 FAIL，第四轮设计文本刚推送未审。
- handoff `efc679e`；decision 094（#1504 分支）。
- Windows：main 上 `apps/windows`。
- 行号均为上述版本，仅作定位。

## 2. 根因

### 2.1 解除与长任务共用一条串行通道（Mac）
App 的所有特权调用走 `actor PrivilegedRuntimeCoordinator`；helper 一次只服务一个连接（`SocketServer.swift:401-407`，`handle(client)` 同步执行），且请求处理在 update lock 内（`SocketServer.swift:931`，等待上限 660 s）；`/update/stage` 单次 600 s。之后还有组件锁和锁环（power ↔ Core ↔ KillSwitch）。只要解除走这条路，它的开始时间就取决于前面在跑什么，没有上限。10 s drain cap 和 60 s UI 截止只是让界面不再等，不改变这一点（decision 094 自己也写明 queue “not bounded”）。

### 2.2 解除依赖旧任务自觉
在途的特权效果有四种载体：daemon 进程内的线程（DNS 写入是进程内 SC 调用）、daemon 启动的子进程（pfctl、networksetup）、update executor（独立 KeepAlive launchd 任务）、rollback 后启动的旧 helper。它们都无法从外部“取消”，现在的做法是让每个效果前后各查一次栅栏（`guardedEffect`）。问题：
- 漏一个点就是一个 FAIL（#1504 十轮的历史）。
- `guardedEffect` 只比 mode，allowed G → released G+1 → allowed G+2 时前后都是 allowed（ABA），旧效果会留在新会话里。
- 旧 teardown 在新 Connect 之后落地会拆掉新连接（R10-F1）。现在的修法是让 Connect 等旧 teardown 结束，等于把无界等待从解除挪到了 Connect。

### 2.3 栅栏和代数不持久
会话代数只在 App 内存（`HelperManager.swift:957-980`）；Windows 的 `RELEASE_EPOCH`/`ATTEMPT_EPOCH` 全在服务内存，服务重启即清零。重启或换进程后，旧请求和新请求无法区分（D3-F2）。

### 2.4 有些写入者本不必存在
- Mac 系统代理：受管连接强制 TUN（`AppState+Connect.swift:138-139` “Tono always requires TUN”），自动开代理只剩 TUN 热切换分支（`AppState.swift:1646`）和旧版本留下的残留。为它设计跨进程锁和 epoch（D3-F4）成本远大于删掉这个写入者。
- 旧 helper 被 rollback 启动后会按保存的上锁意图（`killswitch.state`）重新上锁。与其证明“永远不会启动旧 helper”（D3-F3 的 launch floor），不如在解除时删掉它赖以重新上锁的输入。

### 2.5 Windows 同样如此
UI → `tono_disconnect` → 后台 worker 等 App 侧 `privileged_transition` 锁（无超时）→ `POST /kill-switch/release` → 服务端 `OWNER_LIFECYCLE_LOCK`（StartClash、更新事务、修复都持有）→ `WFP_OPERATION`/`DNS_OPERATION`，均无获取超时；`IPC_HANDLER_TIMEOUT` 60 s 只是提示，不会取消处理（`server/mod.rs:62-74`）。修复锁或待处理更新时解除会被直接拒绝（`server/mod.rs:1242-1288`，`update.rs:133`）。开始菜单“恢复网络”在服务运行时拒绝执行（`service.rs` ~160-176），救不了“活着但卡住”的服务。WFP 过滤器是 persistent 的（`wfp/mod.rs:33`），另有 “Tono Update Recovery v1” 计划任务（`update.rs:1222`）。

## 3. 方案：抢占式解除

### 3.1 Mac
1. **独立入口**：新增按需 launchd 任务 `com.raydocs.tono.release`，socket 激活，可执行文件是单独一份 `/Library/PrivilegedHelperTools/tono-release`（与 helper 同一签名二进制，以 `--user-release` 模式运行）。用单独路径是为了 rollback 把 helper 换回旧版时，解除入口仍是新版。socket 0600，对端校验沿用现有 daemon 策略（绑定 uid、审计 token、签名且无 `get-task-allow`）。App 的“恢复正常网络”直接连它，不经 actor、不经 daemon 循环和 update lock。daemon 卡死、被 SIGSTOP、正在 `/update/stage` 都不影响它启动。
2. **线性化点**：持久写入 `released <G+1>`（复用 #1504 的 target-state 记录、原子 rename + fsync）。请求带 App 读到的当前代数；目标已是更新的 `secured` 代数时答 `superseded`，什么都不动（防止 App 重启后旧请求重放撤销新 Connect）。target 锁等待 ≤1 s；拿不到就先执行第 3 步终止持锁进程（flock 随持有进程死亡自动释放），再等 ≤2 s；仍拿不到则栅栏报 unknown，清理照做。
3. **终止旧写入者**：按可执行路径（helper、update executor、staged/backup helper、sing-box）和进程组枚举，SIGKILL，用 kqueue `NOTE_EXIT` 等待退出（≤3 s）。栅栏落盘后再扫一次：被 KeepAlive 重新拉起的进程读到 `released`，只会做解除方向的事。没能确认退出的进程，相关分项报 unknown 并列出 pid。
4. **删掉重新上锁的输入**：在所有写入者退出后删除保存的上锁意图（`killswitch.state` 等）和 AI hold 记录。之后即使 rollback 启动了旧 helper，也没有意图可恢复。（实现时逐版本核实 4.52.4x 启动行为，作为一条明确验证项。）
5. **清理**（复用 `--emergency-disarm` 的步骤和子进程期限）：PF 只 flush `tono.killswitch` anchor → DNS 从快照恢复 → 移除 AI 层 → 恢复系统代理残留 → 读回，1 s 后二次读回，变化则补做一次。
6. **硬截止**：worker 内独立看门狗线程在 30 s 时写出当时的分项结果并 `_exit`。App socket 超时 32 s。答复分项：PF、Core/TUN、DNS、代理、AI 各自 `restored` / `not restored`（列残留）/ `unknown`。只有全部 restored 且栅栏已落盘，界面才显示“已恢复正常网络”；否则显示“部分恢复/状态未知”和具体项。
7. **Connect 闸门**：`/session/connect` 对 release-in-progress 锁做 try-lock，被占则返回 `RELEASE_IN_PROGRESS`（最多 30 s，因为 worker 必定退出）。worker 退出前回收全部子进程；有回收不了的进程时拒绝 Connect 并说明原因。这样不再存在需要 Connect 等待的“旧 teardown”，R10-F1 以有界方式关闭。
8. **App 里残留的旧任务**：所有变更请求（arm、Core start/stop/sync、DNS enable/restore、自动 disarm）都带会话代数，helper 用完整代数比较并拒绝过期请求，修掉 ABA。旧任务的在途 IPC 会在 daemon 被杀时直接失败。
9. **系统代理**：去掉 App 自动开系统代理的路径（受管产品只用 TUN），解除只负责恢复残留。这条是产品行为变化，需要你确认（§8）。
10. **兼容**：App 以 release socket 能否握手且版本匹配来判断能力；不支持时走现有路径，不启用任何依赖新机制的超时优化，并提示修复 helper。
11. **紧急入口**：`sudo tono-core-helper --emergency-disarm` 改为调用同一个 worker（只保留一份实现）。

### 3.2 Windows（同构）
- 按需服务 “Tono Release”（demand start，SDDL 允许交互用户启动），运行 `tono-service.exe --user-release`。App 直接启动它，不经 `privileged_transition` 和 `OWNER_LIFECYCLE_LOCK`。
- 把 release epoch 和 disarmed intent 一起落盘；TerminateProcess 主服务、恢复计划任务进程和 sing-box 并等待退出（≤3 s）；按 Tono provider/sublayer GUID 删除 persistent WFP 对象；DNS、代理恢复；读回；30 s 硬截止。SCM 重启主服务后读到 released，只做解除方向的事。
- 开始菜单“恢复网络”改用同一个 worker，不再因服务在运行而拒绝。
- 修复锁/待处理更新不再能拒绝用户解除（只拒绝自动解除）。

## 4. 时间预算（Mac，Windows 同结构）

| 段 | 期限 |
|---|---|
| launchd 拉起 + 握手鉴权 | 2 |
| 栅栏（含一次终止持锁进程） | 4 |
| 终止 + 等待退出 + 复扫 | 4 |
| PF flush | 5 |
| DNS 恢复 | 6 |
| AI 层 | 3 |
| 代理残留 | 3 |
| 读回 + 二次读回 | 3 |
| **硬截止（看门狗 `_exit`）** | **30** |

“答复有界”由看门狗保证，与操作系统行为无关。“网络恢复有界”只在每段都在期限内完成且读回干净时成立，读回就是证据。

## 5. 无法证明的部分（如实列出）
- 卡在内核里的进程（不可中断睡眠）收到 SIGKILL 后不一定立刻退出，它正在进行的系统调用仍可能完成。此时只能报 unknown 并拒绝 Connect；PF 残留会被重启后 daemon 的看门狗在 released 状态下持续移除，但这是收敛，不是证明。
- DNS 写入进程死亡后不会再有提交，依赖“`SCPreferencesCommitChanges` 由客户端在持锁时原子写入、Apply 只应用当前存储值”这一前提（#1504 的 D3 分析）。必须真机验证。
- 管理员用旧版 Tono 安装包降级，不在保证范围内。
- launchd 的 socket 激活和 Windows SCM 的按需启动本身没有文档化的时间上限；超时时 App 报“无法联系恢复组件”并给出紧急入口，不显示已恢复。

## 6. #1504 四项设计失败如何关闭
- **D3-F1 锁与效果所有权**：不需要跨进程互斥锁。解除时所有其他写入者已被终止并回收，唯一写入者是 worker；回收不了的进程 → unknown + 拒绝 Connect。
- **D3-F2 跨生命周期 epoch**：代数落盘；请求带观察到的代数，旧请求重放答 `superseded`；不返回缓存的 released，每次重新读回。
- **D3-F3 旧写入者**：活着的被终止；之后启动的旧 helper 没有可恢复的上锁意图；解除入口是独立路径，不受 rollback 影响。限制见 §5。
- **D3-F4 代理**：去掉自动开代理的写入者，解除只恢复残留。

## 7. 验证方法
证据分四类，分开报告，不合并成“全部通过”：

1. **Linux 可跑**：契约 guard、build source 测试、Windows 前端单测。
2. **托管 CI（macos-26 / windows-2025）**：helper `--self-test`（以 root 运行）、XCTest、`cargo test`。新增回归，每个行为一条：
   - daemon 卡在 `/update/stage` 并持有 update lock 时解除仍在 30 s 内答复；
   - daemon 被 SIGSTOP 时解除仍能完成，Core/PF 读回正确；
   - 忽略 SIGTERM 的子进程被终止；
   - 栅栏后旧请求（arm / core stop / dns enable）全部被拒绝；
   - G→G+1→G+2 的 ABA：旧效果被拒绝；
   - 旧解除请求重放答 `superseded`；
   - worker 运行中 Connect 得到 `RELEASE_IN_PROGRESS`，worker 退出后 Connect 成功；
   - 看门狗在步骤挂死时 30 s 内 `_exit` 并报 unknown；
   - 查询失败报 unknown 而非 restored；
   - 不支持新入口的旧 helper 走旧路径，不启用超时优化；
   - Windows 对应条目。
3. **mock IO 的 App 测试**：只证明 UI 如实呈现分项结果，不作为恢复证据。
4. **真机（你的 Mac 和 Windows 设备，签名包）**：逐条覆盖 handoff 列出的 12 个场景，外加 PF、DNS、AI、代理逐项读回，以及真实上网（普通网站和 AI 服务各一）。重点项：
   - 长更新中点恢复；
   - 恢复后立刻 Connect，确认旧任务不会断开新连接；
   - SIGSTOP / kill daemon；
   - 恢复后 rollback 到旧 helper，2 分钟内不重新封网；
   - 睡眠唤醒；
   - 断网、未登录；
   - App 卡死时用紧急入口。

## 8. 实施计划与需要你决定的事

**P0 协调（实施前必做）**：Amp 停止推送 helper 和 App 恢复相关源码；#1504 冻结在一个 SHA。我建议在其 head 上另开分支实施（复用 target-state、emergency-disarm、有界子进程），#1504 作为 base 先合或折叠进来。同一时间只有一个线程改 helper 恢复源码。

**P1 Mac helper**：release worker、launchd 任务、安装脚本和 executor 安装第二个 plist、持久代数、请求代数校验、Connect 闸门。

**P2 Mac App**：Restore 改走新入口、能力判断、分项结果展示、移除自动系统代理。

**P3 Windows**：Release 服务、持久 epoch、开始菜单入口、解除不再被修复锁或更新拒绝。

**P4 交付**：独立 Codex high 审核（高风险路径，AGENTS 要求）→ 同一版本号签名包 → 真机清单。签名需要你的 Mac Studio 证书环境和 Windows 签名环境审批，我不会索要凭据。

**规模估计**：约 2,000–3,200 行（含测试），低于 (c) 的 3,400–5,400 行。依据：PF/DNS/AI/读回步骤已在 `OperatorRelease.swift`（2,083 行）中，有界子进程已在 main（#1542）。不确定性主要在三处：Windows 的 WFP/SCM 细节、旧 helper 启动行为核实、审核轮数。实现约 1.5–2.5 周再加真机验收，误差较大。

**需要你确认**：
1. 采用抢占式解除，替代 (c) 的全局锁方案（推荐）。
2. 协调方式：Amp 暂停，从 #1504 冻结点开新分支（推荐）。
3. 受管产品只用 TUN，移除自动开系统代理（推荐）。
4. Windows 更新 Prepare 失败时：保持保护（推荐，与 Mac decision 092 一致，前提是恢复可靠），还是自动释放。

---

## 9. 修订 v2（回应所有者 2026-10-11 08:23 提出的四个漏洞）

### 9.0 “可靠恢复”的定义（所有者 2026-10-11 08:28）
1. **在明确期限内给出真实状态**：已恢复、部分恢复或未知；不承诺系统故障下必定在 N 秒内恢复网络。
2. **显示“已恢复”前，逐项读回通过，且不存在仍可能改变网络状态的旧任务。**
3. **未知状态不会被当成成功**：保留可达的重试／紧急恢复入口，并明确说明新 Connect 被阻止的原因。

阻止 Connect 只用于避免与仍在运行的清理重叠，**它本身不是恢复成功**，也可能让用户持续无法连接；这种情况必须作为“未知/阻止原因”如实显示，并且有可达的出口。

v1 的问题在于把“进程被杀”当成了终点。v2 把保证改写成三条，每条都必须有证据：
- (A) 解除完成时，没有任何 Tono 写入者在运行，也没有任何一个能被启动；
- (B) 解除自己发出的每个系统操作，在新 Connect 获准之前都已经结束；
- (C) 结果来自读回，读不到就报 unknown。

### 9.1 杀进程 ≠ 系统操作停止
按写入通道逐一分析，而不是笼统说“进程死了”：

| 通道 | 交给系统后还会不会迟到生效 | 依据 / 证明方式 |
|---|---|---|
| PF（pfctl ioctl） | 不会。ioctl 在内核里同步完成，进程退出即已返回 | 内核语义；回收后的读回就是终态 |
| DNS / 代理（Mac SCPreferences） | S（`configd-1405.100.8`）：root 客户端在进程内直接写文件并 rename 完成 Commit；Apply 发出通知，由 PreferencesMonitor 异步更新 Setup，再由 IPMonitor 另行发布解析器配置。公开头文件把 Apply 描述为请求，Lock 不是下游完成屏障 | 后端是否已静止：**U**。SPIKE M1 只能给出 O（“这些条件下未观察到回退”），不能证明终态，任何次数的重复都不能把它升级 |
| WFP（Windows BFE） | 未提交的事务随 engine handle 关闭而中止；已提交的即终态 | 文档语义 + 真机：事务中途 TerminateProcess |
| DNS（Windows） | v1 写错了通道（Sol E-F4）。`SetInterfaceDnsSettings` 只用于保护写入（`native_apply.rs:1-8`）；恢复走 IPv4 CIM `SetDNSServerSearchOrder`（由 WmiPrvSE 代为执行，不在我们的进程树内）、IPv6 netsh、四个注册表值（`engine.rs:820-845,1041-1064,1344-1384`）。我们的进程退出后，代理进程执行的操作是否还会落地：**U** | SPIKE W4 只能给出 O；没有 D 依据时，终态保持 U |

无论 M1 结果如何，Mac DNS 的迟到风险都保持 U，除非找到 D 级依据；如果 M1 出现反例，结构性的修法是改用随会话自动撤销的临时 `State:` 值（configd 在写入进程死亡时自动删除）。那是更大的改动，只作为后备方案。

### 9.2 旧进程再次启动：持久启动隔离
改用操作系统自己执行的禁用，不依赖旧代码是否遵守 `released`：
- **Mac**：解除第一步 `launchctl disable system/com.raydocs.tono.core-helper` 和 update executor 的 label。禁用状态持久保存在 launchd 的覆盖数据库里，重启后仍然有效；KeepAlive、rollback、executor 都无法拉起被禁用的服务，无论二进制是哪个版本。现有安装脚本只执行 `bootstrap`、从不执行 `enable`（源码依据：`HelperManager.swift:100-140`，且 `git log -S"load -w"` 在 macOS 安装代码历史中无结果）。这只是源码依据，**不能据此推断隔离对所有路径成立**，由 SPIKE M3 逐条实测（含旧版安装包、更新、rollback、重启）。只有用户的 Connect 会执行 `enable` + `bootstrap`。需真机验证：被禁用服务的 `bootstrap` 会失败。
- **Windows**：主服务启动类型改为 Disabled（SCM 持久保存，恢复动作和 StartService 都会失败），禁用 “Tono Update Recovery v1” 计划任务。只有用户的 Connect 恢复。
- 自动更新：新版本的更新路径在 released 期间不安装、不启用。管理员手动运行旧版安装包重新安装，是明确的管理员操作，作为已声明的限制。
- 结果：released 期间主 daemon/服务根本不在运行。状态查询由解除组件回答。

### 9.3 解除组件自身的权限、崩溃和协调
- **权限**：Mac 是 launchd 按需任务（root），由安装脚本以管理员身份安装，独立二进制路径不受 rollback 影响；Windows 是 LocalSystem 按需服务，安装时 SDDL 只授予交互用户 START 权限，不给停止或配置权限。
- **不误杀自己**：终止名单按 label 或服务名精确列出（主 daemon、executor、sing-box），不是“所有特权进程”；本进程与解除组件路径不在名单中。
- **单实例**：launchd socket 任务和 Windows 服务天然只有一个实例，重复 Restore 并入正在运行的那一次。
- **崩溃恢复**：开始时写持久的 `release-pending` 标记。Mac 计划用 launchd 文档化的 `KeepAlive` → `PathState`（`launchd.plist(5)`：路径存在时保持任务运行），这是 launchd 的配置项，不是自定义标记自动生效；它与 socket 激活能否同用、退出后的节流和崩溃循环行为由 SPIKE M4 验证。Windows 的 SCM **不看磁盘标记**；是否按恢复动作重启，取决于服务报告的 SERVICE_STOPPED、退出码和 `SERVICE_FAILURE_ACTIONS_FLAG`（安装器已开启 non-crash failures，`install_service.rs:2693`），不是简单的“正常还是异常退出”；开机后谁来继续未完成的解除，由 SPIKE W5 确定实际机制。两边都必须验证崩溃循环不会让网络来回变化。每一步都是幂等的，崩溃后从头重跑。写完 released 之后崩溃，结果是“已隔离、清理待完成”，不会是半解除。
- **新 App 启动**：从解除组件读状态，不使用缓存；released 期间不自动连接（持久在 helper 侧，而不是 App 偏好设置）。
- **新 Connect**：只能通过解除组件发起；`release-pending` 存在时拒绝，并显示“仍在恢复”。CAS released G+1 → secured G+2 后，才 enable 并启动主 daemon。
- **Windows 差异**：用 Job Object（KILL_ON_JOB_CLOSE）保证主服务的所有子孙进程一起终止；WFP 是 persistent 过滤器，必须由解除组件按 GUID 删除，重启电脑不会清掉它们。

### 9.4 每个操作都有期限，超时的清理不会影响新连接
- 解除组件进程内不做阻塞的系统调用。每个 OS 操作（pfctl、SC 写入和读回、WFP、DNS）都在独立子进程中执行，各自有期限，到期 SIGKILL / TerminateProcess 后回收。进程内只剩写小文件和等待子进程。
- （已被 §10 取代）v1/v2 这里写的是“子进程都回收后就清除 pending”，同时又写“可能还在进行的后端操作必须阻止 Connect”，两句互相矛盾（Sol E-F5）。子进程已回收，不能排除 configd、CIM、BFE 的迟到操作。正确的区分和规则见 §10。
- 读回不干净时，解除组件按退避间隔继续重试，直到干净，或者用户选择 Connect。

### 9.5 我们能承诺什么，不能承诺什么
- **目标（待实验确认能否成立）**：答复有界；显示“已恢复”时，逐项读回通过，且所有已知 Tono 写入者都已确认退出、启动隔离已生效；解除自己的写入都发生在新 Connect 之前。
- **明确边界（这些情况只能报“未知”，不能报“已恢复”）**：超时后仍有子进程未回收；系统里可能还有在途提交（SC/configd、BFE、DNS Client，取决于实验结果）；管理员重新安装旧版本或手动解除隔离；启动隔离被某条未覆盖的路径绕过。“没有写入者”只对已列出并经实验覆盖的启动路径成立，不是绝对断言。
- **不能证明**：系统调用本身多久完成（pfctl、configd、BFE 都没有文档化的上限）；进程卡在内核里时多久能真正退出。这两种情况下，答复是 unknown，Connect 被拒绝并说明原因，后台继续重试。Mac 的 PF 在重启后不会残留（daemon 已被禁用、不会在开机时加载，需真机确认）；DNS 和 Windows WFP 是持久配置，重启后仍会残留，只能依靠重试和紧急入口。
- 所以目标采用 §9.0 的定义，不承诺超出它的保证。

### 9.6 规模变化
新增 launchd disable/enable 与 PathState、Windows 启动类型与计划任务切换、SC/WFP 操作移入子进程、`release-pending` 状态机。之前写的行数（2,500–4,000）和“1–2 天实验”**都撤回**：实验日程见 SPIKE §9（每个平台约 2–3 周机器时间）；实现规模要等实验结果出来、架构确定之后再估。

## 10. 单一可执行序列 v4：门控效果槽位（回应 Sol E-F5 / F5-a…d、E-F5-v3-a…c；取代 §3、§4、§9.4 及之前版本的 §10）

### 10.1 机器级协调者 C（回应 E-F5-v3-b）
- **C 是一个机器级的锁对象，不是进程内互斥锁。**
  - Mac：固定锁文件 `/Library/Application Support/Tono/release.lock`，由安装器创建，属主 root:wheel、权限 0600。打开时用 `O_NOFOLLOW | O_CLOEXEC`，打开后对描述符检查属主和权限，再用 `flock(LOCK_EX)` 加锁。该文件**永不被 rename 替换或 unlink**；持久记录 `release-state` 是另一个文件，原子写入时只替换它自己。
  - Windows：`Global\` 命名空间下的命名 mutex，DACL 只授予 SYSTEM；或者对 `ProgramData` 下一个固定锁文件使用 `LockFileEx`，同样 DACL 只授予 SYSTEM，并拒绝重解析点。持有者死亡时，mutex 返回 `WAIT_ABANDONED`、文件锁被释放，后来者据此知道上一位持有者是崩溃退出的。
- **持有者死亡只会释放锁，不会让它准入的效果消失。** 那些效果仍按 §10.2 的槽位保留，直到各自退休。
- **入口清单**，每个入口的身份和规则：

| 入口 | 能否成为 C 的持有者 | 规则 |
|---|---|---|
| 解除组件（socket 激活的实例） | 能 | 每次改动前都在持有 C 时读取最新的持久状态，不使用缓存 |
| 解除组件（PathState/SCM 恢复拉起的实例） | 能 | 同上；只处理 C 写入、来自已认证请求的记录 |
| 两个 label 的变体（如果采用） | 能 | 两个 label 共用同一个锁对象 |
| 紧急 CLI（管理员） | 能，但只在拿到 C 之后 | 有限时间内等不到 C 时，只能终止 `release-state` 里记录的持有者（按 pid + 启动时间核对身份），等锁被释放后再获取 C；仍拿不到就只报告、不做改动 |
| 更新、安装、替换解除组件 | 能，仅用于交接 | 替换前必须持有 C；`release-state` 里有未退休槽位或 pending 时，拒绝替换（推迟到之后再做）；替换完成后释放 C，新版本从持久状态继续 |
| 主 daemon / 主服务 | 不能 | 只读 target，从不写入 |
| App | 不能 | 只能通过 IPC 请求解除组件 |

- **抢不到 C 的实例**（例如竞争启动时的第二个实例）不做任何改动，直接退出，或者向客户端答复“忙”。
- **Connect 也在 C 下完成。** 效果准入、Connect、每一次状态转移和崩溃恢复，都在持有 C 时基于最新持久状态进行。

### 10.2 效果槽位状态表（每个“效果”是解除组件要做的一个系统改动：disable、终止、PF flush、DNS 恢复等）

每次尝试都占用一个新的槽位，有自己的效果 ID。槽位**不复用**，也不会因为后来某次重试成功而被删除或覆盖。

| 状态 | 进入方式 | 持久记录内容 |
|---|---|---|
| **Admitted** | 在**同一次**持有 C 时，确认所有权并写入槽位，fsync 后才释放 C | 效果 ID、通道、请求 ID、开机身份、准入时间 |
| **Gated** | 子进程以**门控方式**创建（回应 E-F5-v3-a）。Mac：`posix_spawn` 进入新进程组，子进程先阻塞读取门管道，读到 `go` 才执行；沿用 #1542 已有的准入门模式。Windows：`CREATE_SUSPENDED`，先加入只由 C 持有句柄的 kill-on-close Job，再 resume。子进程此时还没有执行任何效果 | — |
| **Ready** | 在持有 C 时把稳定身份写入槽位并 fsync，然后才放行。Mac：pid + 启动时间 + pgid。Windows：pid + 创建时间 + Job 名。进程句柄的数值不作为跨重启身份 | 稳定身份 |
| **Running** | 写 `go` 或 resume 之后。从这一刻起，效果可能已经执行 | — |
| **ChildGone** | 整个进程组或 Job 已空，由句柄或 kqueue 确认 | 退出时间 |
| **Terminal** | 该通道的终态有 D/S 依据（例如 pf ioctl 同步返回、WFP 事务中止语义）。**交给 broker 的工作（WmiPrvSE、configd）单独记录**：除非另有依据，否则一律为 U | 终态依据 |
| **Retired** | Terminal 之后，在持有 C 时删除槽位 | — |

**崩溃恢复转移**（恢复实例拿到 C、读取最新持久状态之后）：

| 发现的槽位 | 处理 |
|---|---|
| Admitted，没有身份 | 门控保证子进程在拿到 `go` 之前不会执行：父进程死亡时，Mac 子进程读到 EOF 后退出，Windows 的 Job 关闭后子进程被终止。在门控机制经 SPIKE L1/L2 验证之前，这类槽位**保持未知并阻挡 Connect**；验证之后可以按“未执行（依据 S+O）”退休。不会对它重复执行同一个效果 |
| Ready 或 Running（有身份） | 一律视为“可能已执行”：按身份确认整组进程是否仍在，在就等待或终止；全部消失后进入 ChildGone，再按通道判断终态 |
| ChildGone，终态为 U | 保留，继续阻挡 Connect（例外见 §10.3 的重启） |
| 记录部分写入、损坏，或校验失败 | 未知，阻挡 Connect，**永不自动退休**。出路是外部救援步骤，或者管理员显式重置（另行设计，需要所有者批准） |
| rename 或目录 fsync 失败 | 本请求停止改动，答复未知；之后的实例按读到的状态处理 |

规则：
1. **检查与准入是一体的**：在同一次持有 C 时确认所有权并写入 Admitted；否则不做任何事。
2. **Connect 的条件**：在 C 下，没有任何未退休的槽位（任何状态，包括未知和损坏），才能 CAS 为 `secured <G+2>`。
3. **拿不到 C 或持久化失败**：停止改动，答复未知，不做清理。
4. **合并**：新的 Restore 只有在认证通过、属于同一所有者，并且期望代数与 `release-state` 记录一致时，才并入正在进行的那次解除；否则答 `superseded`。
5. **UI 期限**只是停止等待，不会让任何槽位退休。

### 10.3 Connect 被挡住时，以及重启的作用（回应 E-F5-v3-c）
- 严格分支下，只要还有未退休的槽位，Connect 就会被拒绝。拒绝时如实说明原因，并给出可用的出口。**拒绝 Connect 不是恢复成功**（§9.0）。
- **重启只能作为“旧执行已结束”的边界，不能证明网络干净，也不能证明以后不会重放。** 重启后要分三件事处理：
  1. **旧执行**：只有确认发生了一次完整的内核启动，才能认定上一次开机里的进程和内存中的调用都已结束。可信的开机身份必须只在完整内核启动时变化：Mac 计划使用 `kern.bootsessionuuid`，Windows 计划使用内核记录的启动时间或启动 ID。daemon 重启、睡眠、休眠、Fast Startup、VM 暂停或快照恢复都**不算**这种边界（Windows 的 Fast Startup 实际是内核会话休眠）。这些标识在哪些情况下会变，由 SPIKE M8/W7 验证。
  2. **持久残留**：持久的 DNS、代理、WFP 不会因重启消失。重启后照常逐层读回。
  3. **待重放和自动恢复的权限**：新一次开机后，在准入 Connect 之前，先在 C 下清点所有能在开机时重新应用旧配置的东西：launchd/SCM 自动启动、恢复动作、计划任务、Tono 的 pending 和意图文件、更新的待完成事务等。任何重放都必须在 C 下注册为当前开机的新槽位，并核对当前所有者和代数。无法排除的重放或自动恢复保持 U，继续阻挡 Connect。
- 所以，重启后能否准入 Connect，取决于清点和读回的结果，而不是“开机身份变了”本身。
- 为了让 Connect 被挡住的情况少发生，正式架构可以优先选择终态有依据的通道，例如 Windows IPv4 DNS 恢复不经 WmiPrvSE。这是架构阶段的决定，交给实验结果和所有者。
- **较弱的候选 B**：允许 Connect 与未退休效果并存，迟到效果由监督修复。它不满足“旧清理不碰新会话”，不作为 E-F5 的通过条件，由所有者决定是否评估（SPIKE §7）。

### 10.4 序列（每一步都幂等，崩溃后按 `release-state` 从相应步骤重跑）
1. **认证**：只接受已认证、绑定所有者的请求（请求 ID + 期望代数）。只有 START 权限或激活 socket，不产生任何效果。
2. **在 C 下 CAS 抢占所有权**：
   - 当前为 `secured G` 且等于期望代数：写入 `released <G+1>`、owner=R 和 pending，fsync；
   - 当前已被更新的 Connect 改为 secured：答 `superseded`，不做改动；
   - 当前已是 released：按 10.2 第 5 条合并或拒绝；
   - 写入失败：按 10.2 第 3 条停止。
3. **启动隔离**、4. **终止写入者**、5. **终止后清点**、6. **清理**：每一个改动都按 10.2 走完 Admitted→Gated→Ready→Running→…→Retired。
7. **读回**：按 SPIKE §4 的各层读回。
8. **答复**：截止时间到或全部完成时答复，按两条轴分别给出：
   - **当前读回**：一致 / 残留 / 读不到；
   - **迟到风险**：终态有依据 / U。

   界面如何呈现，属于后续 UI 决定。答复超时只说明没有按时答复，**不说明 worker 或后端已经结束**。
9. **后台续跑**：只要仍持有所有权，且还有残留或未退休的效果，就按退避间隔继续第 4–7 步。每一个新效果都要重新经过第 1 条的“检查与准入一体”。

### 10.5 外部救援步骤（不是同一个 worker）
紧急入口调用的是同一个 worker，不算独立的救援手段。正式实现必须另外提供不依赖 Tono 组件、由管理员手工执行、并在测试机上演练过的步骤。这些步骤必须针对具体的 DUT 和版本，可以直接运行，不能假设存在一条能删除任意 WFP provider 的通用命令（SPIKE §9.1 第 1 条）。它们的可靠性同样要分级标注（D/O/U）。
