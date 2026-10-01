# R4-ReleaseMig: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:50 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1173 | hunt/sol-r4rel-windows-staging | none | yes | fix(tooling): stage Windows release resources before preflight |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4REL-MAC-EXTRACT-METADATA | macOS appcast | — | tooling/scripts/publish-macos-appcast.mjs:93 | Appcast extraction changes UNIX metadata | false-positive current main no longer embeds Sparkle; current-bundle codesign refusal unproven |
| R4REL-WIN-PREFLIGHT-ORDER | Windows release build | P1 | tooling/scripts/build-windows-release.ps1:59 | Release preflight requires generated Service resources before build creates them | real-fixed #1173 (auto-merge enabled) |
