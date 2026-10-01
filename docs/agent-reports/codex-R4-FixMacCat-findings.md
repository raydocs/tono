# R4-FixMacCat: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:50 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1149 | hunt/sol-r4fmc-policy-pending | needs-hardware | yes | fix(macos): retain accepted policies behind busy runtime mutations |
| 1158 | hunt/sol-r4fmc-catalog-removal-pending | needs-hardware | yes | fix(macos): retain catalog removal convergence behind runtime owners |
| 1167 | hunt/sol-r4fmc-hy2-relist-spki | needs-hardware | yes | fix(control-plane): preserve HY2 authentication pins during relist |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4FMC-MAC-BUSY-POLICY | macOS policy | P2 | AppState.swift:1867 | Accepted policy lost behind runtime owner | real-fixed #1149 |
| R4FMC-MAC-BUSY-CATALOG-REMOVAL | macOS catalog | P2 | AppState+Catalog.swift:336 | Catalog removal lost behind active owner | real-fixed #1158 |
| PIN-REFRESH-REVOKE | macOS policy | P2 | AppState+Catalog.swift:907 | Old DNS resolution can restore revoked grants | duplicate of #1153 |
| R4FMC-CP-RELIST-SPKI | control-plane catalog | P2 | ops/reads/fleet.ts:367 | Relist strips macOS HY2 SPKI pin | real-fixed #1167 |
| MAC-WEB-PINS-SUFFIX-STALE | macOS config | P2 | AppState+Connect.swift:1734 | Suffix presence prevents refresh of still-used exact web pins | real-unfixed #1057 coordinated live DNS/pin design required; re-enabling full reload disrupts streams |
| R3CONN-DEC01 | macOS DNS | P2 design | AppState+Connect.swift:2568 | Supplemental DNS conflict tears down and holds general PF | real-unfixed #1057 documented product disposition; selective release plus truthful UI needs decision |
| R4FMC-MAC-PINS-COMMIT-BLOCK | macOS pins | P1 | AppState+Proxy.swift:705 | Successful pins replacement with missing tunnel preserves PF and dead DNS | real-verified preparing selective-release fix |
