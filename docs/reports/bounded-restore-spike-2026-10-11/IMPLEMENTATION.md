# 抢占式“恢复正常网络”：实现说明（2026-10-11 起）

所有者 2026-10-11 17:06 决定跳过真机可行性实验，直接实现，由测试用户在真机上检验。所以本文的机制**没有经过 SPIKE 的实验验证**。凡是 SPIKE 标为 U 的项目，在实现里一律按“未知”处理并阻挡 Connect，不当作已证明。PROPOSAL §10 v5 是设计依据。本文只记录实现时为了能落地而做的具体取舍。

## 1. 与 §10 v5 的对应和简化

| §10 v5 | 实现 |
|---|---|
| 机器级协调者 C | Mac：`/Library/Application Support/Tono/release.lock` 上的 `flock`。Windows：`ProgramData\Tono\release.lock` 上的 `LockFileEx`，只有 SYSTEM 组件打开 |
| 持久状态 | `release-state.json`（同目录），原子写（临时文件 + fsync + rename + 目录 fsync） |
| 每个效果一个槽位 | **简化**：一次解除就是一个槽位，单位是解除组件的整个进程组（Mac 的 pgid）或 Job（Windows）。所有效果都由解除组件本身或它的子进程执行。效果开始之前，worker 身份（pid、启动时间、开机会话）已经落盘。只有这个组为空，槽位才退休；回收不了的进程按身份记录下来，继续阻挡 Connect |
| 门控 spawn | 子进程都在 worker 的进程组或 Job 里。worker 身份先落盘再 spawn，所以 worker 崩溃后，按记录的 pgid 或 Job 仍能找到这些子进程 |
| Connect 准入 | 只在 C 下进行：没有活着的 worker、组为空、没有残留的卡死进程，才把状态 CAS 成 `secured <G+2>` |
| 旧请求 ABA | App 每次会话准入后拿到代数 G，之后所有特权请求都带 `X-Tono-Generation`。守护进程收到与当前代数不符的请求一律拒绝 |
| 启动隔离 | 解除期间：Mac 对 helper 守护进程和更新执行器执行 `launchctl bootout`；Windows 把主服务改为 Disabled、清除失败重启动作，并停用恢复计划任务。解除结束、读回完成后恢复守护进程，让 App 能正常工作；更新执行器保持隔离，直到下一次 Connect 准入 |
| 紧急 CLI | 见 §4：紧急 CLI 是测试员手动授权的破窗手段，与一键恢复的保证分开 |

## 2. 答复与两条轴

- worker 在 25 s 时答复当时的分项状态；后续工作继续进行，最长 90 s，然后杀掉自己的进程组并退出。
- 每个分项都报告当前读回（`restored` / `residual` / `unreadable`）和迟到风险（`settled` / `unknown`）。
- 总体状态只有三种：
  - `restored`：所有分项读回干净且迟到风险为 `settled`，worker 已收尾，没有卡死进程。
  - `partial`：有残留。
  - `unknown`：读不到，或者超过了期限。
- 读回干净但迟到风险仍为 `unknown`（例如 Windows 的 IPv4 DNS 经 WmiPrvSE 执行，账本里还有未销账的批次）时，总体是 `unknown`，App 不显示“已恢复”，保留重试和紧急入口。迟到风险只按终结证据判定，见决策 [094](../../decisions/094-2026-10-11-restore-settles-on-terminal-evidence.md)。

## 3. Windows 落地方式

