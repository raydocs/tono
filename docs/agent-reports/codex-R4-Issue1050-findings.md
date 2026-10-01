# R4-Issue1050: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 02:55 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1084 | hunt/sol-r4i1050-dashscope-policy | needs-hardware | yes | fix(policy): protect DashScope APIs across routing and recovery |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| MAC-DASHSCOPE-DIRECT-COVERAGE | shared policy / macOS / Windows | P1 | apps/macos/Tono/Core/ConfigPipeline.swift:114 | Dedicated DashScope/Qwen API hosts fall through Alibaba DIRECT and are absent from recovery holds | real-fixed #1084; merged 6c6d1589 after complete CI green on 48188529; needs-hardware, auto-merge MERGE completed |
| FP-1050-SCHEMA | control plane | — | services/control-plane/src/traffic-policy.ts:5 | Assistant carveout requires a new signed-policy wire field | false-positive assistant classifications are compiled into canonical validation and emitters; no schema/signature migration needed |
| FP-1050-GENERAL-PARENT | shared policy | — | services/control-plane/src/traffic-policy.ts:341 | Permit all DIRECT parents of assistant children to preserve Alibaba routing | false-positive only the reviewed aliyuncs.com parent is needed; other protected-parent overlaps remain rejected |
| CI-WINDOWS-REPORT-AUX | Windows CI / archived reports | P2 engineering | docs/agent-reports/2026-10-01-orchestration/scripts/merge-manager/aux.sh:1 | Reserved DOS basename causes Windows actions/checkout to fail before compilation | real-fixed #1108 (other owner); issue #1100; external Windows checkout blocker |
