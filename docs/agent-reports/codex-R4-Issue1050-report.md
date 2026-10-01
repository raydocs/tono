Merged [#1084](https://github.com/raydocs/tono/pull/1084), closing #1050. Label: `needs-hardware`. Merge-commit auto-merge completed; [all CI checks passed](https://github.com/raydocs/tono/actions/runs/36822657184).

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| MAC-DASHSCOPE-DIRECT-COVERAGE | Shared policy/macOS/Windows | P1 | ConfigPipeline.swift:114 | Dedicated APIs bypassed protection through Alibaba DIRECT and lacked recovery holds | Fixed in #1084 |
| CI-WINDOWS-REPORT-AUX | Windows CI | P2 | Archived merge-manager/aux.sh:1 | Reserved filename prevented Windows checkout | Reported #1100; another owner fixed in #1108 |
| FP-1050-SCHEMA | Control plane | — | traffic-policy.ts:5 | Carveout requires a new signed wire field | False positive: compiled classification suffices |
| FP-1050-GENERAL-PARENT | Validation | — | traffic-policy.ts:341 | All protected-parent overlaps require exemptions | False positive: only the reviewed Alibaba exception is needed |

Local verification passed: control-plane typecheck and 975 tests, tono-core 347 tests, and recovery tests. Native macOS and Windows CI passed. General Alibaba DIRECT remains available.

**2 false positives; 4 hypotheses examined.** Focused source work is complete. Real-device network acceptance remains pending under `needs-hardware`.