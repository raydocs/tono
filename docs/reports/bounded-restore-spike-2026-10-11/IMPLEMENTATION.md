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
| 紧急 CLI | Mac：走同一段代码（进程内执行），拿不到 C 只报告“忙”，不终止持有者。Windows：**尚未接入 C**，见 §4 |

## 2. 答复与两条轴

- worker 在 25 s 时答复当时的分项状态；后续工作继续进行，最长 90 s，然后杀掉自己的进程组并退出。
- 每个分项都报告当前读回（`restored` / `residual` / `unreadable`）和迟到风险（`settled` / `unknown`）。
- 总体状态只有三种：
  - `restored`：所有分项读回干净且迟到风险为 `settled`，worker 已收尾，没有卡死进程。
  - `partial`：有残留。
  - `unknown`：读不到，或者超过了期限。
- 读回干净但迟到风险仍为 `unknown`（例如 Windows 的 IPv4 DNS 经 WmiPrvSE 执行）时，总体是 `unknown`，App 不显示“已恢复”，保留重试和紧急入口。

## 3. Windows 落地方式

- 第二个 SCM 服务 `TonoRelease`（开发版 `TonoReleaseDev`），显示名“Tono Restore Network”。映像是 `tono-release.exe`，与已安装的 `tono-service.exe` 逐字节相同，参数为 `--release-service`。主服务每次启动时，在 C 的 try-lock 下比较 sha256，不同就停掉旧服务、替换副本并重新注册。所以解除进行中不会换掉映像。卸载器会删除该服务和这个副本。
- 管道 `\\.\pipe\tono-release` 与主管道的 SDDL 相同，鉴权也相同（主人身份校验）。路由有三条：`GET /magic`、`POST /release`（发起，或加入正在进行的那次）、`GET /release/status`。
- 每次解除只起一个 worker（`--release-worker`），放在服务持有的 kill-on-close Job 里运行。服务在 25 s 时答复；到 90 s 关闭 Job。每次结束后以及服务启动时，都会执行 `recover_quarantine`：如果 worker 死前把主服务留在 Disabled，就把它恢复回来。
- worker 的顺序：
  1. 取 C（3 s，拿不到就答复 busy）。
  2. 检查代数，过期则答复 superseded。
  3. 先把 worker 身份落盘。
  4. 隔离主服务：改为 Disabled，去掉失败重启动作。
  5. 停用恢复计划任务。
  6. 按映像身份终止主服务、更新执行器和 Tono 内核；回收不了的记入 stuck。
  7. 执行紧急解除：写入 owner 已停、WFP 解除、严格 DNS 还原。
  8. 读回 WFP、适配器 DNS、NRPT 规则和内核进程。有残留就再清理一次，然后隔 1 s 再读一次；两次一致才算 settled。
  9. 恢复主服务。更新执行器保持隔离，直到下一次 Connect 准入。
- Connect 准入：`StartClash` 带上 App 已知的代数（协议修订 21）。服务只在 C 下判定（1.5 s）。结果有四种：解除进行中 1017、未收尾 1018、记录损坏 1019、代数过期 1020，都返回 409，App 显示原因，并保留重试和紧急入口。
- App：新命令 `tono_restore_internet` 先作废当前连接，再请求解除服务，不等任何旧守卫。只有 `restored` 才退出登录或退出程序；其余情况都保持“保护中”状态，显示部分、未知或忙的提示。解除服务不可用时（旧版本服务），回退到原来的断开流程。

## 4. 已知限制（如实保留）

- Windows 紧急 CLI 尚未经过 C，与解除服务并发时可能交错（两者都是解除方向）。
- Windows 的 `ReleaseKillSwitch` 路由不校验代数；作废旧任务靠 App 的 `invalidate_connection` 中止任务，代数是全局的，不按任务区分。
- Windows 经 WMI 的迟到 DNS 写入只能靠两次读回发现。
- Windows 服务代码只能在托管 Windows CI 编译和运行单元测试；SCM 注册、Job 关闭、计划任务停用均未在真机执行过。
- configd、WmiPrvSE 等 broker 的迟到效果无法从外部取消，只能靠读回加间隔复读发现。
- 被 SIGKILL 后仍卡在内核里的进程，只能记录下来并阻挡 Connect。
- 降级到不认识 `release-state` 的旧版本，不在保证范围内。
- 测试用户的真机结果就是实验数据，需要按 D/S/O/U 归类，不写成“全部通过”。
