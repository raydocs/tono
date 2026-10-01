## YOUR AREAS (slot W1-grok-win-wfp; branch prefix `hunt/grok-wfp-`)
Only Sol has reviewed these so far. You are the second model, so look for what Sol missed.
- **W1**: `apps/windows/service/src/core/windows_kill_switch.rs`, the whole file (6090 lines). Lines above ~3278 have NEVER been reviewed.
- **W2**: `apps/windows/service/src/core/wfp/mod.rs`, `core/wfp_model.rs`, `core/windows_security.rs`.
- **W3**: `core/manager.rs`, `core/netmon.rs`, `core/netmon/topology.rs`, `core/process.rs`, `core/proxy.rs`, `core/macos_kill_switch.rs`.

Hunt for:
- persistent WFP filters that outlive the service or app;
- ARMED state and intent-file divergence;
- lease/watchdog timers that fail closed;
- mutex poisoning;
- blocking calls inside async;
- filter weight/ordering mistakes that could leak AI traffic or block DHCP/loopback;
- process kill/orphan paths;
- proxy settings left pointing at a dead core.

Many PRs are in flight here (#740 #753 #769 #777 #791 #792). Read their diffs first so you don't collide.