- 第二个 SCM 服务 `TonoRelease`（开发版 `TonoReleaseDev`），显示名“Tono Restore Network”。映像是 `tono-release.exe`，与已安装的 `tono-service.exe` 逐字节相同，参数为 `--release-service`。主服务每次启动时，在 C 的 try-lock 下比较 sha256，不同就停掉旧服务、替换副本并重新注册。所以解除进行中不会换掉映像。卸载器会删除该服务和这个副本。
- 管道 `\\.\pipe\tono-release` 与主管道的 SDDL 相同，鉴权也相同（主人身份校验）。路由有三条：`GET /magic`、`POST /release`（发起，或加入正在进行的那次）、`GET /release/status`。
- 每次解除只起一个 worker（`--release-worker`），放在服务持有的 kill-on-close Job 里运行。服务在 25 s 时答复；到 90 s 终止 Job。每次结束后以及服务启动时，都会执行 `recover_quarantine`：如果 worker 死前把主服务留在 Disabled，就把它恢复回来。
- worker 退出不能证明它启动的子进程也结束了（Sol R-F2）。worker 在任何效果之前记下 `jobs_unproven` 和持有 Job 的解除服务身份。worker 退出后，解除服务终止 Job，并查询 Job 里还有几个活进程。为 0 才丢掉句柄；不为 0 就留着句柄，每 5 s 复查一次。只有在 C 下、没有正在进行的解除、所有 Job 都已证明清空时，才清除 `jobs_unproven`。解除服务自身结束时，kill-on-close 会结束 Job 里的一切，这也算证明。
- worker 的顺序：
  1. 取 C（3 s，拿不到就答复 busy）。在 C 下核对主人：保护（kill-switch 意图）或正在运行的连接属于另一个 Windows 用户，就答复 refused，什么都不改；读不到主人也拒绝。管道入口先做同样的检查。规则与主服务的 `ReleaseKillSwitch` 相同。
  2. 检查代数，过期则答复 superseded。
  3. 把 worker 身份落盘，然后才执行任何效果。上一次解除留下的、尚未证明结束的 worker 和 stuck 进程会原样带进新记录。记录读不出来时，记下“本次开机历史丢失”，本次开机内一直阻挡 Connect。
  4. 隔离主服务：改为 Disabled，去掉失败重启动作，然后回读启动类型，确认确实是 Disabled。
  5. 停用恢复计划任务。任务是否存在，看 `System32\Tasks` 下的任务文件：文件不存在才算“没有任务”，其他读取错误一律算失败。停用后用 `/Query /XML` 回读，确认 `<Enabled>false</Enabled>`。
  6. 按映像身份终止主服务、更新执行器和 Tono 内核；回收不了的记入 stuck。扫描本身失败，就算扫描不完整。
  7. 执行紧急解除：写入 owner 已停、WFP 解除、严格 DNS 还原。
  8. 读回 WFP、适配器 DNS、NRPT 规则和内核进程。有残留就再清理一次。
  9. 恢复主服务，等它报告 Running，再等它的管道可以连接（它在启动时的恢复步骤做完后才打开管道），然后第二次读回。主服务启动时，只要记录是 released，就不重放内核。更新执行器保持隔离，直到下一次 Connect 准入。
  10. 判定 settled 用终结证据，不用两次读回一致（决策 094）。所有写入者都已证明结束、扫描完整、主服务和计划任务的隔离都已回读确认，WFP、NRPT 和内核才算 settled。适配器 DNS 还要求 WMI 账本里本次开机没有未销账的批次。有未销账批次时，记录 `broker_unknown_boot`，本次开机内阻挡 Connect，提示重启 Windows。
  11. 任何一步没证明自己成功（包括最后一次落盘失败），即使读回干净，总体也报 unknown。
- WMI 账本（`core/dns/broker_ledger.rs`）：IPv4 DNS 的兼容和恢复批次经 PowerShell 调用 `SetDNSServerSearchOrder`，实际执行在 WmiPrvSE。每批开始前在 `ProgramData\Tono` 写一个条目；记不下来就不执行这一批。PowerShell 返回后删除条目；在期限到时被杀，就把条目标为 abandoned。上一次开机的条目视为已结束并删除。开机身份由服务的开机标记和开机时间共同判断，重装只会改变标记，不改变开机时间，所以不会被误判成重启。
- Connect 准入：`StartClash` 带上本次连接尝试自己的代数（协议修订 21）。服务只在 C 下判定（1.5 s）。机器从未解除也从未准入时（代数 0），不带代数也可以连接；之后不带代数的 Connect 一律算过期。拒绝有四种：解除进行中 1017、未收尾 1018、记录损坏 1019、代数过期 1020，都返回 409，App 显示原因，并保留重试和紧急入口。
- 解除方向的请求也要核对代数（Sol R-F4：同一个主人不等于同一个会话）。`ReleaseKillSwitch` 和 `RestoreProtectedDns` 的请求体带上被拆除会话的代数，服务在生命周期锁下、在 C 下核对。StartClash 的准入也持有这把生命周期锁。机器处于已解除状态时，任何拆除都可以执行，因为没有会话可被波及；否则代数必须与当前一致，不带代数只在代数 0 时接受。状态快照里新增 `release_generation`，供拿不到自己代数的拆除临时读取当前值，再交给服务核对。
- App：
  - 每次连接尝试在准入时（`begin_attempt`，持有状态锁）拿一张自己的票据：App 本地序号、围栏状态和代数。之后不再从全局读取。
  - StartClash 成功后，票据更新为服务准入的代数。同一次尝试的第二次 StartClash、迟到提交的补偿拆除，都用这个代数。
  - “恢复正常网络”会推进序号并竖起围栏。用户亲手点 Connect 时，App 读取当前代数，推进序号，并落下围栏。序号不对或在围栏期间拿到的票据，在 App 本地就被拒绝。服务端再按代数拒绝一次。
  - 被判代数过期时，只有在此之后没有更新的操作，才竖起围栏。这样用户新的 Connect 导致旧任务被拒时，不会连带挡住新会话自己的重连。
  - App 启动后的第一次自动尝试，会先读取代数。如果机器处于已解除状态，就竖起围栏。
  - “恢复正常网络”的请求带的代数，是竖起围栏之后读到的当前值。用户在此之后点的 Connect 会以更新的代数准入，这次恢复就报 superseded，不去撤销它。
  - 只有 `restored` 才退出登录或退出程序；其余情况都保持“保护中”状态，显示部分、未知或忙的提示。解除服务不可用时（旧版本服务），回退到原来的断开流程。
