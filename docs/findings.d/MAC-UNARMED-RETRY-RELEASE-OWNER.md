| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UNARMED-RETRY-RELEASE-OWNER | Automatic unarmed retry survives explicit Restore internet and can reconnect/re-arm after the user's release | fixed(933e7414) | branch `hunt/sol-r3regm-unarmed-owner` | 中·推导 | P1; #720 regression; Swift/XCTest and installed-device retry/Restore behavior await macOS CI/hardware |

SHIP_PLAN §2 item 10. Baseline `61d8c985`: #720 introduced `unarmedReconnectTask`, but `ConnectionCoordinator.cancelReconnectTasks:161–171` never cancels it. `AppState+Connect.swift:2283–2307` sleeps then awaits TCP proof and calls Connect without rechecking its owner after that await. A user who restores normal internet while retry is sleeping/probing can therefore have an old retry reconnect and arm PF later. There is no second independent failure: the automatic retry follows an ordinary single connection failure, and the user then explicitly stops it.

The earlier `applyExhaustedArmedFailure:2266` status read can also schedule a new unarmed task after a newer Restore/Connect supersedes that release. The same protection generation now fences this boundary and both sides of TCP proof; explicit release cancels/retires the unarmed owner. No new teardown drain awaits the proof, so a pending read-only socket cannot delay Disconnect. Existing PF/DNS/AI-floor and strict dispositions are unchanged.

Two narrow XCTest behaviors exercise the real paths with helper I/O stubbed: successful proof arriving after explicit release cannot reach Connect admission; failure-status response arriving after a newer release cannot schedule a retry. Tests authored before the ownership fix; native execution is unavailable on this Linux VM and not claimed.
