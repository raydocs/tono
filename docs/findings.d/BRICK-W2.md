| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W2 | Windows 卸载程序置 `$TonoManualMutated` 后、第一个改动之前中止（「Tono 正在运行」处取消或结束失败、卸载助手缺失），或清理未证实而中止，会留下手动租约；持有者退出后租约仍挡释放、更新 Disconnect 与修复，重启后 WFP 重新武装而 Core 恢复被跳过 | in-PR | [#681](https://github.com/raydocs/tono/pull/681)（Service 半边，已合 main `7a4b748d`）；[#680](https://github.com/raydocs/tono/pull/680)（NSIS 半边，PLAN-win-boot-uninstall） | 中·已确认（读码，Codex+Opus 交叉核实；未实机） | Service 半边（#681）：持有者确认死亡（PID 不存在或已退出，或同 PID 创建时间不同；读不到即视为活着）时，释放准入与 App 释放前的更新 Status 探测放行；连接、其余更新请求、修复与启动恢复仍被挡，Service 不清除租约，要等下一次安装或卸载程序替换。NSIS 半边（#680）：`$TonoManualMutated` 挪到 `RemoveVergeService` 之前；`RemoveVergeService` 的两个卸载程序 `Abort` 之前、`un.onUninstFailed` 与 `un.onGUIEnd` 都先调用 `un.HandBackManualLease`（最多 3 次、间隔 1 秒，只认退出码 0）。仍剩：卸载程序被杀、或 3 次交还都失败时租约照旧留下；GUI 模式下「Tono 正在运行」处取消或结束失败后，失败页关闭前租约仍被持有（38c453fa/codex:F1）；未实机验证（D2） |

来源：2026-09-28 砖机审计（origin/main `c0e7758e`），codex WINDOWS-4，Opus 核实时扩大到清理未证实的中止；2026-09-29 Windows 变砖排查。证据（行号为 `c0e7758e`）：
`installer.nsi:1564,1569,1573`（置位早于 `CheckIfAppIsRunning`）、`:889-891,926-929`（两个 `Abort`）、`:1779-1784`（`un.onGUIEnd` 只在未改动时交还）；
`service/src/core/update.rs:45-76,1334-1338`（租约挡释放与启动恢复）。方向：Service 半边按 PLAN-win-release-min rev 2 §2.2，NSIS 半边按
PLAN-win-boot-uninstall 第 3 版 §1.3。

先合入的 PR 建这个分片，另一个只改自己那一半（PLAN-win-boot-uninstall Q22）；两个 PR 各建了一份，合并时并成这一行。
`CheckIfAppIsRunning` 是 Tauri 的宏，它的 `Abort` 前插不进交还；要在失败页出现前交还，得复制并改写这个宏，#680 没做。
相关且未改：WIN-UNINST-LEASE-WINDOW、TW-anthropic-6。
