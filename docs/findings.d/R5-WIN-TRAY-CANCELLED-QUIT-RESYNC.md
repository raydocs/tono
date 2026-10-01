| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R5-WIN-TRAY-CANCELLED-QUIT-RESYNC | Windows 托盘菜单「退出」和托盘弹出面板「退出」丢弃 `feat::quit()` 的 Canceled 结果，不调用 `resync_after_cancelled_quit`：`quit_release` 已停掉的目录/策略周期同步一直不恢复，Service 真值也不回读 | in-PR | 本 PR（branch `claude/r5-win-tray-quit-resync`） | 中·已确认（P2，读码） | 托盘是 Windows 上主要的退出入口（关窗只隐藏）。#784 只补了窗口关闭请求和重启两处。新增一个 tokio 回归测纯 helper；托盘点击本身需实机 |

源码：`core/tray/mod.rs:757`、`core/tray/flyout.rs:185` 直接 `feat::quit().await` 并丢弃结果；`lib.rs` 的 ExitRequested 路径与 `restart_app` 已在取消时调用重同步。修复：三处退出入口统一走 `feat::quit_or_resync()`。
