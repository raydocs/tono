| ID | area | severity | file:line | description | verdict |
|---|---|---|---|---|---|
| MAC-DASHSCOPE-DIRECT-COVERAGE | Shared policy / macOS / Windows | P1 | apps/macos/Tono/Core/ConfigPipeline.swift:114 | Dedicated model APIs match Alibaba DIRECT and are omitted from recovery holds | Fixed in #1084; merged 6c6d1589 through green CI |
| CI-WINDOWS-REPORT-AUX | Windows CI / archived reports | P2 engineering | docs/agent-reports/2026-10-01-orchestration/scripts/merge-manager/aux.sh:1 | Windows refuses reserved basename during checkout | Fixed by other owner in #1108; reported as #1100 |
| FP-1050-SCHEMA | Control plane | — | services/control-plane/src/traffic-policy.ts:5 | Assistant carveout needs a new signed wire field | False positive: classification is compiled; no schema migration needed |
| FP-1050-GENERAL-PARENT | Shared validation | — | services/control-plane/src/traffic-policy.ts:341 | Alibaba preservation requires general parent exemptions | False positive: only exact Alibaba parent with four reviewed API families is needed |

PR #1084: https://github.com/raydocs/tono/pull/1084
Branch: hunt/sol-r4i1050-dashscope-policy
Head: 48188529 (merge executor integrated main; helper 4.52.20/hash reverified)
Non-draft; needs-hardware applied; merge-commit auto-merge completed at 2026-10-01T06:17:28Z. Merge commit 6c6d1589172df83d3de6bc0181ec88b3368157ba. Issue #1050 closed.
CI: https://github.com/raydocs/tono/actions/runs/36822657184 (PASS on 48188529; every relevant platform job and ci-gate green). Prior run 36820734641 built the app/helper and passed all three new DashScope XCTest regressions; one existing global evaluation-count assertion failed and was corrected. External Windows checkout blocker #1100 fixed on main by #1108.

Local checks: control-plane typecheck and 975-test full coverage suite; tono-core 347 tests; actual service selective_fail_open tests 5; exact production recovery Rust test 5; signed-policy contract 5/5; diff check. New runnable regressions failed before and passed after.

False positives: 2. Total hypotheses: 4 (including the external CI blocker). Existing #1016 finding continued, no duplicate finding created.
Native CI also passed: Windows app/service/WFP/DNS checks, macOS policy/helper/PF checks, full XCTest (543 tests, one existing skip, zero failures), fixed-core runtime validation. Unfinished: end-to-end device acceptance, deferred per user instruction and tracked by needs-hardware. No deploy/publish.
