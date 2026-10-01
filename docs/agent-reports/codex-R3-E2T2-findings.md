# R3-E2T2: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 22:59 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 995 | hunt/sol-r3ops-hy2-catalog-spki | needs-hardware | yes | fix(provision): retain HY2 SPKI pins in catalog sources |
| 996 | hunt/sol-r3ops-journal-verification | needs-hardware | yes | fix(provision): verify journal records without banner failures |
| 997 | hunt/sol-r3ops-rollback-file-mode | needs-hardware | yes | fix(provision): restore live artifact permissions on rollback |
| 998 | hunt/sol-r3ops-bench-cache-publication | none | yes | fix(connect-bench): recover executable caches after interrupted extraction |
| 1000 | hunt/sol-r3ops-bench-startup-cleanup | none | yes | fix(connect-bench): stop core children after failed startup |
| 1002 | hunt/sol-r3ops-provision-pending-recovery | none | yes | fix(provision): persist recovered pending transaction completion |
| 1011 | hunt/sol-r3ops-audit-report | none | yes | docs(audit): record E2/T2 findings and peer history limit |
| 1018 | hunt/sol-r3ops-audit-receipts | none | yes | docs(audit): record hosted E2/T2 receipts and merged fixes |
| 1035 | hunt/sol-r3ops-final-delivery | none | yes | docs(audit): record six merged E2/T2 fixes and final verification |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| HY2-PROVISION-SPKI | E2 | P1 | tooling/scripts/provision-reality-node.rb:445 | Provisioned HY2 source discards SPKI required by macOS | real-fixed #995; merged 140b5d9f, ci-gate passed |
| PROVISION-JOURNAL-BANNER | E2 | P2 | tooling/scripts/remote/manage-tono-node-v2.sh:328 | No-entry journal banner rejects healthy restart; unreadable journal is accepted | real-fixed #996; merged 72a9c98d, ci-gate passed |
| PROVISION-ROLLBACK-MODE | E2 | P2 | tooling/scripts/remote/manage-tono-node-v2.sh:151 | Immutable snapshot permissions make writable-config rollback verification fail | real-fixed #997; merged 857b9e73, ci-gate passed |
| CONNECT-BENCH-PARTIAL-CACHE | T2 | P2 | tooling/perf/connect-bench/bench.py:127 | Interrupted extraction poisons executable cache reused on retry | real-fixed #998; merged 7e5c333a, ci-gate passed |
| CONNECT-BENCH-STARTUP-ORPHAN | T2 | P2 | tooling/perf/connect-bench/bench.py:571 | Failed startup leaves benchmark child running and log open | real-fixed #1000; merged 08aac566, ci-gate passed |
| PROVISION-PENDING-SUCCESS-DURABILITY | E2 | P2 | tooling/scripts/provision-tono-node.py:182 | Recovered remote success remains pending on disk and blocks enrollment | real-fixed #1002; merged 156a2536, ci-gate passed |
| HOME-AGENT-PEER-RETENTION-CAP | E2 | P2 | services/home-agent/report_example.py:148 | Lifetime peer baselines exceed 2000 cap and stop all fresh reports | real-unfixed; safe retention needs counter-continuity design, reporter undeployed |
| HA-SERVER-AHEAD | E2 | — | services/home-agent/report_example.py:478 | Server watermark ahead discards ambiguous raw history | false-positive; deliberate recovery prevents double billing |
| HA-POST-CRASH | E2 | — | services/home-agent/report_example.py:652 | Crash after POST could duplicate charges | false-positive; immutable batch replay and server watermarks deduplicate |
| HA-DISK-ACK | E2 | — | services/home-agent/report_example.py:703 | Lost disk update could acknowledge unrecorded usage | false-positive; atomic durable save precedes POST and metering ACK |
| HA-OVERLAP | E2 | — | services/home-agent/report_example.py:278 | Overlapping timers can mutate accounting concurrently | false-positive; nonblocking flock covers the whole invocation |
| HA-CROSS-USER | E2 | — | services/home-agent/report_example.py:493 | Stable node identity could charge a different account | false-positive; explicit persisted-user identity guard and existing regression |
| HA-REPLAY-ACK | E2 | — | services/home-agent/report_example.py:657 | Pending replay omits a metering ACK | false-positive; replay is not a new observation and must not acknowledge one |
| HA-UNBOUNDED-DELIVERY | E2 | — | services/home-agent/report_example.py:621 | Bad networks keep the delivery loop retrying indefinitely | false-positive; 20s request timeout, network errors propagate, permanent-refusal batches shrink and isolate |
| HA-GENERATION | E2 | — | services/home-agent/report_example.py:497 | Counter reset above the prior watermark can lose usage | duplicate; open issue #5 counter-generation design |
| HA-REPORT-400 | E2 | — | services/home-agent/report_example.py:604 | A permanently refused report wedges the queue | duplicate; #899 refusal isolation is already on main |
| T2-PIN-DRIFT | T2 | — | tooling/scripts/prepare-macos-sing-box.sh:42 | Prepared binary may not match the committed product pin | false-positive; manifest, binary, source and toolchain pins agree |
| T2-CANDIDATE-CORE | T2 | — | tooling/scripts/sing-box/certify.py:114 | Candidate certification may silently replace the product binary | false-positive; explicit offline candidate is independent of pinned product packaging |
| T2-LDFLAGS | T2 | — | tooling/scripts/sing-box/certify.py:177 | Missing linker metadata could accept unknown product bytes | false-positive; exact binary digest and committed manifest bind the bytes |
| T2-ADAPTIVE-HASH | T2 | — | tooling/scripts/build-mihomo-adaptive.sh:136 | Adaptive binary digest varies between builds | false-positive; intentional timestamp variance, source/dependency pins and identity gates remain |
| T2-ADAPTIVE-WINDOWS | T2 | — | tooling/scripts/build-mihomo-adaptive.sh:163 | Adaptive Windows build omits the alpha sidecar | false-positive; alpha sidecar is intentionally excluded from stable packaging |
| T2-STOCK-IDENTITY | T2 | — | tooling/scripts/build-mihomo-adaptive.sh:64 | Stock binary could pass as the adaptive build | false-positive; prebuild gate refuses stock or mismatched identity |
| T2-BUFFER-BOUND | T2 | — | tooling/scripts/mihomo-adaptive/gvisor-adaptive-buffer.patch:22 | Adaptive buffer could grow without bound | false-positive; hard 128 KiB maximum |
| T2-BENCH-DIRECT | T2 | — | tooling/perf/connect-bench/bench.py:721 | Generated config could send customer AI traffic DIRECT | false-positive; loopback-only server fixture, client final proxy, no product emitter uses it |
| T2-MISSING-ROWS | T2 | — | tooling/perf/connect-bench/bench.py:82 | Missing benchmark profile could falsely pass the check | false-positive; driver emits checked profiles including failures and missing metrics fail |
| T2-HY2-HOME-UDP | T2 | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:275 | HY2 home UDP falls through to the selected exit | duplicate; known WIN-HY2-HOME-UDP-LEAK, Windows product uses mihomo |
| H2-AUTH-DEPENDENCY | E2 | — | tooling/scripts/remote/manage-tono-hy2-node.sh:290 | Auth checker crash may permanently stop HY2 | false-positive; Requires does not propagate spontaneous failure and checker restarts |
| H2-BINARY-PIN | E2 | — | tooling/scripts/provision-reality-node.rb:188 | Downloaded node binary may be unverified | false-positive; pinned archive digest plus uploaded remote binary digest |
| H2-XRAY-LOSS | E2 | — | tooling/scripts/remote/manage-tono-hy2-node.sh:595 | HY2 install might replace or stop active Xray | false-positive; separate service and existing-install refusal, unchanged Xray PID and config hash |
| H2-SSH-HANG | E2 | — | tooling/scripts/provision-reality-node.rb:98 | Unbounded SSH wait might take customer lines offline | false-positive; no client routes owned and existing services continue during the wait |
| H2-CONFIG-WRITE | E2 | — | tooling/scripts/remote/manage-tono-hy2-node.sh:363 | Roster write failure might destroy live auth config | false-positive; ordinary write failure restores backup; abrupt-kill window not proved as a non-race defect |
| H2-MANAGED-ROSTER | E2 | — | tooling/scripts/remote/manage-tono-hy2-node.sh:137 | Static sync may overwrite managed identities | false-positive; managed roster marker refuses this operation |
| H2-FIRST-UUID | E2 | — | tooling/scripts/remote/manage-tono-hy2-node.sh:143 | Only the first VLESS identity may receive HY2 auth | false-positive; every identity enters the hashed HTTP-auth allowlist |
| H2-HTTP-STALLED | E2 | — | tooling/scripts/remote/manage-tono-hy2-node.sh:274 | Remote slow client may hang the auth HTTP server | false-positive; listener is localhost-only and no customer partial-request path is reachable |
| H2-YAML-PLACEHOLDER | E2 | — | tooling/scripts/provision-reality-node.rb:443 | Quoted identity placeholder might be lost at publication | false-positive; publisher preserves quoted placeholder values |
| H2-ACTIVE-OVERWRITE | E2 | — | tooling/scripts/provision-reality-node.rb:372 | Provisioning might silently reinstall an active core | false-positive; explicit existing-install refusal |
| H2-UFW-UDP | E2 | — | tooling/scripts/remote/manage-tono-reality-node.sh:92 | Ordinary provisioning may unexpectedly alter UDP firewall rules | false-positive; HY2 is explicit opt-in and this path has no firewall mutation |
| P-EXTEND-ENROLL | E2 | — | tooling/scripts/provision-tono-node.py:176 | Extend mode cannot enroll without public-key metadata | false-positive; explicit documented refusal in NODE_PROVISIONING.md:70 |
| P-ZIP-TRAVERSAL | E2 | — | tooling/scripts/provision-tono-node.py:140 | Xray archive can write traversal paths | false-positive; only the exact xray member is read, no unrestricted extraction |
| P-ROLLBACK-OWNERSHIP | E2 | — | tooling/scripts/remote/manage-tono-node-v2.sh:151 | Snapshot restore loses live file ownership | false-positive; cp -a preserves ownership, fixture confirms mode is the distinct defect |
| P-TEMP-CONFIG | E2 | — | tooling/scripts/remote/manage-tono-node-v2.sh:285 | Config edit error leaves a partial live config | false-positive; staged generation and validation precede atomic live rename |
| P-INTENT-ORDER | E2 | — | tooling/scripts/provision-tono-node.py:189 | Crash can mutate remote host before recording local intent | false-positive; durable pending record precedes upload and remote mutation |
| P-SINGLE-FAILURE-RESTORE-OUTAGE | E2 | — | tooling/scripts/remote/manage-tono-node-v2.sh:150 | One ordinary failure necessarily loses the live config during rollback | false-positive; the proposed path requires failed apply plus independent restore-copy failure |
| MIGRATE-CURRENT-RESTORE | E2 | — | tooling/scripts/remote/migrate-node-to-release-layout.sh:77 | Failed current-link switch might strand the node | duplicate; #845 rollback guard is already on main |
| MIGRATE-STALE-CONFIG | E2 | — | tooling/scripts/remote/migrate-node-to-release-layout.sh:63 | Migration might activate stale staged config | duplicate; #913 restaging and comparison is already on main |
| TCP-TUNE-FALSE-SUCCESS | E2 | — | tooling/scripts/remote/tune-tono-tcp.sh:77 | TCP tuning might report success without live settings | duplicate; #910 checks effective live values |
| PROVISION-REPO-ROOT | E2 | — | tooling/scripts/provision-tono-node.py:20 | Provisioner resolves the wrong repository root | duplicate; #842 corrected parents[2] on main |
