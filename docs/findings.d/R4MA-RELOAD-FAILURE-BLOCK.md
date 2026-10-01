| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4MA-RELOAD-FAILURE-BLOCK | A failed full macOS config reload stops Core but retains bootstrap PF and dead-loopback DNS throughout protected retries | in-PR | hunt/sol-r4ma-reload-failure-release | 高·推导（P1） | Authored XCTest exercises the real reload catch through injected helper operations; Swift is unavailable on Linux. Native CI and PF/DNS hardware acceptance remain required. Existing release errors and pending-update recovery covered by #1099 remain outside this fix. |

Baseline `64e8b593`: a connected catalog credential/home-route rotation calls
`AppState+Catalog.swift:415` → `reloadCoreConfig`. One helper replacement or
controller reload error takes `AppState+Proxy.swift:718–724`: stop Core,
preserve system DNS, restrict PF to bootstrap, and retry while the user's
ordinary network is blocked. A fresh Core start resets the helper's roughly
30-second Core-down watchdog, so that watchdog cannot keep internet available
through the retry transaction. This is distinct from #966's policy-specific
apply and #950's pins-only precommit keep-session path.

The full reload catch now uses the existing exhausted-failure owner, which
restores DNS, selectively releases PF with the AI hold, then schedules only
an unarmed TCP proof with existing backoff before another connection. macOS
has no strict toggle; the shared strict disposition is unchanged.
