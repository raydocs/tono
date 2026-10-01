# R4-ReleaseMig: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 02:55 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1173 | hunt/sol-r4rel-windows-staging | none | yes | fix(tooling): stage Windows release resources before preflight |
| 1179 | hunt/sol-r4rel-macos-offline-signer | none | yes | fix(tooling): acquire the local macOS signer independently |
| 1184 | hunt/sol-r4rel-preview-migrations | none | yes | fix(tooling): rehearse D1 restore with generated preview config |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4REL-MAC-EXTRACT-METADATA | macOS appcast | — | tooling/scripts/publish-macos-appcast.mjs:93 | Appcast extraction changes UNIX metadata | false-positive current main no longer embeds Sparkle; current-bundle codesign refusal unproven |
| R4REL-WIN-PREFLIGHT-ORDER | Windows release build | P1 | tooling/scripts/build-windows-release.ps1:59 | Release preflight requires generated Service resources before build creates them | real-fixed #1173 (auto-merge enabled) |
| R4REL-MAC-OFFLINE-SIGNER | macOS release | P1 | tooling/scripts/release-macos.sh:272 | Local release resolves an empty App package graph to fetch the required offline signer | real-fixed #1179 (auto-merge enabled) |
| R4REL-PREVIEW-GENERATED-MIGRATIONS | D1 preview restore | P2 | tooling/scripts/restore-control-plane-d1-preview.sh:230 | Restore ignores the generated preview config and silently skips pending migrations | real-fixed #1184 (auto-merge enabled) |
| R4REL-UPLOAD-GLOB | release asset upload | P3 | tooling/scripts/upload-release-asset.mjs:96 | Documented installer glob option filters by substring and rejects matching names | real-unfixed optional CLI bug, issue planned |
