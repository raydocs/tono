# R4-FixMacAI: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:22 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1136 | hunt/sol-r4fma-release-ai-hold | needs-hardware | yes | fix(macos): persist interrupted selective recovery intent |
| 1141 | hunt/sol-r4fma-resolver-ownership | needs-hardware | yes | fix(macos): preserve ownership and originals of selective resolver files |
| 1144 | hunt/sol-r4fma-snapshotless-dns-apply | needs-hardware | yes | fix(macos): activate committed DNS during snapshotless restore retry |
| 1154 | hunt/sol-r4fma-dns-retirement-proof | needs-hardware | yes | fix(macos): retain DNS ownership proof across repeated Disconnect cleanup |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4FMA-INTERRUPTED-AI-RELEASE | macOS helper | P2 | tooling/scripts/core-helper/KillSwitchManager.swift:577 | Interrupted automatic release forgets pending AI hold | real-fixed #1136 |
| R4FMA-RESOLVER-OWNERSHIP | macOS helper | P2 | tooling/scripts/core-helper/SelectiveFailOpen.swift:184 | Selective cleanup overwrites/deletes foreign AI resolver files | real-fixed #1141 |
| R4FMA-SNAPSHOTLESS-APPLY | macOS helper | P2 | tooling/scripts/core-helper/ProtectedDNSManager.swift:356 | Snapshotless restore retry reports success without activation | real-fixed #1144 |
| R4FMA-DUPLICATE-DNS-RESTORE | macOS app/helper | P2 | apps/macos/Tono/Services/AppState+Connect.swift:982 | Second Disconnect DNS restore clears foreign loopback resolver | real-fixed #1154 |
| R4FMA-UPGRADE-AI-HOLD | macOS app | P2 | apps/macos/Tono/Core/HelperManager.swift:258 | Abandoned upgrade explicitly drops automatic AI hold | real-unfixed #1071; legacy helpers lack selective release, retaining PF breaks availability; product/recovery-contract decision |
