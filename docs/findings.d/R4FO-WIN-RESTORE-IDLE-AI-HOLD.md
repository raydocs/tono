| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FO-WIN-RESTORE-IDLE-AI-HOLD | Startup Restore Internet returns success from an idle FSM without removing the secondary AI hold left by automatic recovery | fixed(147dfb33) | hunt/sol-r4fo-idle-restore-ai-hold (this PR) | 低·已确认（P2） | Exact production dispatch gate and regression failed then passed on Linux; full Tauri/Service and native firewall/NRPT removal require Windows CI/hardware; different-disposition live join remains #1109 |

The account-restoring screen offers Restore after eight seconds even when broad protection is proven absent. The secondary hold is separate from that status. `disconnect_for_generation` previously skipped all idle releases; it now permits that skip only for generation-scoped automatic failed-Prepare recovery. Explicit user cleanup reaches the existing authenticated, owner-gated Service release, which already removes a narrow hold when broad WFP is absent.
