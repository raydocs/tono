[PR #1106](https://github.com/raydocs/tono/pull/1106) **merged through green CI**, closing #1054. Failed full connections now use capped backoff; physical network changes and user actions wake recovery. Normal-internet fallback, AI blocking and strict-mode behavior remain intact.

Locations below are under `apps/windows/app/src-tauri/src/tono/connection/` unless stated, using audited baseline `9af1578e`.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4UB-WIN-FAILED-CONNECT-BACKOFF | Unarmed probe | P1 | unarmed_probe.rs:157 | TCP success resets backoff despite failed full connection | **Fixed in #1106** |
| R4UB-WIN-UNARMED-SELECTION | Unarmed probe | P2 | unarmed_probe.rs:132 | Late proof overwrites newer selection | Duplicate #1098 |
| WIN-UNARMED-TIMEOUT-OWNER | Unarmed probe | P2 | unarmed_probe.rs:155 | Timeout’s second retirement ends automatic recovery | **Real-unfixed [#1101](https://github.com/raydocs/tono/issues/1101)**; separate ownership fix needed |
| R4UB-FP-HEALTH-SUCCESSOR-RELEASE | Health | — | monitor.rs:1397 | Old release affects a cold-switch successor | False positive: registered tasks are aborted |
| R4UB-FP-ORDINARY-RETRY-BUDGET | Reconnect | — | reconnect.rs:296 | Exhausted retries retain broad blocking | False positive: selective release precedes delay |
| R4UB-FP-INPLACE-OUTAGE-HOLD | Health | — | monitor.rs:838 | Outage hold conceals dead tunnel | False positive: fresh data-plane proof required |
| R4UB-FP-TUN-EVENT-LOOP | Health | — | monitor.rs:1084 | Own TUN events repeatedly restart Core | False positive: two failed proofs required |
| R4UB-FP-VANISHED-DIRECT-UPLINK | Health | — | monitor.rs:1325 | DIRECT retains vanished uplink | False positive: usable-uplink membership checked |
| R4UB-FP-IDLE-RESYNC | Health | — | monitor.rs:642 | Idle protected state lacks monitoring | False positive: generation-fenced truth polling |
| R4UB-FP-OLD-STATUS-PUBLISH | Health | — | monitor.rs:972 | Slow probe publishes obsolete status | False positive: generation and fresh aggregate checks |
| R4UB-FP-DEFERRED-POLICY | Health | — | monitor.rs:1268 | Connecting loses policy updates | False positive: owned deferral consumed |
| R4UB-DUP-DIRECT-WRITER | Health | P2 | monitor.rs:1397 | DIRECT reader delays restoration | Duplicate #1051; known decision item |
| R4UB-DUP-PROTECTED-PREFLIGHT | Reconnect | P1 | connection.rs:440 | App TCP preflight runs behind WFP | Duplicate #1070 |
| R4UB-DUP-DOUBLE-RELEASE | Reconnect | P1 | connection.rs:272 | Failure cleanup releases twice | Duplicate #798 |
| R4UB-FP-PROBE-SELF-ABORT | Unarmed probe | — | connection.rs:332 | Connect aborts its own probe | False positive: retirement is abort-free |
| R4UB-FP-LATE-HANDLE-INSTALL | Unarmed probe | — | unarmed_probe.rs:50 | Late registration resurrects Disconnect | False positive: generation/ticket fences |
| R4UB-FP-EXPLICIT-CONNECT-WAIT | Unarmed probe | — | connection.rs:227 | Explicit Connect inherits cooldown | False positive: independent admission |
| R4UB-FP-STRICT-UNARMED | Unarmed probe | — | unarmed_probe.rs:201 | Strict mode enters unarmed recovery | False positive: disposition/barrier guards |
| R4UB-DUP-STALE-HOTSWITCH-HEALTH | Health | P2 | monitor.rs:1397 | Old health proof releases hot-switch replacement | Duplicate #1095 |
| R4UB-DUP-WINDOWS-CHECKOUT | CI | P2 | archived merge-manager/aux.sh:1 | Reserved filename prevents Windows checkout | Duplicate #1100; repaired on main |
| R4UB-FP-SAMPLER-SHUTDOWN | Unarmed probe | — | `src/main.rs:13` | Hung sampler delays runtime shutdown | False positive: committed Windows exit terminates process |

#1106 carries **`needs-hardware`**; **MERGE auto-merge completed** as `520294ad`. Local verification passed **345 core tests and two observer regressions**. Native Windows and required macOS CI passed.

**21 hypotheses examined: 13 false positives, six duplicates, two new verified findings.** The assigned reconnect/probe/health audit is complete. Unfinished work is #1101’s timeout-ownership fix and real-device WFP/DNS/uplink acceptance.

Full records: [findings.tsv](/workspace/w1-codex/out/R4-UnarmedBackoff/findings.tsv), [report.md](/workspace/w1-codex/out/R4-UnarmedBackoff/report.md).