| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-WAKE-RETIREMENT | Native update suspension leaves an old wake retry alive, which reconnects after explicit Disconnect and Retry retires the update | fixed(0bac2732) | Branch `hunt/sol-r3conn-update-wake-retirement` | 低·推导（P2） | Authored XCTest exercises actual wake and update-disconnect ownership; Swift unavailable on Linux, hosted macOS CI and real sleep/update acceptance required. No PF/DNS/AI policy or helper contract change. |

Baseline `7e5c333a`: `AppState+NativeUpdate.swift:36–38` excludes wake/sleep tasks; `AppState.swift:763–775` retries a reassert refused by the staged update gate; explicit update retirement clears connect gates at `AppState+NativeUpdate.swift:138–144`; the surviving wake reaches `AppState.swift:817` and starts a new connect. The staged-gate refusal follows update ownership, not an independent network failure. #991 addresses a different retained config-reload handle.
