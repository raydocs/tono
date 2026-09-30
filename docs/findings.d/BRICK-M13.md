| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M13 | macOS helper 启动在更新存储上失败且 `tono.allowed-uid` 不可读时，即使 `killswitch.state` 存在，`armEmergencyBlock` 也静默跳过紧急屏障，随后 daemon 退出（`UpdateExecutor.swift:78`，`main.swift:1455-1456`） | in-PR | [#708](https://github.com/raydocs/tono/pull/708) | 中·已确认 | 按现行产品规则，读不到 uid 时不装屏障。默认失败动作改为释放已保存的杀开关，不需要 uid。不另造无 uid 的全阻断。未实机 |

来源：PR #679 三家评审 28a99ca5，opus F1 由 codex 确认为 minor，codex F1 由 opus 降为 minor；按停止规则记为 open。
