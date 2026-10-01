## YOUR AREAS (slot W1-sol-win-trust; branch prefix `hunt/sol-trust-`)
NO model has reviewed these yet. They are the privilege boundary and the integrity/signature code.
- **W6**: `apps/windows/service/src/core/server/{mod,handlers}.rs` (plus the tests there), `core/auth.rs`, `src/client/{mod,windows_identity}.rs`, `src/channel.rs`. This is the SYSTEM service IPC.
  - Can a non-admin local user, or another user's session, drive privileged ops?
  - Named-pipe ACLs, caller identity/owner checks, TOCTOU on the client image path, message size limits, parser panics.
- **W8**: `core/runtime_generation/{assets,staging,core_integrity,authenticode,owned_config,mod}.rs`, `core/paths.rs`.
  - Integrity of the core binary/config the service launches as SYSTEM: path traversal, symlink/junction races in writable dirs, hash/signature bypass, rollback to an old signed binary.
- **A7**: `apps/windows/app/src-tauri/src/core/service/{mod,install,owner}.rs`, `core/runstate/*`, `core/owner_identity.rs`, `core/manager/*`, `core/proxy_control.rs`, `core/sysopt.rs`, `core/tray/*`.
  - The app-side client of the service: timeouts, reconnection, stale owner, system proxy left set.
- **A12**: `apps/windows/crates/tono-core/src/{auth,policy,policy_signature,catalog,heal,connection,update_journal,update_journal/store,update_contract,recovery,network_disposition,customer_failure,credentials,protected_connectivity}.rs`. auth.rs is 3411 lines.
  - Signature/JWT verification, replay/rollback of signed policy/catalog, clock skew, update-journal crash atomicity, credential storage.
- **A13 (part)**: `apps/windows/crates/tono-authenticode`.

A "vulnerability" needs a realistic attacker model: a local unprivileged user, or a network MITM when TLS is misconfigured. Admin-only attackers are out of scope. Write security findings carefully and without exploit code.
