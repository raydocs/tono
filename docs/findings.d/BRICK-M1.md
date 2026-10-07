| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M1 | macOS helper 的更新执行器启动失败（`/Library` 或 `Application Support` 组/其他用户可写、账本读不出、账本 schema 更新）时不看 Kill Switch 意图就装紧急屏障，daemon 在建 socket 前退出、KeepAlive 反复重试，从没开保护的 Mac 每次开机都断网 | in-PR | [#679](https://github.com/raydocs/tono/pull/679)（第 1 部分）；本轮独立 PR 待编号 | 中·已确认 | #679 起：启动失败不新装屏障，改为按已保存意图尽力释放。本轮源码：正常 store 打不开时仅在安全的既有根目录下取得同一更新锁后读意图；普通安装对执行器已停止的 consumed blocked/断开请求放行，替换中的记录仍拒绝。仍未解决：紧急命令仍需 store（#691，需独立恢复架构）；更高 schema 的回滚构建仍无法读账本和启动（需跨版本迁移/恢复设计）；目录或锁不安全、锁无法建立时不能可信地读意图，须人工修复；托管 native XCTest/自测待验，未实机验证，未合并，不能标 fixed |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），codex MAC-1 = opus MAC-2，双厂商交叉复核。
续 TM-claude-2（helper 崩溃循环时修复是空操作）。
