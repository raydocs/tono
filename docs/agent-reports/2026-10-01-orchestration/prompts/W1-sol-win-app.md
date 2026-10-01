## YOUR AREAS (slot W1-sol-win-app; branch prefix `hunt/sol-winapp-`)
Mostly never reviewed.
- **A1**: `apps/windows/app/src-tauri/src/tono/connection.rs` (3728 lines), the top-level connect/disconnect orchestrator.
- **A8**: `tono/{windows_dns,encrypted_dns,browser_dns,signed_apps,audit,local_evidence}.rs`.
- **A9**: `tono/commands/{restore,terminal,diagnostics,support,catalog,connection_cmd,mod}.rs`, `tono/{telemetry,diagnostics,log_upload,support_reports}.rs`, `src-tauri/src/utils/*` (schtasks.rs, server.rs, init.rs, dirs.rs, network.rs, singleton.rs, port.rs).
  - `commands/restore.rs` ("restore my network") is HIGH risk: it must ALWAYS work.
- **A5 (rest)**: `tono/{credentials,state,transport}.rs`.
- **A10**: `apps/windows/app/src` (TypeScript: hooks, services, providers, tono-ui logic). Logic bugs only (stale closures, unhandled promise rejections, listener leaks, wrong state after errors). NO visual changes.

Hunt for:
- connect/disconnect/restore paths that can leave the machine offline;
- lock ordering and holding the lifecycle writer across long awaits;
- panics/unwraps reachable from IPC or network input;
- log upload leaking secrets/tokens;
- terminal/proxy env commands with injection;
- schtasks argument quoting.

In-flight: codex2 win-connection-races (the duplicate release after fail_connect, the recovery preflight stale selection), #768, #771, #772, #784, #787. Do not redo those.
