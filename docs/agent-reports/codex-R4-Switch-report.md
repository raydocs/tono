**Seven own PRs merged with CI green, fixing 11 findings.** Another hunter fixed our stale-health finding in #1133.

File:line references the audited baseline.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4-WIN-CONNECT-CATALOG-ROUTING | Windows | P1 | `connection/stages.rs:328` | Catalog rotation during connect leaves stale residential routing | Fixed #1066 |
| R4-WIN-PROTECTED-TCP-PREFLIGHT | Windows | P1 | `connection/unarmed_probe.rs:242` | Retained WFP blocks app TCP preflight | Fixed #1070 |
| R4SW-CP-BOUND-HOME-RETIRE | Control plane | P1 | `ops/reads/fleet.ts:169` | Retirement ignores bound residential homes | Fixed #1083 |
| R4SW-MAC-PROOF-TARGET | macOS | P1 | `AppState+Connect.swift:2339` | Backup proof reconnects the previous target | Fixed #1086 |
| R4SW-MAC-HY2-PROBE | macOS | P1 | `AppState+Connect.swift:2319` | Remembered HY2 prevents eligible TCP recovery | Fixed #1086 |
| R4SW-MAC-RELEASE-WAIT | macOS | P2 | `AppState+Connect.swift:2316` | Slow teardown permanently retires recovery | Fixed #1086 |
| R4SW-MAC-RETRY-BACKOFF | macOS | P1 | `AppState+Connect.swift:2309` | Failed tunnel attempts repeatedly reset backoff | Fixed #1086 |
| R4-WIN-UNARMED-SELECTION | Windows | P2 | `connection/unarmed_probe.rs:133` | Late proof overwrites newer user selection | Fixed #1098 |
| R4SW-MAC-CATALOG-AI-HOLD | macOS | P1 | `AppState+Catalog.swift:379` | Automatic catalog cleanup drops AI blocking | Fixed #1103 |
| R4SW-MAC-OPTIONAL-AI-HOLD | macOS | P1 | `AppState.swift:2031` | Optional-policy failure cleanup drops AI blocking | Fixed #1103 |
| R4SW-MAC-POLICY-REVOCATION | macOS | P1 | `AppState.swift:1839` | Accepted revocation retains old DIRECT grants | Fixed #1115 |
| R4-WIN-STALE-HEALTH-RELEASE | Windows | P2 | `connection/monitor.rs:1397` | Old health failure releases a successfully switched tunnel | Fixed #1133, other hunter |
| R4SW-CP-RELIST-SPKI | Control plane | P2 | `ops/reads/fleet.ts:290` | HY2 relist loses macOS SPKI pin | Unfixed [#1073](https://github.com/raydocs/tono/issues/1073): pin contract needed |
| R4SW-CP-BIND-RETIRE-CONCURRENCY | Control plane | P2 | `ops/shared-admin/home-exits.ts:433` | Concurrent binding survives home retirement | Unfixed [#1102](https://github.com/raydocs/tono/issues/1102): atomic fence needed |
| R4SW-MAC-CATALOG-BUSY-REMOVAL | macOS | P2 | `AppState+Catalog.swift:342` | Catalog removal skips convergence during a switch | Unfixed [#1113](https://github.com/raydocs/tono/issues/1113): queued convergence needed |
| R4SW-MAC-POLICY-COALESCING | macOS | P2 | `AppState.swift:1846` | Busy runtime owner drops newer policy intent | Unfixed [#1114](https://github.com/raydocs/tono/issues/1114): policy coalescing needed |

Own PRs: [#1066](https://github.com/raydocs/tono/pull/1066), [#1070](https://github.com/raydocs/tono/pull/1070), [#1083](https://github.com/raydocs/tono/pull/1083), [#1086](https://github.com/raydocs/tono/pull/1086), [#1098](https://github.com/raydocs/tono/pull/1098), [#1103](https://github.com/raydocs/tono/pull/1103), [#1115](https://github.com/raydocs/tono/pull/1115). All merged using merge-commit auto-merge. All carry `needs-hardware` except #1083, which has no label.

Reviewed **56 merged PRs** and **53 hypotheses**: 12 fixed, four unfixed, **24 false positives**, 13 duplicates. The [full report](/workspace/w1-codex/out/R4-Switch/report.md) contains every hypothesis, rejection reason and REG verdict.

Local Worker/Rust checks and hosted native regressions passed. Remaining work: the four issues above, real-device PF/WFP/DNS/TUN acceptance, and merged changes beyond the recorded review coverage.

Hunter: GPT-6.1 Sol (Codex CLI)