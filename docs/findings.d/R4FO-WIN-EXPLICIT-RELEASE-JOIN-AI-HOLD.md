| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FO-WIN-EXPLICIT-RELEASE-JOIN-AI-HOLD | Windows User Disconnect loses remove-AI intent when joining an automatic AI-held release | fixed(6ba79f61) | #1109; hunt/sol-r4fws-disconnect-intent | 中·已确认（P2，Linux 协调器回归） | Actual release coordinator/slot regression fails before and passes after; full Windows/Tauri and WFP/NRPT acceptance require CI/hardware. A slow two-step release may exceed the existing UI wait while detached reconciliation continues; native removal can still fail and must report failure. |

One shared release retains the final AI disposition. Explicit removal dominates automatic retention; an already-dispatched narrow release is followed by ordered plain cleanup under the same writer before completion/admission. Slot registration and successful sealing share one mutex, and session metadata finalizes once.
