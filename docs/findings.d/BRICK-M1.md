| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M1 | macOS helper 的更新执行器启动失败（`/Library` 或 `Application Support` 组/其他用户可写、账本读不出、账本 schema 更新）时不看 Kill Switch 意图就装紧急屏障，daemon 在建 socket 前退出、KeepAlive 反复重试，从没开保护的 Mac 每次开机都断网 | open | [#679](https://github.com/raydocs/tono/pull/679)（第 1 部分） | 中·已确认 | #679 起：store 打开时在更新锁内读意图。本分支起：启动失败不再装屏障，无论意图是否保存；启动失败改为尽力释放已保存的杀开关。仍未解决：紧急命令仍需 store（#691）；安装守卫未改；更高 schema 的回滚构建仍无法启动；store 打不开时读意图不在锁内；未实机验证 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），codex MAC-1 = opus MAC-2，双厂商交叉复核。
续 TM-claude-2（helper 崩溃循环时修复是空操作）。
