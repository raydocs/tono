| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-EXPIRY-LIVE-CORE | Committed DIRECT expiry removes Tono WFP while the Service-owned Core retains TUN routes, its strict-route filters and DNS interception | in-PR | Branch `hunt/sol-r4ks-watchdog-core-retirement` | 中·已确认（P1，Linux state regression） | Native Windows TUN/WFP/DNS acceptance unrun; existing owner-retirement failures and best-effort selective-layer limits remain. |

Baseline `7f382af7`. The committed-expiry path now queues the existing epoch-fenced owner lifecycle worker after its exact Blocked transition. That worker stops Core, retires runnable owner intent, then completes selective fallback. Late Lock/MarkVerified cannot revive the expiring session; a new arm revokes the queued predecessor. Strict and incomplete DIRECT phases keep their existing behavior.

The actual watchdog regression `committed_direct_expiry_retires_core_before_selective_fallback` failed before the fix, then passed with Core identity absent, desired run state false, active owner retired and the AI hold active. It uses the portable engine and published Core-identity fixture, not native packet reproduction. Pinned Core code retains an independent strict-route engine until Core exits; provider-scoped Tono removal cannot retire that engine.
