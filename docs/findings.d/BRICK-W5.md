| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W5 | Windows Service 能应答却拒绝释放（手动租约、更新存储打不开或被锁、保护属于另一用户），或 Service 已停止（修复被 manual_gate 拒绝）时，产品内没有释放网络的路径 | open | #681 | 中·推导（跨厂商核实，读码；未实机） | 本 PR 修了：(d) 释放准入只读更新存储 updates-v1，对它不取锁、不重写、不重设 ACL（准入之前共用的修复锁仍准备 ProgramData\Tono 与 bin、可能重设其 ACL 并创建 .repair.lock；#681 时失败即拒绝并报真实错误，#1437 起 Release 见下）；(e) 已注册但停止的 Service 由释放路径以 --start-registered 原样启动（经 Run State 操作槽，一次 UAC），不经 manual_gate；注册或二进制校验不过时退回原修复路径（多一次 UAC；有过滤器时仍被 manual_gate 拒绝）；BRICK-W2 的 Service 半边（含 Status 探测）。ProgramData\Tono 或 bin 的 ACL 写入失败时 Disconnect 被拒（#681 评审 opus:F1，R681-release-gate-writes）由 [#1437](https://github.com/raydocs/tono/pull/1437) 修复（已合 main `5f4ae256`，2026-10-10 A15 核对）（取锁失败时 Release 改用不写的已有锁探测，被持有仍拒绝，探测也失败才不带锁继续，仍经只读准入）。仍未修：管理员释放路由与 App 内管理员操作（a、b）、另一用户已登出时的释放（c）、App 启动时 INCOMPLETE 因租约以外原因（存储写不开或被锁、修复锁、App 镜像无法证明）置位后 Restore internet 仍停在 Status 探测（见 BRICK-W10、PLAN-win-admin-release）；未实机 |

来源：2026-09-29 Windows 变砖排查（E3；codex WINDOWS-5/6/7；opus WIN-5），计划 PLAN-win-release-min rev 2（Jev-Decision 70500e68，计划审查 00600860 → 2640cced）。
H2-F2 保持不变：`authorize_write_for` 未改，没有跨用户释放；(a)(b)(c) 留给 PLAN-win-admin-release。