- 代理（Sol R-M1）：Windows App 从不设置系统代理，只清除自己以前留下的代理（`core/sysopt.rs`），所以解除不需要代理分项。

## 3b. Mac：Sol 审查后的改动（helper 4.52.51）

- 终结证据（R-F1，决策 094）：先清理，再结束 Tono 自己的 `pfctl`/`networksetup`/`route` 子进程，然后再读回。子进程按共享的命令门控文本、参数里的 Tono 标记或父进程识别，参数用 `KERN_PROCARGS2` 读取。读不出参数或路径的进程算未知。分项只有在两次读回一致、隔离已回读确认、所有写入者都已结束、并且没有存活进程还能改它时才算 settled。DNS 另外要求存储的网络偏好里没有 127.0.0.1。没有 settle 的分项记入 `record.unsettled`，阻挡 Connect。
- 保留未结束的任务（R-F2）：新的解除把上一次的 worker 记入 `record.earlier`，存活的 stuck 进程原样保留。进程检查分为存活、已退出、未知三种；未知按存活处理。准入要求每个 worker 都已退出，且它的 session 和进程组为空，并且 `workerFinished` 已置位、没有 unsettled 分项。记录损坏时记下 `historyLostBoot`，本次开机内拒绝 Connect。
- 显式准入（R-F3）：不再隐式准入。不带代数的请求只允许“已保护状态下的保护方向请求”。`/session/admit` 以 `expectedGeneration` 做比较交换，全程在 C 下。新增 `GET /session/status`。App 端：会话盒被退休后不能再采用准入结果；同一个盒子的准入串行进行。机器处于已解除状态时，只有用户亲手点 Connect 创建的会话盒才能准入；唤醒恢复、受保护重连、启动时的自动连接都不行。
- 解除方向带代数（R-F4）：拆除请求在 C 下核对当前代数。没有已准入代数时，App 先读 `/session/status` 再发送。“恢复正常网络”带当前会话盒的代数，没有就取解除服务 `/release/status` 的代数。
- 失败不当成功（R-F5）：新增 `ReleaseReport.failures`，只要有一项，结果就是 unknown。每次 `launchctl bootout` 都回读 launchd 状态（已加载、未加载、未知），并带重试。最后一次落盘失败、扫描失败、bootout 未确认，都记为失败。
- 守护进程恢复（R-F6）：bootout 之前先持久写入 `daemonBootedOut`。`ReleaseQuarantine.recover` 在 C 下、确认 worker 已退出后，把 helper 守护进程恢复回来，回读确认已加载，然后清除标记。恢复失败记入 `daemonRecoveryFailure`，并在 `/release/status` 里显示。worker 收尾时、解除服务启动时、每次 worker 退出时都会执行；失败时每 15 s 重试一次。
- 代理（R-M1）：恢复在公布结果之前，只清除 Tono 自己的系统代理（127.0.0.1 或 localhost 上 Tono 的端口），并回读最多 2 s。代理还在时，结果从 restored 降为 partial；读不出时降为 unknown。原来那个分离执行、忽略错误的清除已删除。
- 紧急命令（R-M2）：`--emergency-disarm` 和 `--emergency-reset` 在 3 s 内拿到 C 时，先把记录写成已解除、换新代数、所有分项都标为未 settle，再执行命令。拿不到 C 时，作为人工破窗执行，不改记录。

## 4. 已知限制（如实保留）

- Mac 的紧急命令拿不到 C 时作为人工破窗执行，不经过 C。它在 C 下执行之后，Connect 会一直被拒，直到再做一次“恢复正常网络”并且所有分项都 settle。
- Mac 上，只要有一个进程的路径读不出，所有分项都算未知；扫描时恰好有其他程序在运行 `pfctl`/`networksetup`/`route` 写操作，相关分项也算未知。这两点都是有意偏向安全，代价是可能多出现“状态未知”。
- Mac 的 Swift 改动只能在托管 macOS CI 上编译和运行自测，`launchctl print` 对不存在的任务返回什么，按 113 或“Could not find service”处理，未在真机核对。
## 3b. Mac：Sol 审查后的改动（helper 4.52.51）

