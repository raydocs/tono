| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-RETIRE-STALE-PROTECTION | macOS 原生更新重试已获 helper 验证释放 PF，退役归档失败或仍 pending 时 App 跳过本地释放状态清理，继续显示 Protected Offline 并保留 armed 意图 | fixed(a8da7f1a) | #785 | 高·推导 | 已将释放显示与旧重连历史清理前移，更新 pending 和 Core 清理标记仍等退役成功；新增一个 XCTest，未编译/运行，待托管 macOS CI；未实机；helper 的 Core/DNS 证明语义与既有 suspend/retire 并发问题未改 |

来源：main `ff04bae0`；分支 `codex2/mac-update-retire-state`；源码推导确认 `retireDisconnectedNativeUpdate()` 在已验证 Disconnect 后仍先等待 `retire`，失败即跳过释放显示；调用方只更新错误提示。修复与验证边界见 [更新记录](../changelog.d/2026-09-30-macos-update-retire-state.md)。
