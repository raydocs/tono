| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CORE-WATCHDOG-ORPHAN | Windows Service：Core 退出后 watchdog 正在退避等待重启（PID 已为 0）时再次 StartCore，只替换 watchdog 的 shutdown sender 而不 join 旧 watchdog；旧 watchdog 醒来后的清理会清掉新 Core 的身份/PID/运行记录，或先再起一个 Core | in-PR | 分支 `amp/win-core-watchdog-orphan`（草稿 PR） | 中·推导 | 修复：启动前把「正在恢复的 watchdog」与运行中的 Core 一样先停掉并 join。仅源码推导与 Linux 无关测试设计；Service cargo 只在托管 Windows CI 跑；需 Sol 高风险终审；不进 0.0.75 |
