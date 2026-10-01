| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PAUSED-OPEN-STATUS | macOS 第三次 PF 被他人替换（supervisor repair）时先自动释放网络、再设「重试暂停」，菜单栏只看暂停标志，在已放开的网络上显示「Protected Offline · retries paused」 | in-PR | 本 PR | 低·推导（P2，UI 投影） | 只改菜单栏投影：暂停分支要求 `isProtectionBlocked`。Dashboard/MenuBarView 的按钮本来就以 `isProtectionBlocked` 为前提。XCTest 只在 hosted CI 运行 |
