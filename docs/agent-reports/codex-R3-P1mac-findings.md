# R3-P1mac: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 00:54 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1048 | hunt/sol-r3p1m-ai-failure-hold | needs-hardware | yes | fix(macos): retain AI hold after exhausted connection failure |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| MAC-APP-FAILURE-AI-HOLD | macOS app/helper | P1 | apps/macos/Tono/Services/AppState+Connect.swift:2259 | Exhausted automatic failure uses explicit disarm and deletes AI hold | real-fixed #1048 merged; ci-gate green; needs-hardware |
| MAC-DASHSCOPE-DIRECT-COVERAGE | macOS/shared policy | P1 | apps/macos/Tono/Core/ConfigPipeline.swift:114 | Dedicated model API hosts match Alibaba DIRECT suffix and lack recovery hold | real-unfixed coordinated policy migration and recovery helper edits required; helper edits forbidden for this finding |
| MAC-AI-HOLD-DELIBERATE-RELEASE | macOS decisions | — | docs/decisions/031-2026-09-30-fail-open-keeps-ai-block.md:4 | Automatic full AI release might be deliberate | false-positive owner decisions require selective hold |
| MAC-AI-HOLD-WATCHDOG-REPAIR | macOS helper | — | tooling/scripts/core-helper/KillSwitchManager.swift:579 | Watchdog might reapply AI hold after explicit disarm | false-positive disarm deletes intent so watchdog cannot restore it |
| MAC-AI-HOLD-1043-DUPLICATE | macOS app | — | apps/macos/Tono/Services/AppState+Connect.swift:2266 | Retry owner PR might already fix AI release | false-positive #1043 only cancels and fences retry; no preserving wire intent |
| MAC-DASHSCOPE-ALL-TUN-DIRECT | macOS routing | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:224 | Every default TUN model API request might use DIRECT | false-positive proved only hostname-bearing proxy path; hostname may already be lost in TUN |
