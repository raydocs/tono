## YOUR AREAS (slot W1-grok-win-svc; branch prefix `hunt/grok-winsvc-`)
Only Sol has reviewed these so far. You are the second model.
- **W4**: `apps/windows/service/src/bin/service.rs`, `core/{maintenance,boot_session,owner,reconcile,repair,runtime,desired,structure}.rs`.
- **W5**: `core/dns/mod.rs` (3406 lines; lines above ~2022 were never reviewed), `core/dns/engine.rs`, `core/dns/native_apply.rs` (engine and native_apply were never reviewed).
- **W7**: `core/update.rs`, `core/update/gate.rs`, `core/update/security.rs`, `src/update_transaction.rs`, `src/update_wire.rs`.
- **W9**: `src/bin/install_service.rs`, `bin/install_service/{update_executor,update_journal}.rs`, `bin/uninstall_service.rs` (never reviewed), `core/legacy_cleanup.rs`, `core/windows_legacy_cleanup.rs`, and the NSIS installer script(s) under apps/windows.

Hunt for:
- service start/stop/crash/reboot paths that leave DNS on 127.0.0.1 or a dead NRPT rule, or WFP armed;
- update and installer rollback paths that leave the user offline or with no running service;
- uninstall paths that leave filters, DNS or scheduled tasks behind;
- journal/crash-recovery idempotency;
- hangs in blocking tasks.

In-flight PRs: #776 #779 #792 #793, plus codex2 win-installer-retry-candidates.
