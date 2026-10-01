# R3-M1M3: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:22 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1028 | hunt/sol-r3helper-failed-barrier-ai-hold | needs-hardware | yes | fix(macos-helper): preserve AI hold after automatic releases |
| 1030 | hunt/sol-r3helper-dns-prefs-contention | needs-hardware | yes | fix(macos-helper): keep DNS lock contention from hanging recovery |
| 1033 | hunt/sol-r3helper-dns-apply-retry | needs-hardware | yes | fix(macos-helper): retry DNS activation before retiring recovery |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| MAC-FAILED-BARRIER-AI-HOLD | M2 | P1 | tooling/scripts/core-helper/KillSwitchManager.swift:561 | Failed automatic PF commit releases without secondary AI hold | real-fixed #1028 |
| MAC-ORPHAN-BOOTSTRAP-AI-HOLD | M1 | P1 | tooling/scripts/core-helper/SocketServer.swift:328 | Merged orphan crash release omits secondary AI hold | real-fixed #1028 |
| MAC-DNS-PREFS-LOCK | M3 | P1 | tooling/scripts/core-helper/ProtectedDNSManager.swift:974 | DNS preferences lock contention hangs helper and recovery | real-fixed #1030 |
| MAC-DNS-APPLY-RETRY | M3 | P1 | tooling/scripts/core-helper/ProtectedDNSManager.swift:319 | Commit-before-Apply failure makes retry discard DNS recovery without applying | real-fixed #1033 |
| M1-POWER-LOCK-INVERSION | M1 | — | tooling/scripts/core-helper/HelperPower.swift:124 | Power callback and requests deadlock through opposite lock order | false-positive gates/PF locks released before later locks; IPC serial |
| M1-LATE-ARM-AFTER-SLEEP | M1 | — | tooling/scripts/core-helper/KillSwitchManager.swift:320 | A delayed arm reopens protection after sleep begins | false-positive generation and awake checks reject stale commit |
| M1-HTTP-UNBOUNDED-INPUT | M1 | — | tooling/scripts/core-helper/HelperHTTP.swift:13 | Ordinary socket input holds helper indefinitely | false-positive request/header caps and 3-second idle deadlines; no ordinary trickle trigger |
| M1-PEER-PID-REUSE | M1 | — | tooling/scripts/helper-shared/PeerAuthorization.swift:70 | Reused peer PID defeats client authentication | false-positive kernel audit token binds process incarnation |
| M1-UPGRADE-FIFO | M1 | P2 | tooling/scripts/core-helper/SocketServer.swift:462 | Silent upgrade source/probe can block the serialized helper | duplicate #979/#928; remaining signed-probe limit already recorded |
| M1-CORE-ALIVE-HANG | M1 | — | tooling/scripts/core-helper/SocketServer.swift:236 | Process-only watchdog leaves a hung live Core protected | unverified no ordinary hang trigger proved; committed Core survival intentional |
| M2-PF-PLACEHOLDER-RELEASE | M2 | P1 | tooling/scripts/core-helper/KillSwitchManager.swift:676 | Placeholder write failure prevents PF release | duplicate #761; current release catches housekeeping failure |
| M2-PF-TOKEN-FORGET | M2 | P2 | tooling/scripts/core-helper/KillSwitchPF.swift:1263 | Failed pfctl -X forgets enable token | duplicate #979/#895 |
| M2-LAN-DNS-SCOPE | M2 | P2 | tooling/scripts/core-helper/KillSwitchPF.swift:178 | New physical NIC escapes arm-time LAN DNS scope | duplicate #979/#894 |
| M2-MISSING-UTUN-RESTORE | M2 | — | tooling/scripts/core-helper/KillSwitchManager.swift:973 | Saved nonexistent utun is restored as permitted | false-positive restorableState filters existing interfaces |
| M2-UNPROVEN-PF-HEALTH | M2 | — | tooling/scripts/core-helper/KillSwitchManager.swift:890 | One transient PF query disconnects healthy session | false-positive agreed filtering requires confirmed down or omits sample |
| M2-WATCHDOG-STALE-COUNT | M2 | — | tooling/scripts/core-helper/SocketServer.swift:227 | New arm inherits stale Core-down watchdog count | false-positive openNetworkEpoch advances/reset on committed arm/disarm |
| M2-LOOKUP-KILL-WAIT | M2 | — | tooling/scripts/core-helper/KillSwitchPF.swift:1763 | Resolver waits indefinitely after SIGKILL | unverified ordinary stalled resolver terminates; kernel hang trigger unproved |
| M2-STATE-LSTAT-EIO | M2 | — | tooling/scripts/core-helper/KillSwitchManager.swift:1210 | State lstat error looks absent and prevents watchdog release | unverified ordinary single-failure outage not proved |
| M2-MAC-STRICT-FALSE | M2 | — | tooling/scripts/core-helper/KillSwitchManager.swift:558 | Hardcoded false bypasses a macOS strict mode | false-positive no user-facing strict control; decision035 |
| M2-EXPLICIT-RESTORE-AI | M2 | — | tooling/scripts/core-helper/KillSwitchManager.swift:585 | Explicit Restore drops selective AI layer | false-positive documented explicit Restore intent decision036 |
| M3-DNS-STATUS-ID | M3 | P2 | tooling/scripts/core-helper/ProtectedDNSManager.swift:561 | Renamed service reports wrong DNS status by display name | duplicate #979/#893 |
| M3-STALE-CORE-PID | M3 | P2 | tooling/scripts/core-helper/CoreManager.swift:395 | Stale Core termination signals reused PID | duplicate #979/#897 |
| M3-DNS-COUNT-CAP | M3 | P1 | tooling/scripts/core-helper/ProtectedDNSManager.swift:83 | Over-eight DNS snapshot cannot restore | duplicate #765 |
| M3-FOREIGN-LOOPBACK | M3 | P2 | tooling/scripts/core-helper/ProtectedDNSManager.swift:355 | Foreign exact loopback DNS remains after owner-only restore | duplicate BRICK-M12; ownership ambiguity is documented |
| M3-SCOPED-IP | M3 | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:1064 | Scoped IPv6 resolvers are rejected | false-positive Darwin inet_pton supports percent-zone suffixes |
| M3-REENABLE-ORIGINAL | M3 | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:410 | Same-owner reenable loses newer original DNS | false-positive archives stale snapshot and persists newer originals first |
| M3-STOP-PID-FAILURE | M3 | — | tooling/scripts/core-helper/CoreManager.swift:220 | PID unlink failure preserves protection permanently | false-positive process cleared before unlink; watchdog/status converge |
| M3-FOREIGN-DNS-COUNT | M3 | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:874 | Long foreign resolver lists block restoration | false-positive authoritative stable-ID read uncapped; fallback needs another failure |
| M3-RESTORE-DELETES-EARLY | M3 | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:299 | Snapshot removed without persisted readback | false-positive write followed by readback; Apply gap is separately fixed |
| M3-NETWORKSETUP-STALL | M3 | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:1020 | Legacy DNS subprocess hangs helper | unverified ordinary fallback-plus-stall trigger not proved |
| M3-SNAPSHOT-DURABILITY | M3 | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:719 | Snapshot rename loses recovery on power loss | unverified narrow persistence window; APFS behavior not tested |
| M3-DIAGNOSTIC-CLOSE | M3 | — | tooling/scripts/core-helper/CoreManager.swift:254 | Diagnostic callback races closed FileHandle | unverified Foundation race behavior not proved |
| MAIN-SIGTERM-PF | M1 | — | tooling/scripts/core-helper/SocketServer.swift:203 | SIGTERM stop keeps PF and protected DNS | false-positive ordinary launchd replacement restarts/reconciles; pending executor owns hold |
| MAIN-STALE-CORE-EMERGENCY | M1 | P2 | tooling/scripts/core-helper/main.swift:805 | Core constructor error aborts emergency release | duplicate #763 |
| MAIN-UNKNOWN-APP-PRESENCE | M1 | — | tooling/scripts/core-helper/main.swift:1071 | Unreadable other App keeps removed Tono protection | false-positive uncertain ownership preserves installation; Core-down watchdog still releases |
| MAC-APP-FAILURE-AI-HOLD | M1/caller | P1 | apps/macos/Tono/Services/AppState+Connect.swift:2259 | Automatic exhausted failure invokes explicit disarm removing AI hold | real-unfixed outside assigned App ownership; needs separate automatic-release wire intent |
