| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UNARMED-TIMEOUT-OWNER | A timed-out Windows unarmed reconnect loses its sole automatic recovery owner | fixed(cf5ee0d7) | #1101; branch hunt/sol-r4fws-timeout-owner | 中·已确认（P2，Linux 回归） | Actual admission/transaction/timeout retirement/reconciliation/adoption regression fails before and passes after with native boundaries substituted; Windows/Tauri and laptop sleep acceptance remain unrun. General internet and AI hold were not lost by this defect. |

Full Connect retains its authoritative reconciled failure generation for the unarmed caller. Exact generation, ticket and account readiness are checked before continuing existing backoff. Numeric G+2 inference is never accepted; cancellation still wins.
