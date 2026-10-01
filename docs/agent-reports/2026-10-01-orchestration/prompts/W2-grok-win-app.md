## YOUR AREAS (slot W2-grok-win-app; branch prefix `hunt/grok-winapp-`)
Only Sol has reviewed these. You are the second model.
- **A2**: `apps/windows/app/src-tauri/src/tono/connection/{stages,switch,reconnect,transaction,controller,failure,heal,cleanup,platform,status,endpoints}.rs`.
- **A3**: `connection/{monitor,disconnect,probes}.rs`, `tono/connection_health.rs`, `tono/protected_probe.rs`.
- **A4**: `connection/direct.rs`, `tono/{policy_sync,route_ledger,connection_routes,route_preferences}.rs`.
- **A11**: `apps/windows/crates/tono-core/src/{config,node,sing_box}.rs`, `sing_box/*`, `tono/connection_plan.rs`.
  - Generated configs must never route AI services direct; check DNS consistency and exit stickiness.
- Recheck **A6** (`commands/update.rs`, `update_handoff.rs`, `commands/quit.rs`, `feat/window.rs`, `lib.rs`, `bootstrap.rs`, `steps.rs`, `core/updater.rs`) only if time remains.

In-flight: #714 #715 #718 #741 #749 #757 #784 #786 #787.
