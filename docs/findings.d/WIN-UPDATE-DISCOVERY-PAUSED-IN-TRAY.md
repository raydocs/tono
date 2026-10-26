| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-DISCOVERY-PAUSED-IN-TRAY | 窗口藏在托盘里时更新检查停摆，托盘也不显示有新版本 | in-PR | fix/t7-update-prep | 中·已确认 | 隐藏窗口继续轮询。托盘给出「现在更新 / 稍后」；稍后藏起这一份 24 小时。现在更新打开主窗口的更新对话框。未在真机托盘上点过 |

`use-update.ts` 的 `refetchIntervalInBackground` 原来是 false。Sea 托盘在出现这行时收起快捷节点，避免 232px 飞出层把页脚挤出去。
