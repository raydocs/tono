| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-FAILED-PREPARE-AI-HOLD | Automatic Windows recovery after reserved update staging fails uses explicit update Disconnect and removes the secondary AI hold | in-PR | hunt/sol-r3acct-update-stage-ai-hold | 高·已确认（P1，Linux dispatch/WFP regressions） | Windows-only staging coordinator and installed update/WFP/DNS need CI/hardware; unreadable evidence or failed durable release recording can still refuse cleanup. |

Baseline `00c6def8`: a private package copy/unpack error after reservation precedes Service's Prepare error handler, leaving Core running. The App's failed-Prepare convergence calls `disconnect_for_generation(Some(...))`; its narrow intent is lost at `connection/disconnect.rs:267–270`, which selects explicit `UpdateRequest::Disconnect`. Service `core/update.rs:670` performs full `wfp::release()` and removes the AI hold. No second failure is needed. This differs from #793's post-Core-stop cleanup and #978's executor restart recovery.

All post-reservation staging/quiescence errors now reach the existing Service-owned automatic narrow cleanup. Its evidence is reopened only after the failed preparation future drops its Store. Automatic App recovery cannot dispatch explicit update Disconnect. The WFP narrow-release API rechecks strict intent under its writer and refuses strict automatic disarm; explicit Restore still works.

Two exact production dispatch regressions fail before (0 passed, 2 failed) and pass after (2 passed, 0 failed) in a portable harness. The actual WFP strict-release regression also fails before; the fixed Linux Service WFP suite passes 108 tests. Native Windows staging/Tauri tests were not run locally. Existing narrow-layer DNS/cache/DoH limitations remain.
