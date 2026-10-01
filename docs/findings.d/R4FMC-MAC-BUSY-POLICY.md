| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FMC-MAC-BUSY-POLICY | macOS drops accepted DIRECT revocations while another runtime mutation owns the session | in-PR | #1114 | 中·已确认（P2） | Overlapping normal policy/runtime operations; Swift/XCTest and PF acceptance require macOS CI/hardware |

Baseline `64e8b593`: Catalog:664–681 installs the latest document, but AppState:1867–1875 returns at the busy shared-owner guard. Neither finishConfigReloadRequest nor switch completion retains a full-policy rebuild. A prior owner can commit its captured grants and no later owner removes them. Coalesce a full-document intent, give it priority over stale queued pins, and read the latest accepted policy at drain. Empty revocations are queued even when an in-flight owner has not yet committed its first plan. Disconnect/update retirement clears the intent. Existing selective failure release and AI admission remain unchanged.
