| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| REL-ZOMBIE-UNIDENTIFIED | macOS 恢复互联网的进程检查把未回收的僵尸进程读成 unknown，并把本机任何一个可执行文件被删除/替换的进程当成「无法识别」，标记全部组件 busy，之后连接一直被拒 | fixed(fb67c3c2) | [#1691](https://github.com/raydocs/tono/pull/1691) | 高·实机 | 待实机：修复未在客户机上验证（需新签名版本）。root 进程、平台二进制、以及读不到用户 id 或签名状态的进程仍按无法识别处理；修复前已卡住的机器仍要再点一次「恢复正常网络」 |

一位客户的实机（macOS 26.6.2，0.0.77 build 78）：9 个僵尸进程与 17 个可执行文件已被替换的存活进程，连接在「准备安全组件」被拒。
僵尸：`ReleaseProcessTable.state` 用 `PROC_PIDTBSDINFO` arg=0，XNU `proc_pidinfo` 只在 arg 非零时回落到 `proc_find_zombref`，
僵尸因此返回 ESRCH，而 `kill(pid, 0)` 仍成功，落到 `.unknown`。
无法识别：`ReleaseChildren.end` 对 `proc_pidpath` 失败的任何进程都把全部组件记为 busy；开发机上升级了仍在运行的程序（CLI、代理软件）
都会命中。修复后，三个用户 id 都不是 root 且内核未标记为平台代码（`CS_PLATFORM_BINARY`，`csops` 读取）的进程不再算无法识别：
释放要结束的 pfctl、networksetup、route 与 shell 都是 sealed system volume 上的平台二进制，Tono 的写者都以 root 运行。
