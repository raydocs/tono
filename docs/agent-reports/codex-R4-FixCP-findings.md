# R4-FixCP: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:50 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1170 | hunt/sol-r4fcp-home-bind-retire | needs-hardware | yes | fix(control-plane): fence home binding against fleet retirement |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4CP-RETIRE-RELIST-FENCE | control-plane | P2 | services/control-plane/src/ops/reads/fleet.ts:270 | Retirement token cleanup can revoke a concurrent relist | duplicate of merged #1080; both caller revision fences present on main |
| R4FCP-HOME-BIND-RETIRE | control-plane | P2 | services/control-plane/src/ops/reads/fleet.ts:235 | Concurrent home binding can succeed after fleet retirement | real-fixed #1170; needs-hardware; auto-merge enabled |
