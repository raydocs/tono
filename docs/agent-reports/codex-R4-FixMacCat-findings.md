# R4-FixMacCat: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:22 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1149 | hunt/sol-r4fmc-policy-pending | needs-hardware | yes | fix(macos): retain accepted policies behind busy runtime mutations |
| 1158 | hunt/sol-r4fmc-catalog-removal-pending | needs-hardware | yes | fix(macos): retain catalog removal convergence behind runtime owners |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4FMC-MAC-BUSY-POLICY | macOS policy | P2 | AppState.swift:1867 | Accepted policy lost behind runtime owner | real-fixed #1149 |
| R4FMC-MAC-BUSY-CATALOG-REMOVAL | macOS catalog | P2 | AppState+Catalog.swift:336 | Catalog removal lost behind active owner | real-fixed #1158 |
| PIN-REFRESH-REVOKE | macOS policy | P2 | AppState+Catalog.swift:907 | Old DNS resolution can restore revoked grants | duplicate of #1153 |
