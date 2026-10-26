| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-RETIRE-CLAIMS-PROTECTED | PF 已确认放行、只是更新记录没收好时，提示仍说网络保护还在 | in-PR | fix/t7-update-prep | 高·已确认 | 句子改为普通网络已经恢复、记录没有收好。XCTest 已写，本机未跑 xcodebuild，未上真机 |

`retireDisconnectedNativeUpdate` 在 `disconnectVerified == true` 之后先清 `KillSwitchService.isArmed` 和 `isProtectionBlocked`，再因 `retired.pending` 抛出 `retirementUnconfirmed`。旧句 “Network protection is still on.” 与已发布的放行相反。
