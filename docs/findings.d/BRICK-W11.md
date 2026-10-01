| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W11 | Windows kill-switch 意图保存（kill-switch.json）共用临时文件 kill-switch.tmp，atomic_file::replace 30 秒超时只放弃等待、不取消改名：报告超时的保存（如释放的 tombstone）之后仍可能落盘，覆盖后继连接写下的 wanted 意图，下次 Service 启动可能先移除 WFP 再按期望状态恢复后继 Core | in-PR | 本 PR（每次写入唯一 tmp + replace 后读回校验 + `intent_write_isolated_tmps_and_verified_commit` 回归） | 高·推导（前提窄：一次 ≥30 秒写盘停顿且期间有后继连接；未实机） | 唯一 tmp 消灭了 tmp 共享损坏；读回校验把“replace 前落下的陈旧提交”变成大声报错；读回之后落下的陈旧改名仍未覆盖（需停顿超过一整次后继写入）；其余模块同类写法未动；未实机 |

来源：计划审查 405b0455/codex:F2（PLAN-win-release-paths rev 3）。代码位置（main c0e7758e）：
apps/windows/service/src/core/windows_kill_switch.rs:380-399 与 2402-2419，apps/windows/service/src/core/atomic_file.rs:52-96。
