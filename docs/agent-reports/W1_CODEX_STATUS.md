# W1/W2/R3/R4 Codex status (executor, Codex account 2)

- Updated 2026-09-30 22:59 MT. Times are America/Denver (MT). Account-2 weekly quota used: 4.0% (launch cap 100%; the user applied a reset card at 22:54 MT, so account 2 restarted from 0% and round R4 began).
- Engine: Codex CLI 0.159.2, `gpt-6.1-sol`, reasoning `ultra`, `--enable multi_agent_v2`, workspace-write sandbox with network; one clone per slot off latest origin/main. Codex commits, pushes its own `hunt/*` branch, opens the PR and requests auto-merge (merge commit); the merge manager toggles auto-merge off for queueing.
- Cursor cloud agents: the 3 Sol agents (sol-cp bc-d5e5286f, sol-win-app bc-b9060197, sol-win-trust bc-49535359) died with no pushed branch or PR; their leads were passed to the Codex runs. The Grok 4.7 agents own grok-mac-config, grok-mac-runtime, grok-win-svc, grok-win-wfp, qg (W1) and grok-helper, grok-win-app, grok-agents (W2).
- Per-slot findings: `codex-<slot>-findings.md` next to this file. Findings counts are the hunter's own verdicts (real = verified real, fixed or not).
- R4 (from 22:55 MT): fresh clones of origin/main after ~230 merges tonight. Focus: regressions/interaction bugs in fail-open/AI-block, DNS/PF/WFP restore, update/install, node switching; thin COVERAGE areas; re-scans of the highest-bug areas. Unfixed real bugs now get GitHub issues (#1050 DashScope DIRECT leak, #1051 Windows automatic release delay, #1052 macOS Quit AI-hold decision, #1054 Windows unarmed-probe arm/release loop; grouped P2/P3 issues #1055-#1059). Fix slots queued for #1050, #1051, #1054.

| Slot | Account | State | Started | Finished | Findings | PRs |
|---|---|---|---|---|---|---|
| W1-sol-cp | Codex acct 2 | done (12 fixes merged) | 17:54 | 19:50 | 18 real / 38 FP / 4 dup | #821 #832 #839 #865 #883 #890 #903 #918 #924 #931 #938 #947 |
| W1-sol-win-app | Codex acct 2 | done (8 fixes; 3 runs due to content-filter stops) | 17:54 | 20:31 | 9 real / 87 FP / 11 dup | #820 #828 #898 #916 #932 #951 #980 #984 |
| W1-sol-win-trust | Codex acct 2 | done (7 fixes; run 2 was an extra pass over newly merged code) | 17:54 | 20:55 | 7 real / 73 FP / 9 dup | #PR#843 #PR#873 #PR#912 #PR#933 #PR#955 #PR#983 #PR#990 |
| W2-sol-leftovers | Codex acct 2 | done (13 fixes; #969 test fix pushed by operator) | 17:54 | 19:53 | 20 real / 57 FP / 3 dup | #818 #823 #825 #834 #848 #869 #880 #892 #915 #957 #965 #968 #969 |
| R3-W1hi | Codex acct 2 | done (5 fixes) | 19:34 | 20:52 | 5 real / 10 FP / 11 dup | #974 #976 #978 #986 #988 |
| R3-W5gap | Codex acct 2 | done (4 fixes) | 19:54 | 20:50 | 4 real / 21 FP / 4 dup | #982 #985 #987 #989 |
| R3-W3W9gap | Codex acct 2 | done (5 fixes + report PR; 1 real-unfixed) | 20:19 | ~21:58 | 7 real / 18 FP / 4 dup | #994 #999 #1004 #1012 #1022 #1026 |
| R3-M10gap | Codex acct 2 | done (2 fixes) | 20:19 | 20:54 | 2 real / 22 FP / 3 dup | #991 #993 |
| R3-E2T2 | Codex acct 2 | done (6 fixes + 3 report PRs; 1 real-unfixed) | 20:31 | 22:13 | 7 real / 33 FP / 7 dup | #995 #996 #997 #998 #1000 #1002 #1011 #1018 #1035 |
| R3-M6M8 | Codex acct 2 | done (1 fix, 1 decision item) | 20:47 | 21:12 | 2 real / 28 FP / 6 dup | #1001 |
| R3-A2A4 | Codex acct 2 | done (2 fixes) | ~20:50 | ~21:30 | 2 real / 25 FP / 10 dup | #1003 #1010 |
| R3-W4W7 | Codex acct 2 | done (5 fixes) | ~20:52 | 22:07 | 5 real / 22 FP / 9 dup | #1005 #1007 #1014 #1017 #1025 |
| R3-M9M11 | Codex acct 2 | done (1 fix + 2 findings-record PRs) | 20:55 | 21:35 | 3 real / 22 FP / 5 dup | #1008 #1016 #1019 |
| R3-C4E1 | Codex acct 2 | done (2 fixes, 1 decision item) | 20:55 | 21:28 | 3 real / 35 FP / 3 dup | #1009 #1015 |
| R3-W1lo | Codex acct 2 | done (3 fixes) | 21:13 | 22:12 | 5 real / 17 FP / 7 dup | #1021 #1024 #1029 |
| R3-A11 | Codex acct 2 | done (0 real; 34 FP, 8 dup) | 21:22 | 21:35 | 0 real / 34 FP / 8 dup | |
| R3-M5M7 | Codex acct 2 | done (0 fixes; 1 real-unfixed, 3 unverified) | 21:28 | 21:39 | 1 real / 22 FP / 8 dup | |
| R3-W2W3 | Codex acct 2 | done (1 fix, 1 decision item) | 21:36 | 22:19 | 2 real / 28 FP / 5 dup | #PR#1032 |
| R3-M12 | Codex acct 2 | done (1 fix) | 21:36 | 21:55 | 1 real / 31 FP / 4 dup | #1027 |
| R3-M1M3 | Codex acct 2 | done (3 helper fixes; 1 app-side real-unfixed handed to R3-P1mac) | 21:39 | 22:39 | 5 real / 16 FP / 9 dup | #1028 #1030 #1033 |
| R3-MacQuitHold | Codex acct 2 | done (decision item, docs PR #1031, Quit behavior unchanged) | 21:53 | 22:01 | 1 real / 2 FP / 0 dup | #1031 |
| R3-A5A6 | Codex acct 2 | running (Windows catalog sync/offline grant/account/update handoff/quit) | 21:56 |  | 7 real / 17 FP / 8 dup | #1036 #1038 #1045 #1047 |
| R3-RegWin | Codex acct 2 | running (regression review of tonight's merged Windows fixes) | 22:01 |  | 18 real / 27 FP / 4 dup | #1037 #1040 #1044 |
| R3-RegMac | Codex acct 2 | done (49 merged macOS PRs reviewed; 2 regression fixes) | 22:08 | 22:44 | 4 real / 90 FP / 4 dup | #1039 #1043 |
| R3-W9inst | Codex acct 2 | done (1 fix) | 22:13 | 22:44 | 3 real / 11 FP / 3 dup | #1042 |
| R3-P1mac | Codex acct 2 | done: 1 fix (#1048 merged); DashScope unfixed -> issue #1050 | 22:36 |  | 2 real / 4 FP / 0 dup | #1048 |
| R3-P1win | Codex acct 2 | done: docs decision #1046; unfixed P1/P2 -> issue #1051 | 22:36 |  | 2 real / 3 FP / 1 dup | #1046 |
| R4-FailOpen | Codex acct 2 | running | 22:55 |  | 0 real / 0 FP / 0 dup | |
| R4-RestoreDNS | Codex acct 2 | running | 22:55 |  | 0 real / 0 FP / 0 dup | |
| R4-UpdateInstall | Codex acct 2 | running | 22:55 |  | 0 real / 0 FP / 0 dup | |
| R4-Switch | Codex acct 2 | running | 22:56 |  | 0 real / 0 FP / 0 dup | |
| R4-RegCP | Codex acct 2 | running | 22:56 |  | 0 real / 0 FP / 0 dup | |
| R4-KSdeep | Codex acct 2 | running | 22:56 |  | 0 real / 0 FP / 0 dup | |
| R4-Issue1050 | Codex acct 2 | queued |  |  | 0 real / 0 FP / 0 dup | |
| R4-Issue1051 | Codex acct 2 | queued |  |  | 0 real / 0 FP / 0 dup | |
| R4-WinAppDeep | Codex acct 2 | queued |  |  | 0 real / 0 FP / 0 dup | |
| R4-MacHelperDeep | Codex acct 2 | queued |  |  | 0 real / 0 FP / 0 dup | |
| R4-WinTS | Codex acct 2 | queued |  |  | 0 real / 0 FP / 0 dup | |
| R4-CPcore | Codex acct 2 | queued |  |  | 0 real / 0 FP / 0 dup | |

Notes
- W1-sol-win-trust and W1-sol-win-app runs were each cut once by an OpenAI "possible cybersecurity risk" content filter; they were relaunched with reliability-framed prompts and continued from their findings files.
- W1 grok-mac-runtime / grok-win-svc / grok-win-wfp were briefly claimed by this executor at 17:51 MT and stopped within a minute (no work); they belong to the Grok cloud agents.
