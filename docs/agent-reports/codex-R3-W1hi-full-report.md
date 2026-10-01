PR #976 supplemental body update failed twice because gh queried retired Projects Classic fields. The code is already merged. Branch: `hunt/sol-r3ks-arm-ai-hold`; title: “fix(windows): preserve the AI hold when WFP install fails”; saved body: `/workspace/w1-codex/out/R3-W1hi/arm-ai-pr-body.md`.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-RECOVERY-AI-HOLD-OMISSION | Windows WFP | P1 | apps/windows/service/src/core/windows_kill_switch.rs:2946 | Crash/corrupt/unhealthy and unproven-Core releases omit the secondary AI hold | real-fixed #974 (merged) |
| W1-DIRECT-EXPIRY | Windows WFP | P1 | apps/windows/service/src/core/windows_kill_switch.rs:3428 | Committed DIRECT heartbeat expiry remains exact Blocked | duplicate #777 / #926 |
| W1-WANTED-NO-CORE | Windows WFP | P1 | apps/windows/service/src/core/windows_kill_switch.rs:2800 | Restored wanted block can outlive its Core | duplicate #740 (now merged) |
| W1-LOCK-POISON | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:1910 | ARMED poison can panic lock IPC | duplicate #812 (now merged) |
| W1-STRICT-UNHEALTHY | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:2918 | Strict watchdog eventually releases after unhealthy streak | false-positive explicit existing decision #733; no change |
| WIN-FAILED-ARM-AI-HOLD | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:1216 | A failed WFP install removes the existing narrow AI hold | real-fixed #976 (merged) |
| W1-LIVE-CORE-RELEASE | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:2737 | A live broken Core can survive a WFP-only recovery release | unverified needs unavailable App plus broken Core and native proof that TUN routes still blackhole after WFP release |
| W1-DHCP-PERMIT | Windows WFP | — | apps/windows/service/src/core/wfp_model.rs:442 | Infrastructure DHCP/loopback permits bypass deny-all | false-positive bounded intentional infrastructure exceptions; no ordinary AI bypass proved |
| W1-FFI-VALUES | Windows WFP | — | apps/windows/service/src/core/wfp/mod.rs:260 | Condition pointers could move during vector growth | false-positive condition values are boxed and remain heap-pinned |
| WIN-UPDATE-FAILURE-AI-HOLD | Windows WFP | P1 | apps/windows/service/src/bin/install_service/update_executor.rs:586 | Automatic failed-update emergency release removes the secondary AI layer | real-fixed #978 (merged) |
| W1-UNWANTED-UNLINK-DNS | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3138 | An undeletable unwanted intent can skip remaining DNS restoration | unverified skipped cleanup is source-proven; user harm needs exceptional DNS residue plus independent unlink error; native/fault evidence deferred |
| W1-EMERGENCY-TOMBSTONE | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:3665 | A failed tombstone could refuse explicit Restore before WFP removal | false-positive supported Restore CLI enables tolerant uninstall ladder |
| W1-REPLACEMENT-CORRUPT-OWNER | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:3270 | Replacement preparation preserves corrupt owner evidence | false-positive following service startup handles recovery; preparation alone does not claim release |
| W1-EMERGENCY-LIVE-SERVICE | Windows WFP | — | apps/windows/service/src/bin/service.rs:135 | Emergency release could race a healthy service | false-positive healthy Service owns singleton owner lock and refuses competing CLI |
| W1-UNVERIFIED-OWNER-RETIRE | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3349 | Failed unverified-owner retirement can retain healthy Blocked policy | duplicate documented adjacent #777 limitation; interrupted startup plus record error |
| W1-RESTORED-RELOCK | Windows WFP | P1 | apps/windows/service/src/core/windows_kill_switch.rs:3386 | A failed restored re-lock consumes its retry flag | duplicate #740 Core-proof deadline and non-strict release |
| W1-UPDATE-TOMBSTONE | Windows WFP | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:586 | Automatic failed-update release can be refused by tombstone write failure | duplicate recorded #858 limitation; restart failure plus independent write error |
| W1-PERSISTENT-PERMITS | Windows WFP | P1 | apps/windows/service/src/core/wfp_model.rs:287 | Persistent deny can outlive nonpersistent DHCP/loopback permits | duplicate #753; main makes infrastructure permits persistent |
| WIN-STARTUP-RETRY-RECONNECT | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:513 | Successful startup-release retry deletes the crash reconnect marker | real-fixed #986 (merged) |
| WIN-SELECTIVE-LATE-WORKER | Windows WFP | P2 | apps/windows/service/src/core/selective_layer.rs:24 | Timed-out native delete/apply can overwrite a newer AI hold or Restore | real-fixed #988 (merged) |
| W1-ASYNC-LOCK-CYCLE | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:125 | Watchdog Core identity lookup could wait behind lifecycle locks | false-positive coherent packed atomic identity; no manager lock await and state guards dropped before native calls |
| W1-DETACHED-ENGINE-OVERLAP | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:951 | Timed-out WFP native calls could overlap later filter mutations | false-positive in-flight epoch claim stays owned by native worker until it returns |
| W1-EMERGENCY-SWEEP-HANG | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:3730 | Emergency resolver-rule sweep could hang an async Service task | false-positive sweep has 10-second bound and runs in isolated owner-gated recovery CLI |
| W1-EMERGENCY-PROCESS-FLAGS | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:3690 | Emergency disarm leaves process-only watchdog flags stale | false-positive isolated recovery process exits; flags do not persist into running Service |
| W1-STATUS-MIXED | Windows WFP | P2 | apps/windows/service/src/core/status.rs:47 | Service status can mix separately sampled Core/WFP state | duplicate F520-1; existing generation and double-reading guard; millisecond snapshot limitation |
| W1-INHERITED-CORE-WINDOW | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:299 | A replacement arm could inherit an old Core-proof deadline | duplicate #740; no distinct new ordinary trigger proved beyond existing proof-window behavior |
| W1-LATE-INTENT-RENAME | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:639 | A timed-out rename could overwrite a successor intent | duplicate BRICK-W11; unique temps/readback fixed shared corruption, later-than-readback rename remains documented |
| W1-RECOVERY-CHECKPOINT | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:2745 | Slow secondary hold expands the pre-tombstone crash window | duplicate #740 guarded wanted-intent recovery; immediate/failed-replay/30-second Core proof release; no new permanent outage proved |

| PR | State | Auto-merge | Labels | Gate |
|---|---|---|---|---|
| [#974](https://github.com/raydocs/tono/pull/974) | merged | MERGE enabled before merge | needs-hardware | success |
| [#976](https://github.com/raydocs/tono/pull/976) | merged | MERGE enabled before merge | needs-hardware | success |
| [#978](https://github.com/raydocs/tono/pull/978) | merged | MERGE enabled before merge | needs-hardware | success |
| [#986](https://github.com/raydocs/tono/pull/986) | merged | MERGE enabled before merge | needs-hardware | success |
| [#988](https://github.com/raydocs/tono/pull/988) | merged | MERGE enabled before merge | needs-hardware | success |

28 hypotheses: 5 fixed, 11 duplicates, 10 false positives, 2 unverified. All merged commits verified in origin/main. Each fixed regression failed before and passed after; focused local tests and hosted Windows gates passed.

Assigned second half read end to end with relevant callers/callees. Native real-device networking unrun in Linux. Deferred proof: exceptional unrestored DNS plus independent unwanted-intent unlink failure, and surviving broken Core/TUN routes after WFP-only release. Process-local selective ordering does not fence a netsh child surviving Service death; native command failures/cache/DoH remain existing best-effort limits.
