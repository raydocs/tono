| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CATALOG-VANISH-AI-HOLD | Automatic Windows recovery after a selected catalog exit vanishes uses full user release and removes the secondary AI hold | in-PR | hunt/sol-r3acct-catalog-ai-hold | 高·已确认（P1，Linux dispatch regression） | Windows App compilation and installed WFP/NRPT behavior require CI/hardware; the existing narrow layer retains its documented DNS/cache limitations. |

Follow-up to #791, whose baseline preceded the secondary AI layer. On main `0b1521be`, `catalog_sync.rs:341–345` detects the selected exit disappearing during Connected/Connecting; `connection/switch.rs:62` transfers automatic teardown to `release_explicit_with_guard`, whose `apply_narrow=false` removes the secondary layer. This is an ordinary catalog refresh, not an explicit user Restore. The fix selects the existing narrow release while transferring the same lifecycle writer. Strict catalog teardown stays on its existing keep-blocking branch.

One production dispatch regression fails with the original full-release intent and passes with narrow intent; it also proves writer ownership survives the transfer and ordinary internet is released. Local execution extracts that exact generic production function and test into a portable harness; it does not claim native Windows App or WFP execution.
