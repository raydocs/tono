# R3-M10gap: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 23:23 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 991 | hunt/sol-r3mac-update-reload-retirement | needs-hardware | yes | fix(macos): retire cancelled config reloads during update suspension |
| 993 | hunt/sol-r3mac-update-metadata-deadline | needs-hardware | yes | fix(macos): bound native update metadata transfer duration |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| M10-H01 | macOS legacy update | — | UpdatePreparation.swift:21 | Crash after creating app journal strands PF | false-positive dormant legacy preparation has no production caller |
| M10-H02 | macOS legacy update | — | UpdateHandoffJournal.swift:234 | Expired or corrupt journal blocks launch/update forever | false-positive journal controls warning only; helper receipt gates native updates |
| M10-H03 | macOS legacy update | — | UpdateHandoffJournal.swift:206 | Illegal migration transition poisons recovery | false-positive refused transitions preserve phase; migration test-only |
| M10-H04 | macOS legacy update | — | UpdateHandoffJournal.swift:326 | Journal rename without directory sync loses recovery authority | false-positive diagnostic legacy journal grants no native authority |
| M10-H05 | macOS legacy update | — | UpdateHandoffJournal.swift:280 | Startup retires failed native recovery based on version alone | false-positive archive-before-remove is deliberate legacy cleanup; native receipt unaffected |
| M10-H06 | macOS legacy update | — | UpdatePreparation.swift:21 | Failed persistence stops healthy connection monitors | false-positive writePrepared and next phase write precede quiesce |
| M10-H07 | macOS native update | P3 | AppState+NativeUpdate.swift:134 | Retirement error retains released protection display | duplicate of #785 |
| M10-H08 | macOS native update | P2 | RuntimeCleanup.swift:217 | Protected Offline successor cannot commit | duplicate of #795 |
| M10-H09 | macOS native update | P2 | AppState+NativeUpdate.swift:9 | Monitor releases PF during staging before suspension | duplicate of #891 |
| M10-H10 | macOS update download | — | NativeUpdateDownload.swift:40 | Untrusted artifact size traps UInt64 to Int64 conversion | false-positive decoded manifest limits artifact to 4GB; helper verifies offer before package |
| M10-H11 | macOS update download | — | NativeUpdateDownload.swift:84 | Partial package treated as complete | false-positive exact file-size check and independent helper SHA256/private-copy validation |
| M10-H12 | macOS update download | — | NativeUpdateDownload.swift:74 | Redirected package accepted from different origin | false-positive redirect refused and final response URL checked |
| M10-H13 | macOS subscription | — | AppState+Subscriptions.swift:23 | URL parsing edge cases crash customer launch | false-positive URL validation follows developer-profile guards |
| M10-H14 | macOS subscription | — | App/AppDelegate.swift:181 | Deep-link import bypasses subscription guards | false-positive production rejects legacy config import before parsing |
| M10-H15 | macOS subscription | — | SubscriptionManager.swift:526 | Huge traffic-name conversion can trap | false-positive for customer scope; only isolated developer subscription path reaches conversion |
| M10-H16 | macOS subscription | — | SubscriptionManager.swift:23 | Traffic counter display overflow | false-positive no consumers of usedBytes or usageRatio |
| M10-H17 | macOS subscription URL | — | SubscriptionManager.swift:180 | Private or abbreviated IP evades URL policy | false-positive literals blocked and DNS answers classified then curl address pinned; developer-only path |
| M10-H18 | macOS subscription | — | SubscriptionManager.swift:291 | Partial or oversized download accepted | false-positive body capped at 5MiB and successful curl exit required |
| M10-H19 | macOS subscription | — | AppState+Persistence.swift:74 | Old subscription files influence production runtime | false-positive customer launch never loads subscriptions and clears state |
| MAC-UPDATE-CANCELLED-RELOAD | macOS native update | P2 | AppState+NativeUpdate.swift:34 | Cancelled reload handle survives failed update retirement | real-fixed #991 |
| M10-H20 | macOS update download | — | NativeUpdateDownload.swift:16 | Truncated metadata authorizes installation | false-positive canonical decode and signed-offer verification reject it |
| M10-H21 | macOS update download | — | NativeUpdateDownload.swift:62 | Completion callback races unregistered continuation | false-positive continuation registration precedes task start and default delegate queue serializes callbacks |
| M10-H22 | macOS update download | — | NativeUpdateDownload.swift:64 | Cancelled download waits indefinitely | false-positive current callers expose no cancellation source; package resource deadline is 900 seconds |
| M10-H23 | macOS native update | — | App/AppDelegate.swift:315 | Quit during download leaves persistent network loss | false-positive no single-failure path proved; helper watchdog releases dead-core state and applies selective AI layer |
| M10-H24 | macOS update download | — | NativeUpdateDownload.swift:88 | Crash leaves temporary package reused as complete | false-positive orphan temporary path is never reused; no immediate reliability failure proved |
| MAC-UPDATE-METADATA-DEADLINE | macOS update download | P2 | NativeUpdateDownload.swift:23 | Trickling metadata holds the update-check gate for days | real-fixed #993 |
| M10-H25 | macOS native update | — | AppState+NativeUpdate.swift:17 | Preparation failure leaves ordinary internet blocked indefinitely | false-positive helper stopped-core watchdog disarms and applies selective AI layer after threshold |
