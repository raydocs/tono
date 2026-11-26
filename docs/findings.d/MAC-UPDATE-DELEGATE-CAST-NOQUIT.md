| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-DELEGATE-CAST-NOQUIT | SwiftUI `@NSApplicationDelegateAdaptor` 下 `NSApp.delegate as? AppDelegate` 恒为 `nil`，导致原生更新消费后旧 App 永不退出并 100% 触发 30 秒超时，且语言切换重启绕过 `terminateForRelaunch()` | in-PR | fix/macos-update-quit-and-ai-hold | 高·更新 | 待 hosted ci-gate 与新版本真机升级实测 |

本机 0.0.77 → 0.0.86 实测中 `16:59:18` 更新消费后无任何 `applicationShouldTerminate` 日志，直至 `17:45:22` 手动退出。修复点：`AppDelegate.current` / `AppDelegate.resolve`、`TonoApp` 传入 `appDelegate`、`AppUpdater` 与 `AppSettings.relaunch()`。
