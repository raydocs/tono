| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-ORPHAN-BOOTSTRAP-PF | App 在 `/core/start` 后、提交隧道 arm 前崩溃时，Core 仍在运行，看门狗每 10 秒重装 bootstrap 阻断，机器持续离线直到重开 Tono | fixed(262b1864) | [#773](https://github.com/raydocs/tono/pull/773) | 高·推导 | helper 中途重启无属主则不动作；3 次阈值与属主消失判定需实机 |

来源：连接流程为 arm（`tunnelInterfaces` 空）→ `/core/start` → 提交 arm（apps/macos/Tono/Services/AppState+Connect.swift），链式住宅代理下窗口可达数十秒。修复：`SocketServer` 内存记录 arm/start 的已认证对端（`LOCAL_PEERPID` + `PROC_PIDTBSDINFO` 启动时间，防 pid 复用），Core-running 分支里 bootstrap-only 且属主确实消失连续 3 次（约 30 秒）后 `core.stop()` + `disarm()` + 恢复 DNS；已提交会话与无属主场景不动作，不装阻断。回归：`KillSwitchManager.runSelfTests` 中 `SocketServer.orphanedBootstrapAction` 决策测试。PR #720 只覆盖 App 存活时的 arm 失败自愈。
