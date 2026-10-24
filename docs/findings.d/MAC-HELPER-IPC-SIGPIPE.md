| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HELPER-IPC-SIGPIPE | helper 对端提前关闭时 App 的 socket write 可触发 SIGPIPE 退出并遗留保护 | in-PR | fix/t4-macos | 高·已确认（P1，socket 选项回归） | 待 CI、helper bootout 与安装真机；不宣称 PF 已恢复 |

证据：`apps/macos/Tono/Core/HelperManager.swift:1816-1828,1900-1912`；
启动后备 `apps/macos/Tono/App/AppDelegate.swift:33-36`。
RED/GREEN 及范围见 [T4 记录](../reports/T4_MACOS_2026-10-24.md)。
