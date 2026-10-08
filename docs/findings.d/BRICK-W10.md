| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W10 | Windows App 启动时 adopt() 先把 INCOMPLETE 置 true，更新请求失败时不清除：Service 因手动租约、更新存储打不开、修复锁被占或 App 镜像无法证明而拒绝更新请求时，没有进行中的更新也显示「更新恢复未完成」并拒绝退出 | fixed(e5b5eda10) | [#1448](https://github.com/raydocs/tono/pull/1448) | 中·推导（读码；未实机） | #1448：启动 Adopt 被拒后读 `/status` 的只读 `update_attempt_pending`（无租约、锁或 DACL 写），只有确定「无挂起尝试」才清 INCOMPLETE；读不出或旧 Service 仍为未完成。仍开：活的手动安装租约照旧挡 Adopt 本身与 Restore internet 的 Status 探测（BRICK-W5）；状态轮询不改写 INCOMPLETE；Service 的状态缓存在一次在途 Prepare 期间仍报它之前的值，另一 App 进程的 Adopt 若在客户端超时后读到旧的「无挂起」会清掉标志（评审 577bf35c opus:F1，minor，窄窗口）；未实机 |

来源：计划审查 35f8b312/codex:F7（PLAN-win-release-paths rev 3）。很可能就是 7422 上的横幅（U5：以该客户 App 日志
`Protected update adoption not established: <reason>` 确认，A/tono/commands/restore.rs:112），未确认。
