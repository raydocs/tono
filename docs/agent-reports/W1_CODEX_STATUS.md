# W1/W2/R3 Codex status (executor, Codex account 2)

- Maintained by the Codex executor on the box. Times are America/Denver (MT).
- Engine: Codex CLI 0.159.2, `gpt-6.1-sol`, reasoning `ultra`, `--enable multi_agent_v2`, workspace-write sandbox with network; one clone per slot off latest origin/main (`/workspace/w1-codex/{gd,wt}/<slot>`). Codex commits, pushes its own `hunt/*` branch and opens the PR; the executor audits labels/auto-merge.
- Account-2 weekly quota at first launch (17:52): 21%. Cap: stop launching at ~97% (user raised it from 75%).
- Cursor cloud agents: the 3 Sol agents (sol-cp bc-d5e5286f, sol-win-app bc-b9060197, sol-win-trust bc-49535359) died with no pushed branch or PR; their leads were passed to the Codex runs. The Grok 4.7 agents (grok-mac-config, grok-mac-runtime, grok-win-svc, grok-win-wfp, qg) are alive and own those slots (qg opened #803).

| Slot | Account | State | Started | Finished | Findings (real / FP) | PRs |
|---|---|---|---|---|---|---|
| W1-sol-cp | Codex acct 2 | running | 17:56 | | | |
| W1-sol-win-app | Codex acct 2 | running | 17:56 | | | |
| W1-sol-win-trust | Codex acct 2 | running | 17:56 | | | |
| W2-sol-leftovers | Codex acct 2 | running | 17:56 | | | |
| W1-grok-mac-config | Grok cloud agent | held by Grok | | | | |
| W1-grok-mac-runtime | Grok cloud agent | held by Grok (Codex claim at 17:51, stopped <1 min, no work) | | | | |
| W1-grok-win-svc | Grok cloud agent | held by Grok (Codex claim at 17:51, stopped <1 min, no work) | | | | |
| W1-grok-win-wfp | Grok cloud agent | held by Grok (Codex claim at 17:51, stopped <1 min, no work) | | | | |
| W1-qg | Grok cloud agent | held by Grok (#803) | | | | |
| R3 queue (next) | Codex acct 2 | queued: M4, W6, W8, A1, A7, A8, A9, A12, C8, T1 | | | | |
