No new verified bugs in A11. No source changes or PRs. Full paths and evidence are in the [audit report](/workspace/w1-codex/out/R3-A11/report.md).

IDs below use the `A11-` prefix. **FP** means false positive or rejected hypothesis; severity remains unassigned.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| H01 | sing-box | — | sing_box/runtime.rs:274 | Process DIRECT bypasses AI guards | Duplicate #871; dormant |
| H02 | sing-box | — | sing_box/runtime.rs:275 | HY2 assistant UDP misses residential route | Duplicate #783; dormant |
| H03 | sing-box | — | sing_box/runtime.rs:203 | Stock core rejects DER-pin field | Known #203 blocker |
| H04 | sing-box | — | sing_box/runtime.rs:324 | Domain/IP conditions use OR | FP: explicit AND |
| H05 | sing-box | — | sing_box/runtime.rs:396 | Controller DNS receives fake IP | FP: inbound-scoped rules |
| H06 | sing-box | — | sing_box/runtime.rs:244 | Transport sockets enter TUN | FP: endpoint exclusions |
| H07 | sing-box | — | sing_box/runtime.rs:177 | Forged node bypasses validation | FP: nodes readmitted |
| H08 | sing-box | — | sing_box/runtime.rs:96 | Unicode pin causes slicing panic | FP: ASCII/length guards |
| H09 | flag | — | sing_box/flag.rs:20 | Flag enables unqualified runtime | FP: no production callers |
| H10 | sing-box | — | sing_box/runtime.rs:130 | Empty capabilities bypass trust | FP: caller-owned admission |
| H11 | config | — | config.rs:1135 | Signed-app DIRECT overrides AI | Duplicate #871 |
| H12 | config | — | config.rs:1080 | HY2 UDP bypasses home routing | Duplicate #783 |
| H13 | config | — | config.rs:958 | Raw-IP SNI activates suffix DIRECT | FP: pure-IP sniffing disabled |
| H14 | DNS | — | config.rs:996 | Resolver bootstrap recurses | FP: literal endpoints |
| H15 | DNS | — | config.rs:920 | Real host pins lose hostname | FP: upstream preserves mapping |
| H16 | config | — | config.rs:663 | Home endpoint lacks exclusion | FP: both endpoints excluded |
| H17 | config | — | config.rs:718 | Path regex breaks YAML | FP: affected scalars quoted |
| H18 | config | — | config.rs:1250 | VLESS UDP falls back DIRECT | FP: UDP REJECT floor |
| H19 | config | — | config.rs:640 | Invalid residential hop silently degrades | FP: validation rejects |
| H20 | node | — | node.rs:189 | Unicode name parsing panics | FP: UTF-8-safe operations |
| H21 | node | — | node.rs:339 | IPv6/encoded endpoint misroutes | FP: IPv4-only admission |
| H22 | node | — | node.rs:216 | Invalid port crashes/truncates | FP: bounded decoding |
| H23 | node | — | node.rs:181 | HY2 protocol disagrees with suffix | Accepted D6; Worker guards |
| H24 | node | — | node.rs:347 | Missing Reality fingerprint breaks dial | Duplicate PERF-CONNECT-1 |
| H25 | node | — | node.rs:143 | HY2 mapping weakens pinning | FP: DER pin retained |
| H26 | node | — | node.rs:150 | Omitted VLESS UDP breaks transport | FP: deliberate UDP rejection |
| H27 | node | — | node.rs:134 | Omitted HY2 options break defaults | FP: upstream supplies defaults |
| H28 | node | — | node.rs:370 | UUID normalization changes password | FP: ordinary catalogs canonical |
| H29 | node | — | node.rs:453 | Late node cap permits exhaustion | FP: catalog size bounded first |
| H30 | provisioning | — | provision-reality-node.rb:61 | Long Unicode label exceeds client cap | Rejected: administrator trigger |
| H31 | plan | — | connection_plan.rs:88 | Strict initial failure releases | FP: unreachable current setting |
| H32 | plan | — | connection_plan.rs:15 | Lost startup response skips cleanup | FP: generation reconciliation |
| H33 | plan | — | connection_plan.rs:164 | Connect overtakes Disconnect | FP: state/generation gates |
| H34 | plan | — | connection.rs:684 | Pre-arm failure removes prior AI hold | FP: session/unarmed guards |
| H35 | policy | — | config.rs:1222 | Trusted suffix captures AI hosts | Duplicate #797 |
| H36 | config | — | config.rs:1159 | Host/regex injects rules | FP: production input validation |
| H37 | cleanup | — | cleanup.rs:145 | Single delayed startup loses AI hold | Rejected: timing bound; broader variant unproved |
| H38 | DNS | — | config.rs:996 | DoH follows China DIRECT | FP: explicit exit selection |
| H39 | sniffing | — | config.rs:959 | Sniffing bypasses pinned address | FP: destination retained, AND rule |
| H40 | DNS | — | config.rs:982 | Reload discards fake-IP map | FP: upstream transfers mappings |
| H41 | DNS | — | config.rs:982 | Recovery TTL ignored | FP: upstream applies TTL |
| H42 | IPv6 | — | config.rs:861 | Defaults create second TUN plane | FP: IPv6 defaults cleared |

**Checks:** `CARGO_BUILD_JOBS=2 cargo test -p tono-core --locked` passed **344 tests** on `7c16960c`. Worktree clean.

**PRs:** none; labels and auto-merge not applicable.

**Count:** 42 hypotheses examined; 34 false-positive/rejected hypotheses; 8 known duplicates or accepted designs.

Assigned static review finished. Native Windows qualification remains unavailable; H37’s compound-delay/sleep-wake variant remains unproved. Incremental records: [findings.tsv](/workspace/w1-codex/out/R3-A11/findings.tsv).