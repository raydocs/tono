#993’s optional body update failed twice due to `gh pr edit` querying deprecated Projects classic fields. Source is already pushed and the PR is open. Branch: `hunt/sol-r3mac-update-metadata-deadline`; title: “fix(macos): bound native update metadata transfer duration”; [corrected body](/workspace/w1-codex/out/R3-M10gap/metadata-pr-body.md).

Two verified P2 bugs were fixed in PRs. No new P0/P1 was verified.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| MAC-UPDATE-CANCELLED-RELOAD | Update suspension | P2 | AppState+NativeUpdate.swift:34 | Cancelled reload handle blocks later switching, reloads and monitoring | Fixed in #991; CI pending |
| MAC-UPDATE-METADATA-DEADLINE | Update download | P2 | NativeUpdateDownload.swift:23 | Trickling metadata holds the update-check gate for days | Fixed in #993; CI pending |
| M10-H01 | Legacy update | — | UpdatePreparation.swift:21 | Crash after journal creation strands PF | False positive: no production caller |
| M10-H02 | Legacy update | — | UpdateHandoffJournal.swift:234 | Stale journal blocks launch/update | False positive: warning only |
| M10-H03 | Legacy update | — | UpdateHandoffJournal.swift:206 | Illegal migration poisons recovery | False positive: phase preserved; migration test-only |
| M10-H04 | Legacy update | — | UpdateHandoffJournal.swift:326 | Unsynced rename loses recovery authority | False positive: journal grants no native authority |
| M10-H05 | Legacy update | — | UpdateHandoffJournal.swift:280 | Startup clears failed native evidence | False positive: archived legacy evidence; native receipt unaffected |
| M10-H06 | Legacy update | — | UpdatePreparation.swift:21 | Persistence failure stops healthy monitors | False positive: writes precede quiescence |
| M10-H07 | Native update | P3 | AppState+NativeUpdate.swift:134 | Retirement retains released protection display | Duplicate of #785 |
| M10-H08 | Native update | P2 | RuntimeCleanup.swift:217 | Protected Offline successor cannot commit | Duplicate of #795 |
| M10-H09 | Native update | P2 | AppState+NativeUpdate.swift:9 | Monitor releases PF during staging | Duplicate of #891 |
| M10-H10 | Download | — | NativeUpdateDownload.swift:40 | Artifact size conversion crashes | False positive: manifest caps size at 4 GB |
| M10-H11 | Download | — | NativeUpdateDownload.swift:84 | Partial package accepted | False positive: exact size and helper hash checks |
| M10-H12 | Download | — | NativeUpdateDownload.swift:74 | Redirected package accepted | False positive: redirects refused; final origin checked |
| M10-H13 | Subscription URL | — | AppState+Subscriptions.swift:23 | URL edge cases crash customer launch | False positive: developer-profile guard |
| M10-H14 | Subscription URL | — | AppDelegate.swift:181 | Deep link bypasses import guard | False positive: legacy imports rejected |
| M10-H15 | Subscription | — | SubscriptionManager.swift:526 | Huge traffic-name conversion traps | Rejected for customer scope: developer-only path |
| M10-H16 | Subscription | — | SubscriptionManager.swift:23 | Traffic counter display overflows | False positive: no consumers |
| M10-H17 | Subscription URL | — | SubscriptionManager.swift:180 | Private address bypasses validation | False positive: address classification and pinning |
| M10-H18 | Subscription | — | SubscriptionManager.swift:291 | Partial/oversized response accepted | False positive: body cap and successful curl exit required |
| M10-H19 | Subscription | — | AppState+Persistence.swift:74 | Old subscriptions affect production | False positive: production never loads them |
| M10-H20 | Download | — | NativeUpdateDownload.swift:16 | Truncated metadata authorizes installation | False positive: decoding and signature checks |
| M10-H21 | Download | — | NativeUpdateDownload.swift:62 | Callback races continuation registration | False positive: registration precedes task start |
| M10-H22 | Download | — | NativeUpdateDownload.swift:64 | Cancellation causes indefinite waiting | False positive: no caller cancellation source; resource deadline |
| M10-H23 | Native update | — | AppDelegate.swift:315 | Quit during download permanently cuts network | Rejected: no single-failure path proved; watchdog recovery |
| M10-H24 | Download | — | NativeUpdateDownload.swift:88 | Crash-created temporary package gets reused | False positive: temporary paths never reused |
| M10-H25 | Native update | — | AppState+NativeUpdate.swift:17 | Preparation failure leaves internet blocked indefinitely | False positive: stopped-Core watchdog releases and applies AI layer |

- [#991](https://github.com/raydocs/tono/pull/991): `needs-hardware`; merge-commit auto-merge enabled. Path, core-input and policy checks passed; build/XCTest and privileged jobs queued.
- [#993](https://github.com/raydocs/tono/pull/993): `needs-hardware`; merge-commit auto-merge enabled. Path and core-input checks passed; remaining macOS jobs queued.

**27 hypotheses: 22 false positives/rejected candidates, 3 duplicates, 2 verified fixes.**

All assigned source areas were reviewed. Swift/XCTest could not run locally; hosted CI and real-device validation remain outstanding. No helper edits, deployment or publication. [Full operator report](/workspace/w1-codex/out/R3-M10gap/report.md).