- 终结证据（R-F1，决策 094）：先清理，再结束 Tono 自己的 `pfctl`/`networksetup`/`route` 子进程，然后再读回。子进程按共享的命令门控文本、参数里的 Tono 标记或父进程识别，参数用 `KERN_PROCARGS2` 读取。读不出参数或路径的进程算未知。分项只有在两次读回一致、隔离已回读确认、所有写入者都已结束、并且没有存活进程还能改它时才算 settled。DNS 另外要求存储的网络偏好里没有 127.0.0.1。没有 settle 的分项记入 `record.unsettled`，阻挡 Connect。
- 保留未结束的任务（R-F2）：新的解除把上一次的 worker 记入 `record.earlier`，存活的 stuck 进程原样保留。进程检查分为存活、已退出、未知三种；未知按存活处理。准入要求每个 worker 都已退出，且它的 session 和进程组为空，并且 `workerFinished` 已置位、没有 unsettled 分项。记录损坏时记下 `historyLostBoot`，本次开机内拒绝 Connect。
- 显式准入（R-F3）：不再隐式准入。不带代数的请求只允许“已保护状态下的保护方向请求”。`/session/admit` 以 `expectedGeneration` 做比较交换，全程在 C 下。新增 `GET /session/status`。App 端：会话盒被退休后不能再采用准入结果；同一个盒子的准入串行进行。机器处于已解除状态时，只有用户亲手点 Connect 创建的会话盒才能准入；唤醒恢复、受保护重连、启动时的自动连接都不行。
- 解除方向带代数（R-F4）：拆除请求在 C 下核对当前代数。没有已准入代数时，App 先读 `/session/status` 再发送。“恢复正常网络”带当前会话盒的代数，没有就取解除服务 `/release/status` 的代数。
- 失败不当成功（R-F5）：新增 `ReleaseReport.failures`，只要有一项，结果就是 unknown。每次 `launchctl bootout` 都回读 launchd 状态（已加载、未加载、未知），并带重试。最后一次落盘失败、扫描失败、bootout 未确认，都记为失败。
- 守护进程恢复（R-F6）：bootout 之前先持久写入 `daemonBootedOut`。`ReleaseQuarantine.recover` 在 C 下、确认 worker 已退出后，把 helper 守护进程恢复回来，回读确认已加载，然后清除标记。恢复失败记入 `daemonRecoveryFailure`，并在 `/release/status` 里显示。worker 收尾时、解除服务启动时、每次 worker 退出时都会执行；失败时每 15 s 重试一次。
- 代理（R-M1）：恢复在公布结果之前，只清除 Tono 自己的系统代理（127.0.0.1 或 localhost 上 Tono 的端口），并回读最多 2 s。代理还在时，结果从 restored 降为 partial；读不出时降为 unknown。原来那个分离执行、忽略错误的清除已删除。
- 紧急命令（R-M2）：`--emergency-disarm` 和 `--emergency-reset` 在 3 s 内拿到 C 时，先把记录写成已解除、换新代数、所有分项都标为未 settle，再执行命令。拿不到 C 时，作为人工破窗执行，不改记录。

## 4. 已知限制（如实保留），也不读写解除记录。它是测试员手动授权的破窗手段，不属于“恢复正常网络”的保证范围，测试清单里也单列（Sol R-M2）。
- Windows 更新事务的 Disconnect（只在有待处理更新时执行）不核对代数。新会话准入后旧的更新断开仍可能作用于它，待单独处理。
- 恢复请求在竖起围栏后读取当前代数。这次读取与解除 worker 取得 C 之间，如果一次在途的旧 StartClash 恰好被准入，这次恢复会报 superseded；那次迟到的提交随后由 App 的补偿拆除按它自己的代数解除。
- 解除服务进程结束视为它持有的 Job 已结束（kill-on-close）。卡在内核里迟迟不退出的子进程，在这种情况下不会被继续追踪。
- 恢复网络后重启 App，开机自动连接会被围栏挡住，直到用户手动点一次 Connect。
- WMI 账本有未销账批次时，本次开机内不能再连接，只能重启 Windows。这是为了不把“可能还有迟到 DNS 写入”当成已恢复，代价是可用性。
- Windows 服务代码只能在托管 Windows CI 编译和运行单元测试。SCM 注册、Job 清空查询、计划任务回读、管道等待都没有在真机执行过。
- 被 SIGKILL 后仍卡在内核里的进程，只能记录下来并阻挡 Connect。
- 降级到不认识 `release-state` 的旧版本，不在保证范围内。
- 测试用户的真机结果就是实验数据，需要按 D/S/O/U 归类，不写成“全部通过”。
