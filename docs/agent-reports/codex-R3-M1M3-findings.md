# R3-M1M3: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 22:00 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1028 | hunt/sol-r3helper-failed-barrier-ai-hold | needs-hardware | yes | fix(macos-helper): preserve AI hold after automatic releases |
| 1030 | hunt/sol-r3helper-dns-prefs-contention | needs-hardware | yes | fix(macos-helper): keep DNS lock contention from hanging recovery |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| MAC-FAILED-BARRIER-AI-HOLD | M2 | P1 | tooling/scripts/core-helper/KillSwitchManager.swift:561 | Failed automatic PF commit releases without secondary AI hold | real-fixed #1028 |
| MAC-ORPHAN-BOOTSTRAP-AI-HOLD | M1 | P1 | tooling/scripts/core-helper/SocketServer.swift:328 | Merged orphan crash release omits secondary AI hold | real-fixed #1028 |
| MAC-DNS-PREFS-LOCK | M3 | P1 | tooling/scripts/core-helper/ProtectedDNSManager.swift:974 | DNS preferences lock contention hangs helper and recovery | real-fixed #1030 |
| MAC-DNS-APPLY-RETRY | M3 | P1 | tooling/scripts/core-helper/ProtectedDNSManager.swift:319 | Commit-before-Apply failure makes retry discard DNS recovery without applying | real-unfixed verified; fix in progress |
