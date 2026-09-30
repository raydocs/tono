| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W3 | Windows 卸载结果 StillProtected（exit 3）仍删除 SCM 注册与 ProgramData 里的 Service 二进制，NSIS 随后却说什么都没删 | open | 待开 | 中·已确认（读码，Codex+Opus 交叉核实） | 推迟到 PLAN-win-keep-service（草案）：保留 Service 之前须先保证留下的 Service 不会在没有屏障时重放 Core 运行意图（5d381aec/codex:F1；BRICK-W1 的恢复门已拒绝没有 wanted 屏障的重放，保留路径的回归仍待补），并须排在 PLAN-win-release-paths（PR-A）之后合入 |

来源：2026-09-28 砖机审计（origin/main `c0e7758e`），codex WINDOWS-3 = opus WIN-2。证据（行号为 `c0e7758e`）：
`service/src/bin/uninstall_service.rs:632-672`（阻塞结果照样删注册与二进制）、`installer.nsi:926-929`（「nothing was deleted」）。
同一个助手也从 `.onInstFailed` 与安装程序的全新安装路径运行。BRICK-W4 让「NRPT 规则删不掉」也走 exit 3，在本项修好前同样会删掉 Service；
开始菜单「恢复网络」快捷方式与重跑卸载程序不依赖 Service。
