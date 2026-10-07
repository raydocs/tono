| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W3 | Windows 卸载结果 StillProtected（exit 3）仍删除 SCM 注册与 ProgramData 里的 Service 二进制，NSIS 随后却说什么都没删 | in-PR | [#1438](https://github.com/raydocs/tono/pull/1438) | 中·已确认（读码，Codex+Opus 交叉核实） | 修复：先定结果（含 NRPT 清扫证明）再删，StillProtected 时 Service 注册、二进制与恢复文件都保留；NSIS 文字如实说明保护可能仍在、Service 已保留及释放方法。保留的 Service 开机不重放 Core：`desired.rs` 的开机会话门与 wanted 屏障门（BRICK-W1）。仍剩：未实机验证；nsExec 超时若落在删除过程中，Service 可能只删了一部分 |

来源：2026-09-28 砖机审计（origin/main `c0e7758e`），codex WINDOWS-3 = opus WIN-2。证据（行号为 `c0e7758e`）：
`service/src/bin/uninstall_service.rs:632-672`（阻塞结果照样删注册与二进制）、`installer.nsi:926-929`（「nothing was deleted」）。
同一个助手也从 `.onInstFailed` 与安装程序的全新安装路径运行。BRICK-W4 让「NRPT 规则删不掉」也走 exit 3，在本项修好前同样会删掉 Service；
开始菜单「恢复网络」快捷方式与重跑卸载程序不依赖 Service。
