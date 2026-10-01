Four verified P1 findings are fixed. **All three PRs merged with exact-head macOS checks and `ci-gate` passing.**

File positions below refer to audited baselines. Helper filenames are under `tooling/scripts/core-helper`; `PeerAuthorization.swift` is under `tooling/scripts/helper-shared`.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| MAC-FAILED-BARRIER-AI-HOLD | M2 | P1 | KillSwitchManager.swift:561 | Automatic PF failure releases without preserving AI hold | Fixed in #1028 |
| MAC-ORPHAN-BOOTSTRAP-AI-HOLD | M1 | P1 | SocketServer.swift:328 | App-crash bootstrap cleanup drops AI hold | Fixed in #1028; follow-up to #773 |
| MAC-DNS-PREFS-LOCK | M3 | P1 | ProtectedDNSManager.swift:974 | Preferences contention hangs helper recovery | Fixed in #1030 |
| MAC-DNS-APPLY-RETRY | M3 | P1 | ProtectedDNSManager.swift:319 | Failed Apply makes retry retire recovery prematurely | Fixed in #1033 |
| MAC-APP-FAILURE-AI-HOLD | M1/caller | P1 | apps/macos/Tono/Services/AppState+Connect.swift:2259 | Automatic exhausted failure invokes explicit disarm | Real-unfixed: adjacent App ownership; needs distinct automatic-release intent |
| M1-POWER-LOCK-INVERSION | M1 | — | HelperPower.swift:124 | Potential power/request deadlock | False positive: locks released before subsequent acquisitions |
| M1-LATE-ARM-AFTER-SLEEP | M1 | — | KillSwitchManager.swift:320 | Delayed arm commits after sleep begins | False positive: generation and awake guards reject it |
| M1-HTTP-UNBOUNDED-INPUT | M1 | — | HelperHTTP.swift:13 | Ordinary requests hang helper | False positive: size caps and idle deadlines; no ordinary trickle trigger |
| M1-PEER-PID-REUSE | M1 | — | PeerAuthorization.swift:70 | PID reuse defeats authentication | False positive: kernel audit token binds process incarnation |
| M2-MISSING-UTUN-RESTORE | M2 | — | KillSwitchManager.swift:973 | Restoration permits nonexistent utun | False positive: existing-interface filtering |
| M2-UNPROVEN-PF-HEALTH | M2 | — | KillSwitchManager.swift:890 | Transient query disconnects healthy session | False positive: confirmed failure required; unknown samples omitted |
| M2-WATCHDOG-STALE-COUNT | M2 | — | SocketServer.swift:227 | New arm inherits watchdog failure count | False positive: committed arm/disarm advances epoch |
| M2-MAC-STRICT-FALSE | M2 | — | KillSwitchManager.swift:558 | Hardcoded flag bypasses strict mode | False positive: no exposed macOS strict control; decision 035 |
| M2-EXPLICIT-RESTORE-AI | M2 | — | KillSwitchManager.swift:585 | Explicit Restore removes AI layer | False positive: deliberate explicit Restore semantics, decision 036 |
| M3-SCOPED-IP | M3 | — | ProtectedDNSManager.swift:1064 | Scoped IPv6 resolvers rejected | False positive: Darwin parser supports zone suffixes |
| M3-REENABLE-ORIGINAL | M3 | — | ProtectedDNSManager.swift:410 | Reenable loses newer original DNS | False positive: newer originals persisted before replacement |
| M3-STOP-PID-FAILURE | M3 | — | CoreManager.swift:220 | PID unlink failure permanently preserves PF | False positive: process cleared first; watchdog converges |
| M3-FOREIGN-DNS-COUNT | M3 | — | ProtectedDNSManager.swift:874 | Long resolver lists prevent restoration | False positive: authoritative stable-ID reads are uncapped |
| M3-RESTORE-DELETES-EARLY | M3 | — | ProtectedDNSManager.swift:299 | Snapshot removed without readback | False positive: persisted readback exists; Apply gap separately fixed |
| MAIN-SIGTERM-PF | M1 | — | SocketServer.swift:203 | SIGTERM leaves protection unreleased | False positive: ordinary launchd replacement restarts and reconciles |
| MAIN-UNKNOWN-APP-PRESENCE | M1 | — | main.swift:1071 | Uncertain App ownership strands protection | False positive: Core-down watchdog still releases |
| M1-UPGRADE-FIFO | M1 | P2 | SocketServer.swift:462 | Upgrade input/probe blocks helper | Duplicate #979/#928 |
| M2-PF-PLACEHOLDER-RELEASE | M2 | P1 | KillSwitchManager.swift:676 | Placeholder failure prevents release | Duplicate #761; current cleanup catches it |
| M2-PF-TOKEN-FORGET | M2 | P2 | KillSwitchPF.swift:1263 | Failed token release forgets reference | Duplicate #979/#895 |
| M2-LAN-DNS-SCOPE | M2 | P2 | KillSwitchPF.swift:178 | New physical interface escapes DNS scope | Duplicate #979/#894 |
| M3-DNS-STATUS-ID | M3 | P2 | ProtectedDNSManager.swift:561 | Renamed service reports incorrect DNS | Duplicate #979/#893 |
| M3-STALE-CORE-PID | M3 | P2 | CoreManager.swift:395 | Stale PID signals unrelated process | Duplicate #979/#897 |
| M3-DNS-COUNT-CAP | M3 | P1 | ProtectedDNSManager.swift:83 | Large DNS snapshot cannot restore | Duplicate #765 |
| M3-FOREIGN-LOOPBACK | M3 | P2 | ProtectedDNSManager.swift:355 | Foreign loopback settings remain | Duplicate BRICK-M12 ownership decision |
| MAIN-STALE-CORE-EMERGENCY | M1 | P2 | main.swift:805 | Stale Core aborts emergency release | Duplicate #763 |
| M1-CORE-ALIVE-HANG | M1 | — | SocketServer.swift:236 | Live hung Core retains protection | Unverified: ordinary hang trigger not proved |
| M2-LOOKUP-KILL-WAIT | M2 | — | KillSwitchPF.swift:1763 | Resolver wait survives SIGKILL | Unverified: ordinary stalled resolver terminates |
| M2-STATE-LSTAT-EIO | M2 | — | KillSwitchManager.swift:1210 | State-read error prevents release | Unverified: single-failure outage not proved |
| M3-NETWORKSETUP-STALL | M3 | — | ProtectedDNSManager.swift:1020 | Legacy subprocess hangs recovery | Unverified: ordinary fallback/stall trigger not proved |
| M3-SNAPSHOT-DURABILITY | M3 | — | ProtectedDNSManager.swift:719 | Power loss loses renamed snapshot | Unverified: APFS persistence window not tested |
| M3-DIAGNOSTIC-CLOSE | M3 | — | CoreManager.swift:254 | Diagnostic callback races closed handle | Unverified: Foundation behavior not proved |

| PR | Status | Auto-merge | Label |
|---|---|---|---|
| [#1028 — preserve AI hold after automatic releases](https://github.com/raydocs/tono/pull/1028) | Merged | MERGE enabled | `needs-hardware` |
| [#1030 — bound DNS lock contention](https://github.com/raydocs/tono/pull/1030) | Merged | MERGE enabled | `needs-hardware` |
| [#1033 — retry DNS activation](https://github.com/raydocs/tono/pull/1033) | Merged | MERGE enabled | `needs-hardware` |

**36 hypotheses:** 4 fixed, 1 real-unfixed, 16 false positives, 9 duplicates, 6 unverified.

All assigned files were read end to end. Remaining work: the adjacent App finding, proof for the six unverified hypotheses, and installed-device PF/DNS/sleep testing. Swift was unavailable locally; native CI passed.

[Full report](/workspace/w1-codex/out/R3-M1M3/report.md), [findings TSV](/workspace/w1-codex/out/R3-M1M3/findings.tsv), [CI receipts](/workspace/w1-codex/out/R3-M1M3/ci-receipts.txt).