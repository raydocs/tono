# R3-A2A4: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 00:54 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1003 | hunt/sol-r3wconn-monitor-ai-hold | needs-hardware | yes | fix(windows): preserve AI hold after automatic health release |
| 1010 | hunt/sol-r3wconn-failed-connect-ai-hold | needs-hardware | yes | fix(windows): keep AI hold during guarded connect-failure release |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-MONITOR-AI-HOLD-OMISSION | A3 | P1 | connection/monitor.rs:1391 | Automatic health release removes the secondary AI hold | real-fixed #1003 (CI pending) |
| R3-A2-01 | A2 | — | connection/reconnect.rs:139 | Reconnect budget leaves ordinary users blocked | false-positive ordinary failure releases; persistent hold needs another release failure |
| R3-A2-02 | A2 | — | connection/cleanup.rs:30 | Cancellation loses failure cleanup | false-positive detached writer survives cancellation and checks generation |
| R3-A2-03 | A2 | — | connection/cleanup.rs:77 | Late StartClash tears down replacement | false-positive reader guard excludes replacement until compensation settles |
| R3-A2-04 | A2 | — | connection/cleanup.rs:104 | Late DNS enable survives Disconnect | false-positive detached ownership restores DNS; restore failure retains protection deliberately |
| R3-A2-05 | A2 | — | connection/platform.rs:54 | Physical interface discovery cuts network | false-positive optional failure skips DIRECT and keeps full tunnel |
| R3-A2-06 | A2 | — | connection/heal.rs:29 | Heal retains another account dial | duplicate WIN-HEAL-SIGNOUT-DIAL #874 |
| R3-A2-07 | A2 | — | connection/heal.rs:78 | Recovery preflight connects deselected node | duplicate #798 |
| R3-A2-08 | A2 | — | connection.rs:263 | Self-heal double release | duplicate #798 |
| R3-A2-09 | A2 | P2? | connection.rs:639 | Stale failure clears successor auth tunnel port | unverified narrow race; no ordinary trigger proved |
| R3-A4-01 | A4 | — | connection/direct.rs:973 | HY2 DIRECT graph expects absent generic UDP reject | duplicate acknowledged follow-up WIN-HY2-HOME-UDP-LEAK #783 |
| R3-A3-02 | A3 | — | connection/monitor.rs:1361 | Failed old proof releases successor | false-positive Disconnect aborts monitor; policy recovery skips proof and fences generation |
| R3-A3-03 | A3 | — | connection/disconnect.rs:129 | Cancelled UI waiter abandons cleanup | false-positive detached coordinator owns cleanup |
| R3-A3-04 | A3 | — | connection/disconnect.rs:399 | Disconnect state mutex deadlock | false-positive release registration uses independent mutex |
| R3-A3-05 | A3 | — | connection/disconnect.rs:162 | Final route sample contaminates successor | false-positive synchronous ingest under state lock and generation guard |
| R3-A3-06 | A3 | — | protected_probe.rs:139 | Direct DNS proof bypasses protection | false-positive Service DNS evidence WFP and residential-browser guards |
| R3-A3-07 | A3 | — | connection/probes.rs:94 | Missing TUN permit check admits blocked session | false-positive subsequent real App HTTPS cannot pass without permit |
| R3-A3-08 | A3 | — | connection_health.rs:245 | One missing core sample tears down tunnel | false-positive two sustained samples required |
| R3-A3-09 | A3 | — | connection/probes.rs:551 | Transient probe strands protection | false-positive retry recovery and unarmed probing paths |
| R3-A3-10 | A3 | — | state.rs:166 | Monitor replacement aborts its own connect tail | false-positive registration checks task identity |
| R3-A3-11 | A3 | — | ../core/sysopt.rs:50 | Proxy guard pending loop hangs release | false-positive no product path starts guard |
| R3-A4-02 | A4 | — | connection/direct.rs:62 | Policy revision stops heartbeat | duplicate #786 |
| R3-A4-03 | A4 | — | connection/direct.rs:495 | Suffix-only activates empty DIRECT graph | duplicate #786 |
| R3-A4-04 | A4 | — | connection/direct.rs:82 | Failed DIRECT renewal blocks general network | duplicate #926 |
| R3-A4-05 | A4 | — | connection/direct.rs:1250 | Activation reload stalls Restore | duplicate #898 |
| R3-A4-06 | A4 | — | catalog_sync.rs:197 | Routing changes leave stale runtime permits | duplicate #787 |
| R3-A4-07 | A4 | — | connection.rs:308 | Signed paths survive fresh full tunnel | duplicate #900 |
| R3-A4-08 | A4 | — | route_ledger.rs:65 | Route ledger survives crash with OS routes | false-positive process-local byte accounting |
| R3-A4-09 | A4 | — | route_ledger.rs:184 | Closed connection cursors accumulate | false-positive live IDs inserted before retain comparison |
| R3-A4-10 | A4 | — | route_preferences.rs:315 | Route history disk work blocks admission | false-positive bounded nonblocking queue separate worker |
| R3-A4-11 | A4 | — | connection/direct.rs:279 | DIRECT suffix rows lack WFP permission | false-positive corresponding reviewed-port grant required |
| R3-A4-12 | A4 | — | connection/direct.rs:574 | Policy and lifecycle locks invert | false-positive consistent policy then lifecycle lock order |
| R3-A4-13 | A4 | — | connection/stages.rs:57 | Residential SOCKS lacks physical permit | false-positive intentionally chained through Tono-Exit |
| R3-A4-14 | A4 | — | connection/direct.rs:1633 | Recursive controller parse hangs process | false-positive serde recursion limit and total HTTP deadlines |
| R3-A4-15 | A4 | P2? | connection/direct.rs:1497 | Stale optional skip overwrites replacement metadata | unverified ordinary old request ends on Core stop; successor overlap not proved |
| R3-A4-16 | A4 | P3? | route_ledger.rs:46 | Empty chains attribution disagrees with frontend | unverified route is unknown; attribution semantics need decision |
| R3-A2-10 | A2 | — | connection/controller.rs:314 | DNS bind preflight retains successful socket after another protocol failed | false-positive moved Results drop successful listeners each retry |
| R3-A2-11 | A2 | — | connection/monitor.rs:616 | Old stage tail monitor registration adopts new session | false-positive monitor independently checks live status and generations; harmful overlap unproved |
| R3-A2-12 | A2 | — | connection/switch.rs:238 | Hot switch stops committed DIRECT heartbeat | false-positive hot switch preserves generation; heartbeat policy identity unchanged |
| WIN-CONNECT-FAILURE-AI-HOLD-OMISSION | A2/A3 | P1 | connection.rs:680 | Failed protected connect/cold switch performs one plain release without AI hold | real-fixed #1010 (CI pending) |
