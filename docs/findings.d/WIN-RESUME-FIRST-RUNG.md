| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RESUME-FIRST-RUNG | Windows 传统已证明启动恢复先等退避首档 2 秒再连接 | in-PR | [#1395](https://github.com/raydocs/tono/pull/1395) | 低·推导 | 只改传统已证明启动恢复的首次等待，首档仍计入阶梯与预算；收益主要是界面和替换等待（保留 Core 时流量仍走旧 Core），未实测；回归 `proven_startup_resume_skips_the_first_rung` 未在本机运行 |

Codex 核验 PARTIAL：不是每次更新或重启都多等 4.9 秒。记录于 #1386。

2026-10-05 三轮：#1395 修复，见 [changelog](../changelog.d/2026-10-05-connection-audit-fixes-r2.md)。
