Six verified fixes merged through CI. **47 hypotheses examined: 7 real, 33 false positives, 7 duplicates.** One verified finding remains unfixed because safe repair needs an accounting decision. AI blocking, strict-mode behavior and TLS verification were preserved.

Locations below refer to audited pre-fix code. The [complete report with full paths and evidence](/workspace/w1-codex/out/R3-E2T2/final-report.md) is also recorded in the repository.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| HY2-PROVISION-SPKI | E2 | P1 | provision-reality-node.rb:445 | Catalog drops SPKI required by macOS HY2 | Fixed, merged [#995](https://github.com/raydocs/tono/pull/995) |
| PROVISION-JOURNAL-BANNER | E2 | P2 | manage-tono-node-v2.sh:328 | Empty journal banner rejects healthy restart | Fixed, merged [#996](https://github.com/raydocs/tono/pull/996) |
| PROVISION-ROLLBACK-MODE | E2 | P2 | manage-tono-node-v2.sh:151 | Snapshot permissions make rollback verification fail | Fixed, merged [#997](https://github.com/raydocs/tono/pull/997) |
| CONNECT-BENCH-PARTIAL-CACHE | T2 | P2 | bench.py:127 | Interrupted extraction poisons executable cache | Fixed, merged [#998](https://github.com/raydocs/tono/pull/998) |
| CONNECT-BENCH-STARTUP-ORPHAN | T2 | P2 | bench.py:571 | Failed startup leaves core child running | Fixed, merged [#1000](https://github.com/raydocs/tono/pull/1000) |
| PROVISION-PENDING-SUCCESS-DURABILITY | E2 | P2 | provision-tono-node.py:182 | Recovered success stays pending and blocks enrollment | Fixed, merged [#1002](https://github.com/raydocs/tono/pull/1002) |
| HOME-AGENT-PEER-RETENTION-CAP | E2 | P2 | report_example.py:148 | 2,001 lifetime peer baselines stop reporting | Real-unfixed: pruning needs counter-continuity semantics; reporter undeployed |
| HA-SERVER-AHEAD | E2 | — | report_example.py:478 | Recovery discards ambiguous history | False positive: deliberately prevents double billing |
| HA-POST-CRASH | E2 | — | report_example.py:652 | POST crash could duplicate charges | False positive: immutable replay and server watermarks deduplicate |
| HA-DISK-ACK | E2 | — | report_example.py:703 | ACK could precede durable state | False positive: durable save precedes POST/ACK |
| HA-OVERLAP | E2 | — | report_example.py:278 | Timer invocations mutate state concurrently | False positive: invocation-wide nonblocking flock |
| HA-CROSS-USER | E2 | — | report_example.py:493 | Stable identity could charge another user | False positive: explicit identity guard |
| HA-REPLAY-ACK | E2 | — | report_example.py:657 | Replay omits metering ACK | False positive: replay is not a fresh observation |
| HA-UNBOUNDED-DELIVERY | E2 | — | report_example.py:621 | Bad networks cause indefinite retry | False positive: timeout/errors propagate; refusal batches shrink |
| T2-PIN-DRIFT | T2 | — | prepare-macos-sing-box.sh:42 | Prepared binary disagrees with product pin | False positive: committed pins agree |
| T2-CANDIDATE-CORE | T2 | — | certify.py:114 | Candidate replaces product binary | False positive: explicit independent candidate path |
| T2-LDFLAGS | T2 | — | certify.py:177 | Missing metadata admits unknown bytes | False positive: binary digest binds committed manifest |
| T2-ADAPTIVE-HASH | T2 | — | build-mihomo-adaptive.sh:136 | Build digest varies | False positive: intentional timestamp; source/dependency pins retained |
| T2-ADAPTIVE-WINDOWS | T2 | — | build-mihomo-adaptive.sh:163 | Windows build omits alpha sidecar | False positive: intentional packaging boundary |
| T2-STOCK-IDENTITY | T2 | — | build-mihomo-adaptive.sh:64 | Stock core passes as adaptive | False positive: identity gate refuses mismatch |
| T2-BUFFER-BOUND | T2 | — | gvisor-adaptive-buffer.patch:22 | Adaptive buffer grows indefinitely | False positive: hard 128 KiB limit |
| T2-BENCH-DIRECT | T2 | — | bench.py:721 | Config routes customer AI traffic DIRECT | False positive: loopback server fixture; clients use final proxy |
| T2-MISSING-ROWS | T2 | — | bench.py:82 | Missing profiles falsely pass | False positive: driver emits failures; missing metrics fail |
| H2-AUTH-DEPENDENCY | E2 | — | manage-tono-hy2-node.sh:290 | Checker crash permanently stops HY2 | False positive: restart policy; spontaneous failure does not propagate through [Requires](https://raw.githubusercontent.com/systemd/systemd/v252/man/systemd.unit.xml) |
| H2-BINARY-PIN | E2 | — | provision-reality-node.rb:188 | Downloaded binary is unverified | False positive: archive and uploaded binary digests checked |
| H2-XRAY-LOSS | E2 | — | manage-tono-hy2-node.sh:595 | HY2 installation disrupts Xray | False positive: separate service, refusal guards and PID/hash checks |
| H2-SSH-HANG | E2 | — | provision-reality-node.rb:98 | SSH wait takes customer lines offline | False positive: independently supervised services continue |
| H2-CONFIG-WRITE | E2 | — | manage-tono-hy2-node.sh:363 | Patch failure destroys live configuration | False positive: backup restored; abrupt-kill window unproved |
| H2-MANAGED-ROSTER | E2 | — | manage-tono-hy2-node.sh:137 | Static sync overwrites managed identities | False positive: marker guard refuses operation |
| H2-FIRST-UUID | E2 | — | manage-tono-hy2-node.sh:143 | Only first UUID receives authentication | False positive: all identities enter hashed allowlist |
| H2-HTTP-STALLED | E2 | — | manage-tono-hy2-node.sh:274 | Remote partial requests hang checker | False positive: localhost-only; no public request path demonstrated |
| H2-YAML-PLACEHOLDER | E2 | — | provision-reality-node.rb:443 | Quoting loses identity placeholder | False positive: publisher preserves placeholder text |
| H2-ACTIVE-OVERWRITE | E2 | — | provision-reality-node.rb:372 | Apply overwrites active installation | False positive: existing-install refusal |
| H2-UFW-UDP | E2 | — | manage-tono-reality-node.sh:92 | Default provisioning loosens firewall | False positive: HY2 opt-in; firewall status only read |
| P-EXTEND-ENROLL | E2 | — | provision-tono-node.py:176 | Extend cannot enroll without metadata | False positive: documented intentional refusal |
| P-ZIP-TRAVERSAL | E2 | — | provision-tono-node.py:140 | Archive writes traversal paths | False positive: only exact Xray member read |
| P-ROLLBACK-OWNERSHIP | E2 | — | manage-tono-node-v2.sh:151 | Restore loses ownership | False positive: `cp -a` preserves ownership |
| P-TEMP-CONFIG | E2 | — | manage-tono-node-v2.sh:285 | Edit failure leaves partial live config | False positive: staged validation precedes atomic rename |
| P-INTENT-ORDER | E2 | — | provision-tono-node.py:189 | Remote mutation precedes local intent | False positive: durable intent written first |
| P-SINGLE-FAILURE-RESTORE-OUTAGE | E2 | — | manage-tono-node-v2.sh:150 | One failure necessarily loses live config | False positive: proposed path requires two independent failures |
| HA-GENERATION | E2 | — | report_example.py:497 | Reset above watermark loses usage | Duplicate: issue #5 |
| HA-REPORT-400 | E2 | — | report_example.py:604 | Permanent refusal wedges queue | Duplicate: #899 |
| T2-HY2-HOME-UDP | T2 | — | runtime.rs:275 | Home UDP falls through to selected exit | Duplicate: WIN-HY2-HOME-UDP-LEAK |
| MIGRATE-CURRENT-RESTORE | E2 | — | migrate-node-to-release-layout.sh:77 | Failed link switch strands node | Duplicate: #845 |
| MIGRATE-STALE-CONFIG | E2 | — | migrate-node-to-release-layout.sh:63 | Migration activates stale configuration | Duplicate: #913 |
| TCP-TUNE-FALSE-SUCCESS | E2 | — | tune-tono-tcp.sh:77 | Tuning reports ineffective settings | Duplicate: #910 |
| PROVISION-REPO-ROOT | E2 | — | provision-tono-node.py:20 | Wrong repository root | Duplicate: #842 |

All nine PRs merged with merge commits and green `ci-gate`; auto-merge was requested for each. **`needs-hardware`: #995, #996, #997.** All others are unlabeled. Records PRs: [#1011](https://github.com/raydocs/tono/pull/1011), [#1018](https://github.com/raydocs/tono/pull/1018), [#1035](https://github.com/raydocs/tono/pull/1035).

Combined verification on main passed **27 fixtures**. Hosted Ruby passed **12 tests / 141 assertions**, without failures, errors or skips. Local full Python provisioner testing had one missing-SSH environment error; hosted Services passed.

Unfinished: real-device HY2 and VPS restart/rollback acceptance; safe peer-history retention design; unqualified benchmark sample-phase resource-exhaustion cleanup. No real hosts, deployment or publication were touched.