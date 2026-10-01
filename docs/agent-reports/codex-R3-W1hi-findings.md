# R3-W1hi: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 19:51 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 974 | hunt/sol-r3ks-recovery-ai-hold | needs-hardware | yes | fix(windows): keep the AI hold after WFP recovery release |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-RECOVERY-AI-HOLD-OMISSION | Windows WFP | P1 | apps/windows/service/src/core/windows_kill_switch.rs:2946 | Crash/corrupt/unhealthy and unproven-Core releases omit the secondary AI hold | real-fixed #974 |
| W1-DIRECT-EXPIRY | Windows WFP | P1 | apps/windows/service/src/core/windows_kill_switch.rs:3428 | Committed DIRECT heartbeat expiry remains exact Blocked | duplicate #777 / #926 |
| W1-WANTED-NO-CORE | Windows WFP | P1 | apps/windows/service/src/core/windows_kill_switch.rs:2800 | Restored wanted block can outlive its Core | duplicate #740 (now merged) |
| W1-LOCK-POISON | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:1910 | ARMED poison can panic lock IPC | duplicate #812 (now merged) |
| W1-STRICT-UNHEALTHY | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:2918 | Strict watchdog eventually releases after unhealthy streak | false-positive explicit existing decision #733; no change |
| W1-INSTALL-AI-HOLD | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:1216 | A failed WFP install removes the existing narrow AI hold | real-unfixed verified; fix next |
| W1-LIVE-CORE-RELEASE | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:2737 | A live broken Core can survive a WFP-only recovery release | real-unfixed needs unavailable App plus broken Core; lifecycle fix beyond narrow recovery helpers |
| W1-DHCP-PERMIT | Windows WFP | — | apps/windows/service/src/core/wfp_model.rs:499 | Infrastructure DHCP/loopback permits bypass deny-all | false-positive bounded intentional infrastructure exceptions; no ordinary AI bypass proved |
| W1-FFI-VALUES | Windows WFP | — | apps/windows/service/src/core/wfp.rs:89 | Condition pointers could move during vector growth | false-positive condition values are boxed and remain heap-pinned |
