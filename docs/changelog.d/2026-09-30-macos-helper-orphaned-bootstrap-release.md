## 2026-09-30 · macOS helper 释放孤儿 bootstrap 阻断

- 归属：SHIP_PLAN §2 第 10 项（装上会坏）。macOS 特权 helper（tooling/scripts/core-helper）的 PF 看门狗。
- 来源：main `64af499a` → 分支 `glm/mac-helper-orphan-bootstrap`；PR 待开；未合 main。
- 缺陷修复：App 在 `/core/start` 之后、提交隧道的 arm（`tunnelInterfaces: [utunN]`）之前崩溃或被强制退出时，Core 仍在运行，`observeCoreForWatchdog` 走 Core-running 分支每 10 秒重装 bootstrap 阻断（只放行 Core 自身出站），机器持续离线直到重开 Tono（MAC-ORPHAN-BOOTSTRAP-PF；该窗口在链式住宅代理下可达数十秒）。现在 helper 在内存记录会话属主：`/killswitch/arm`、`/core/start` 成功的已认证对端（`LOCAL_PEERPID` 的 pid 加 `proc_pidinfo(PROC_PIDTBSDINFO)` 的进程启动时间，防 pid 复用；后续成功请求替换），`/core/stop`、`/killswitch/disarm` 与看门狗释放后清除。Core 运行分支里，状态文件存在且保存的 `tunnelInterfaces` 为空、属主已记录且该进程确实消失（kill ESRCH、僵尸或启动时间变了）连续 3 次（约 30 秒，`orphanedBootstrapReleaseThreshold`）后放行：`core.stop()`（尽力而为并记错误）、`killSwitch.disarm()`、恢复 DNS，写一行 stderr。已提交会话（tunnelInterfaces 非空）不碰；无属主（helper 中途重启）不动作；不装任何阻断；原生更新事务待定（或账本读不出）时不动作，交给更新自身恢复（审阅时补）。#720 只覆盖 App 存活时的 arm 失败自愈，不覆盖进程死亡。
- 新增/优化：无。
- 工程与测试：`KillSwitchManager.runSelfTests`（`--self-test`）加一条纯决策 `SocketServer.orphanedBootstrapAction` 的回归：已提交会话、无属主、属主存活、无状态文件都返回 .reset；属主消失且 bootstrap-only 在阈值前 .count、到阈值 .release。
- 验证：本机（Linux，无 Xcode/Swift）未编译、未跑 `--self-test`；hosted CI 经 build-core-helper.sh 内的 `--self-test` 执行。仅人工核对 Darwin API：`LOCAL_PEERPID` 与已在用的 `LOCAL_PEERTOKEN` 同出 sys/un.h，`proc_pidinfo`/`proc_bsdinfo`/`pbi_start_tvsec` 与 main.swift 既有用法一致；文件清单未变，不需要改 build-core-helper.sh。
- 候选/发布：仅源码，无新候选。
- 剩余限制：helper 会话中途重启后没有属主，维持原行为；更新执行器进程内的 arm 不经 socket、不记属主；3 次阈值与属主消失判定（僵尸、pid 复用）需实机验证。helper 版本 4.52.6 → 4.52.7 并重算 CONTRACT.sha256（与同日其他 helper PR 撞号，后合者需再升一档）。退出清理超时后若 Core 仍在运行，此改动也会在约 30 秒后放行（macOS 无严格模式，符合放行优先）。
