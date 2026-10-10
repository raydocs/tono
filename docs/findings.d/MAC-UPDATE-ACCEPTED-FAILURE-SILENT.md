| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-ACCEPTED-FAILURE-SILENT | macOS 后台自动检查弹出更新提示、用户点「安装并重启」后，安装包下载失败（如直连与两个中继都不通）时没有任何提示：`AppUpdater.check` 只在 `userInitiated` 或 `nativeUpdatePending` 时报错，而后者要到 `installNativeUpdate` 里才置位，用户的点击无回应 | in-PR | 待开（分支 `amp/cn5-updater-accepted-failure`） | 低·已确认 | 修复：用户接受更新提示后的失败一律弹出「更新未完成」并写入 errorMessage（`AppUpdater.reportsFailure`）；没被用户看到的后台检查仍静默。待实机 |
