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
| 紧急 CLI | 走同一段代码（进程内执行），拿不到 C 只报告“忙”，不终止持有者 |

## 2. 答复与两条轴

- worker 在 25 s 时答复当时的分项状态；后续工作继续进行，最长 90 s，然后杀掉自己的进程组并退出。
- 每个分项都报告当前读回（`restored` / `residual` / `unreadable`）和迟到风险（`settled` / `unknown`）。
- 总体状态只有三种：
  - `restored`：所有分项读回干净，并且 worker 自己的子进程都已回收。
  - `partial`：有残留。
  - `unknown`：读不到，或者超过了期限。
- 迟到风险为 `unknown` 时（例如 Windows 的 IPv4 DNS 经 WmiPrvSE 执行），App 显示“已恢复，但……”之类的区分说明，不能写成无条件的“已恢复”。

## 3. 已知限制（如实保留）

- configd、WmiPrvSE 等 broker 的迟到效果无法从外部取消，只能靠读回加间隔复读发现。
- 被 SIGKILL 后仍卡在内核里的进程，只能记录下来并阻挡 Connect。
- 降级到不认识 `release-state` 的旧版本，不在保证范围内。
- 测试用户的真机结果就是实验数据，需要按 D/S/O/U 归类，不写成“全部通过”。
