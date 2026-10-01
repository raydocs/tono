| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W10 | Windows App 启动时 adopt() 先把 INCOMPLETE 置 true，更新请求失败时不清除：Service 因手动租约、更新存储打不开、修复锁被占或 App 镜像无法证明而拒绝更新请求时，没有进行中的更新也显示「更新恢复未完成」并拒绝退出 | open | 待开 | 中·推导（读码；未实机） | 本 PR（win-release-min）让已确认死亡的租约不再挡 Status：点一次 Restore internet 后标志按真实状态改写，但下次启动 adopt 仍被租约拒绝，横幅会再出现；其余原因照旧，且 Restore internet 的 Status 探测同样失败（BRICK-W5）。修法方向：只读的更新状态，不改「未知即未完成」 |

来源：计划审查 35f8b312/codex:F7（PLAN-win-release-paths rev 3）。很可能就是 7422 上的横幅（U5：以该客户 App 日志
`Protected update adoption not established: <reason>` 确认，A/tono/commands/restore.rs:112），未确认。
