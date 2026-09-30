| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M1 | macOS helper 的更新执行器启动失败（`/Library` 或 `Application Support` 组/其他用户可写、账本读不出、账本 schema 更新）时不看 Kill Switch 意图就装紧急屏障，daemon 在建 socket 前退出、KeepAlive 反复重试，从没开保护的 Mac 每次开机都断网 | open | [#679](https://github.com/raydocs/tono/pull/679)（第 1 部分）；管理员恢复源码待 PR | 中·已确认 | 第 1 部分按保存意图决定启动屏障。本轮源码为损坏/较新 schema 账本增加独立 root `--emergency-disarm`，不读写更新证据；仅在 Core/TUN/DNS 安全、持有独立恢复租约且 launchd owner 隔离后释放 Tono PF，并保留持久停机标记。尚未经 hosted CI/实机验证；不修复自动启动、安装守卫、回滚构建、更高 schema 的正常 daemon 启动或不安全的 Tono 共享目录。 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），codex MAC-1 = opus MAC-2，双厂商交叉复核。
续 TM-claude-2（helper 崩溃循环时修复是空操作）。
