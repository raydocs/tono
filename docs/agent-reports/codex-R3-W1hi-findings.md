# R3-W1hi: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 20:05 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 974 | hunt/sol-r3ks-recovery-ai-hold | needs-hardware | yes | fix(windows): keep the AI hold after WFP recovery release |
| 976 | hunt/sol-r3ks-arm-ai-hold | needs-hardware | yes | fix(windows): preserve the AI hold when WFP install fails |
| 978 | hunt/sol-r3ks-update-ai-hold | needs-hardware | yes | fix(windows): keep the AI hold after failed update recovery |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-RECOVERY-AI-HOLD-OMISSION | Windows WFP | P1 | apps/windows/service/src/core/windows_kill_switch.rs:2946 | Crash/corrupt/unhealthy and unproven-Core releases omit the secondary AI hold | real-fixed #974 |
| W1-DIRECT-EXPIRY | Windows WFP | P1 | apps/windows/service/src/core/windows_kill_switch.rs:3428 | Committed DIRECT heartbeat expiry remains exact Blocked | duplicate #777 / #926 |
| W1-WANTED-NO-CORE | Windows WFP | P1 | apps/windows/service/src/core/windows_kill_switch.rs:2800 | Restored wanted block can outlive its Core | duplicate #740 (now merged) |
| W1-LOCK-POISON | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:1910 | ARMED poison can panic lock IPC | duplicate #812 (now merged) |
| W1-STRICT-UNHEALTHY | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:2918 | Strict watchdog eventually releases after unhealthy streak | false-positive explicit existing decision #733; no change |
| WIN-FAILED-ARM-AI-HOLD | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:1216 | A failed WFP install removes the existing narrow AI hold | real-fixed #976 |
| W1-LIVE-CORE-RELEASE | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:2737 | A live broken Core can survive a WFP-only recovery release | real-unfixed needs unavailable App plus broken Core; lifecycle fix beyond narrow recovery helpers |
| W1-DHCP-PERMIT | Windows WFP | — | apps/windows/service/src/core/wfp_model.rs:442 | Infrastructure DHCP/loopback permits bypass deny-all | false-positive bounded intentional infrastructure exceptions; no ordinary AI bypass proved |
| W1-FFI-VALUES | Windows WFP | — | apps/windows/service/src/core/wfp/mod.rs:260 | Condition pointers could move during vector growth | false-positive condition values are boxed and remain heap-pinned |
| WIN-UPDATE-FAILURE-AI-HOLD | Windows WFP | P1 | apps/windows/service/src/bin/install_service/update_executor.rs:586 | Automatic failed-update emergency release removes the secondary AI layer | real-fixed #978 |
| W1-UNWANTED-UNLINK-DNS | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3138 | An undeletable unwanted intent can skip remaining DNS restoration | real-unfixed needs prior exceptional DNS residue plus independent unlink error; lower priority |
| W1-EMERGENCY-TOMBSTONE | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:3665 | A failed tombstone could refuse explicit Restore before WFP removal | false-positive supported Restore CLI enables tolerant uninstall ladder |
| W1-REPLACEMENT-CORRUPT-OWNER | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:3270 | Replacement preparation preserves corrupt owner evidence | false-positive following service startup handles recovery; preparation alone does not claim release |
| W1-EMERGENCY-LIVE-SERVICE | Windows WFP | — | apps/windows/service/src/bin/service.rs:135 | Emergency release could race a healthy service | false-positive healthy Service owns singleton owner lock and refuses competing CLI |
| W1-UNVERIFIED-OWNER-RETIRE | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3349 | Failed unverified-owner retirement can retain healthy Blocked policy | duplicate documented adjacent #777 limitation; interrupted startup plus record error |
| W1-RESTORED-RELOCK | Windows WFP | P1 | apps/windows/service/src/core/windows_kill_switch.rs:3386 | A failed restored re-lock consumes its retry flag | duplicate #740 Core-proof deadline and non-strict release |
| W1-UPDATE-TOMBSTONE | Windows WFP | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:586 | Automatic failed-update release can be refused by tombstone write failure | duplicate recorded #858 limitation; restart failure plus independent write error |
| W1-PERSISTENT-PERMITS | Windows WFP | P1 | apps/windows/service/src/core/wfp_model.rs:287 | Persistent deny can outlive nonpersistent DHCP/loopback permits | duplicate #753; main makes infrastructure permits persistent |
