# R3-M6M8: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:50 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1001 | hunt/sol-r3conn-update-wake-retirement | needs-hardware | yes | fix(macos): retire wake recovery before native update release |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R3CONN-FP01 | M6 | — | AppState+Connect.swift:1967 | Monitor-switch-disconnect dependency cycle | false-positive failed switch enqueues teardown synchronously then returns |
| R3CONN-FP02 | M6 | — | AppState+Connect.swift:2322 | Reconnect-connect-disconnect dependency cycle | false-positive failed connect returns before queued teardown drains |
| R3CONN-FP03 | M6 | — | AppState+Connect.swift:1669 | Late monitor arm defeats explicit release | false-positive disconnect drains captured monitor before final disarm |
| R3CONN-FP04 | M6 | — | AppState+Connect.swift:1515 | Stale protection audit defeats release | false-positive cancellation and generation guards fence every audit |
| R3CONN-FP05 | M6 | — | AppState.swift:144 | Unconfirmed protection survives accepted release | false-positive isProtectionBlocked didSet clears unconfirmed |
| R3CONN-FP06 | M6 | — | AppState+Proxy.swift:47 | Idle picker changes an in-flight connect selection | false-positive production node rows disabled while connecting; known R1-F6 |
| R3CONN-FP07 | M6 | — | AppState+Connect.swift:1972 | Old node-switch task produces false failover success | false-positive candidate ID and connection-state checks refuse stale success |
| R3CONN-FP08 | M6 | — | ProtectedConnectivityVerifier.swift:278 | Cancelled probe continuation resumes twice | false-positive OnceResume gate owns completion |
| R3CONN-FP09 | M8 | — | ConnectionCoordinator.swift:97 | Deferred Connect survives explicit release | false-positive queue cancels slot and callback checks ID generation cancellation |
| R3CONN-FP10 | M8 | — | ConnectionCoordinator.swift:276 | Old reconnect cleanup removes replacement loop | false-positive defer checks recovery ID |
| R3CONN-FP11 | M8 | — | ConnectionCoordinator.swift:119 | Cancelled node switch commits over newer owner | false-positive cancellation and generation checked around convergence |
| R3CONN-FP12 | M6 | — | AppState+Connect.swift:70 | Boot safety record failure still reaches PF | false-positive admission write throws before PF Core or generation |
| R3CONN-FP13 | M8 | — | AppDelegate.swift:291 | Signal and manual Quit drop a termination reply | false-positive unverified repeated AppKit terminate behavior; first completion terminates |
| R3CONN-FP14 | M8 | — | PhysicalNetworkReachability.swift:165 | Dynamic-store callback outlives raw context | false-positive shutdown-only tiny window; ordinary runtime effect unproved |
| R3CONN-DUP01 | M6 | P1 | AppState+Connect.swift:643 | Armed failure holds all traffic | duplicate #720 |
| R3CONN-DUP02 | M6 | P1 | AppState+Connect.swift:1589 | Released PF health and browser DNS hold | duplicate #760 |
| R3CONN-DUP03 | M8 | P2 | RuntimeCleanup.swift:218 | Protected Offline update commit remains pending | duplicate #795 |
| R3CONN-DUP04 | M8 | P2 | AppState+NativeUpdate.swift:38 | Cancelled reload handle survives update suspension | duplicate #991 |
| MAC-UPDATE-WAKE-RETIREMENT | M8 | P2 | AppState+NativeUpdate.swift:36 | Surviving wake task reconnects after explicit update release and retirement | real-fixed #1001; CI pending |
| R3CONN-FP15 | M8 | — | NetworkUplinkSnapshot.swift:67 | DHCP and APIPA gaps force reconnect | false-positive normalization and inconclusive transition preserve stable uplink |
| R3CONN-FP16 | M8 | — | NetworkUplinkSnapshot.swift:84 | Dual-stack IPv6 RA churn forces reconnect | false-positive IPv4-presence guard deliberately ignores IPv6 churn |
| R3CONN-FP17 | M6 | — | AppState+Connect.swift:419 | Mid-connect uplink baseline hides wrong DNS service | false-positive system DNS preflight and effective-resolver audit reject bypass |
| R3CONN-FP18 | M8 | — | AppState.swift:660 | Sleep overwrites a failed explicit release | false-positive persistent release intent gates sleep wake and network kicks |
| R3CONN-FP19 | M8 | — | AppState.swift:761 | Cancelled ordinary wake IPC publishes protection | false-positive immediate cancellation guard; known MAC3-RECHECK-F2 |
| R3CONN-FP20 | M6 | — | CoreWebSocket.swift:177 | Old WebSocket frame modifies a new connection | false-positive stopped and socket-identity guards reject stale frames |
| R3CONN-FP21 | M6 | — | CoreControllerClient.swift:166 | Advisory controller task cancellation hangs teardown | false-positive controller delay request bounded to ten seconds |
| R3CONN-FP22 | M8 | — | SystemProxy.swift:153 | Read-only route command stalls privileged actor | false-positive no ordinary reproducible stall; known proxy deadlines #774 separate |
| R3CONN-FP23 | M8 | — | AppDelegate.swift:330 | Account restore reconnects after final quit release | false-positive cloud resume requires armed intent; final disconnect drains any earlier connect |
| R3CONN-FP24 | M8 | — | RuntimeCleanup.swift:218 | External root retirement leaves native update latches | false-positive administrator-dependent scenario outside ordinary trigger; overlaps #795/#785 |
| R3CONN-FP25 | M8 | — | RuntimeCleanup.swift:423 | Cancelled launch pending-update poll hangs startup | false-positive ordinary user-visible effect unproved; later account cancellation retires restore |
| R3CONN-FP26 | M8 | — | PhysicalNetworkReachability.swift:233 | Stopped link monitor leaves stale physical-offline verdict | false-positive stop forgets observations and happens only at termination |
| R3CONN-FP27 | M8 | — | AppState.swift:746 | Old wake removes a newer sleep-restriction handle | false-positive rapid repeated sleep race; serialized actor prevents demonstrated mutation harm |
| R3CONN-FP28 | M6 | P2 at most | AppState+Connect.swift:1288 | Late proxy refresh overwrites selected exit after cancellation | false-positive unverified millisecond response race; URLSession cancellation normally throws |
| R3CONN-DUP05 | M6 | P2 | AppState+Connect.swift:1494 | Missing-TUN release retires its own reconnect intent | duplicate #720 replaces this branch with unarmed recovery |
| R3CONN-DEC01 | M6 | P2 design | AppState+Connect.swift:2385 | Supplemental DNS conflict deliberately stops core and holds general traffic | real-unfixed decision item; deliberate teardown, helper watchdog releases with merged #738 selective layer; preserving the live session needs a product decision |
| R3CONN-DUP06 | M8 | P2 design | AppDelegate.swift:326 | Quit metadata-query error or deadline leaves protection held | duplicate documented behavior in #854; helper fallback already tracked |
