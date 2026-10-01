| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-APP-FAILURE-AI-HOLD | Exhausted automatic macOS recovery used explicit Disconnect and removed the secondary AI hold | in-PR | 本 PR | 高·推导（P1） | Source path and regression authored; Swift/XCTest and installed PF/DNS behavior require macOS CI and hardware. Existing selective-layer best-effort limitations remain. |

Baseline `3853f5ec`: `AppState+Connect.swift:2259` calls `disconnect(releaseKillSwitch: true)` after an armed failure. The teardown invokes `NetworkProtectionOperations.disarm`, which reaches `/killswitch/disarm`; `KillSwitchManager.swift:585` removes the AI resolver sinkholes and Claude blackhole routes after releasing PF. Saved intent is deleted, so the watchdog cannot restore this floor later. A single ordinary exhausted connection/health failure triggers the path.

The fix gives this automatic caller a distinct authenticated `/killswitch/release` request. It reuses the normal PF release and applies the existing narrow layer after successful release while holding the arm lock. Explicit Disconnect/Restore retains `/killswitch/disarm`. The shared strict disposition remains unchanged. Decisions 030/031/036 support selective automatic release; no new product decision is needed.

`ArmedFailureReleaseTests.testExhaustedArmedFailureReleasesGeneralTrafficAndKeepsAIHold` exercises the actual exhausted-failure and serialized disconnect path with injected helper I/O. Baseline calls explicit disarm, producing zero automatic releases and no AI hold; the updated assertions require one automatic release and zero explicit disarms. Native failing/passing execution cannot be performed in this Linux VM and is not claimed.
