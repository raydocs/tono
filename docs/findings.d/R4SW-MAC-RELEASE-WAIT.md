| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4SW-MAC-RELEASE-WAIT | macOS 自动释放超过首次两秒重试延迟时，unarmed recovery owner 永久退出 | in-PR | #1086 | 中·已确认 | P2; queued-teardown XCTest requires hosted macOS CI |

The automatic release queues Core/DNS/PF cleanup, then starts a distinct unarmed task. The old task slept two seconds and returned permanently if `isDisconnecting` remained true; normal bounded helper work can exceed that delay. Await the serialized disconnect queue inside the distinct retry task, then apply the existing cancellation/generation/update/barrier checks. The failing connect/monitor caller must never perform this wait because teardown drains that caller. One regression holds a queued release for three seconds and requires one subsequent proof from the original retry owner.
