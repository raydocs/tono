| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-MANUAL-DMG-RETIRE-DEADLOCK | 客户在存在挂起更新时手动拖入新签名 DMG 覆盖 `/Applications/Tono.app`，导致 `retireResolved` / `retireUnconsumed` 因 `originalComponents` 不匹配永远拒绝退役并阻断 helper 修复 | in-PR | fix/macos-update-recovery-and-policy-diag | 高·更新 | 待 hosted `macos / privileged-tests` 与新包真机实测；不放宽降级或 root 二进制漂移校验 |

修复点：`UpdateTransaction.retirementComponentsMatch` 在已验证显式 Disconnect 且 `observe() == .unprotected` 下，允许 root `core`/`helper` 哈希未变且签名封装序号 `installedFloor() >= manifest.releaseSequence` 的新 App 退役归档旧记录，不降 `highWater`。
