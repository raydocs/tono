| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W2 | Windows 卸载程序置 `$TonoManualMutated` 后、第一个改动之前中止（「Tono 正在运行」处取消或结束失败、卸载助手缺失），或清理未证实而中止，会留下手动租约；持有者退出后租约仍挡释放、更新 Disconnect 与修复，重启后 WFP 重新武装而 Core 恢复被跳过 | in-PR | [#680](https://github.com/raydocs/tono/pull/680)（NSIS 半边）；PLAN-win-release-paths 的 PR（Service 半边） | 中·已确认（读码，Codex+Opus 交叉核实） | NSIS 半边：`$TonoManualMutated` 挪到 `RemoveVergeService` 之前；`RemoveVergeService` 的两个卸载程序 `Abort` 之前、`un.onUninstFailed` 与 `un.onGUIEnd` 都先调用 `un.HandBackManualLease`（最多 3 次、间隔 1 秒，只认退出码 0）。仍剩：卸载程序被杀、或 3 次交还都失败时租约照旧留下；GUI 模式下「Tono 正在运行」处取消或结束失败后，失败页关闭前租约仍被持有（38c453fa/codex:F1）；Service 半边（持有者确认死亡时放行释放）见另一 PR；未实机验证（D2） |

来源：2026-09-28 砖机审计（origin/main `c0e7758e`），codex WINDOWS-4，Opus 核实时扩大到清理未证实的中止。证据（行号为 `c0e7758e`）：
`installer.nsi:1564,1569,1573`（置位早于 `CheckIfAppIsRunning`）、`:889-891,926-929`（两个 `Abort`）、`:1779-1784`（`un.onGUIEnd` 只在未改动时交还）；
`service/src/core/update.rs:45-76,1334-1338`（租约挡释放与启动恢复）。方向：PLAN-win-boot-uninstall 第 3 版 §1.3。

先合入的 PR 建这个分片，另一个只改自己那一半（PLAN-win-boot-uninstall Q22）。
`CheckIfAppIsRunning` 是 Tauri 的宏，它的 `Abort` 前插不进交还；要在失败页出现前交还，得复制并改写这个宏，本 PR 没做。
