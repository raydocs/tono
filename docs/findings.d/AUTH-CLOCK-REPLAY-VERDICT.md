| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| AUTH-CLOCK-REPLAY-VERDICT | A late obsolete bearer replay can permanently refuse a valid rotated session under clock skew | in-PR | [#990](https://github.com/raydocs/tono/pull/990) | 中·已确认 | P2: clock ahead of token lifetime plus overlapping requests; portable regressions only, native App verdict application remains CI/device evidence |

The current-identity check did not distinguish a replaced bearer from a refused current session. Suppress the obsolete replay's refusal only when a different accepted bearer is installed for the same identity, and return a per-request HTTP failure rather than `Unauthorized`, which catalog/policy callers use to suspend the account. Refresh refusals, current-token refusals, and a token slot cleared without an accepted successor remain authoritative. Ownership: SHIP_PLAN §2 item 10.
