# R3-E2T2: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 21:05 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 995 | hunt/sol-r3ops-hy2-catalog-spki | needs-hardware | yes | fix(provision): retain HY2 SPKI pins in catalog sources |
| 996 | hunt/sol-r3ops-journal-verification | none | yes | fix(provision): verify journal records without banner failures |
| 997 | hunt/sol-r3ops-rollback-file-mode | none | yes | fix(provision): restore live artifact permissions on rollback |
| 998 | hunt/sol-r3ops-bench-cache-publication | none | yes | fix(connect-bench): recover executable caches after interrupted extraction |
| 1000 | hunt/sol-r3ops-bench-startup-cleanup | none | yes | fix(connect-bench): stop core children after failed startup |
| 1002 | hunt/sol-r3ops-provision-pending-recovery | none | yes | fix(provision): persist recovered pending transaction completion |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| HY2-PROVISION-SPKI | E2 | P1 | tooling/scripts/provision-reality-node.rb:445 | HY2 private catalog drops remote SPKI pin so macOS cannot use provisioned HY2 | real-fixed #995; documented integration gap, CI pending |
| PROVISION-JOURNAL-BANNER | E2 | P2 | tooling/scripts/remote/manage-tono-node-v2.sh:328 | Empty journal banner fails healthy restart verification and triggers rollback | real-fixed #996; 3 regressions passed |
| HOME-AGENT-PEER-RETENTION-CAP | E2 | P2 | services/home-agent/report_example.py:148 | Lifetime retained peer baselines exceed 2000 cap and stop all reports | real-unfixed safe pruning needs counter-continuity design; undeployed reporter |
| CONNECT-BENCH-PARTIAL-CACHE | T2 | P2 | tooling/perf/connect-bench/bench.py:127 | Interrupted extraction leaves final cache executable permanently reused on retry | real-fixed #998; 3 tests passed |
| CONNECT-BENCH-STARTUP-ORPHAN | T2 | P2 | tooling/perf/connect-bench/bench.py:571 | Controller startup failure leaks live benchmark core subprocess | real-fixed #1000; 7 combined tests passed |
| PROVISION-ROLLBACK-MODE | E2 | P2 | tooling/scripts/remote/manage-tono-node-v2.sh:151 | Readonly snapshot mode restored onto live artifact so rollback verification always rejects original writable config | real-fixed #997; 2 regressions passed |
| PROVISION-PENDING-SUCCESS-DURABILITY | E2 | P2 | tooling/scripts/provision-tono-node.py:182 | Crash before final local write leaves healthy remote provisioning permanently pending and unable to enroll | real-fixed #1002; Flow8+CI7 passed; fullsuite SSH environment error |
