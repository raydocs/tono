| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4MA-PIN-REFRESH-REVOKE | An old macOS DNS pin refresh can reinstall withdrawn DIRECT authority after a newer accepted policy successfully applies | fixed(e018c115) | hunt/sol-r4ma-pin-refresh-freshness | 中·推导（P2） | Requires an ordinary policy update during asynchronous DNS resolution. Suspended-resolver XCTest authored; Swift unavailable on Linux. Native CI and DIRECT/PF hardware acceptance remain required. No AI suffix bypass or arbitrary authorization is claimed. |

On `ad8ab2cd`, `AppState+Catalog.swift:898–906` captures the active plan and
resolves the old document. The wait owns no config mutation handle. A newer
empty document can therefore apply successfully and commit
`activeDirectPolicy=nil` in `AppState.swift:2030`. The old DNS reply passes
only connected/busy checks at Catalog `:907–909`, merges the captured native
and trust metadata at `:1030–1038`, and schedules `reloadCoreConfig`, which
commits the stale plan at `AppState+Proxy.swift:598`.

This differs from #1114: the newer policy applies successfully here. The fix
requires unchanged policy, committed plan and protection generation after
resolution. Stale replies cannot reach PF or the runtime writer.
