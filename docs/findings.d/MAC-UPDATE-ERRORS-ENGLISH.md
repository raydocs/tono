| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-ERRORS-ENGLISH | macOS 更新失败把 helper 英文原句直接弹给用户，按钮是 Install and Restart / Not Now | in-PR | fix/t7-update-prep | 中·已确认 | 人话进 `NativeUpdateDownload.Copy`，中文在 Localizable.xcstrings；诊断只进日志。未跑 xcodebuild，未上真机 |

`AppUpdater.swift` 的待处理更新和 `AppState+NativeUpdate.swift` 的断网确认、重试、收尾、校验、安装许可、是否装上都改走同一组句子。按钮为「现在更新 / 稍后」。
