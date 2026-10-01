# Round 4: macOS network changes and power events (Claude Opus 5.5)

Base: `origin/main` `509ebde2`. Source reading only. Nothing ran on this Mac that touches PF, DNS, routes, the helper or the network (owner rule). XCTest runs only in hosted CI.

## Scope
- App: `SystemNetworkChangeMonitor` / `PhysicalNetworkReachability`, `NetworkUplinkSnapshot.classify`, `handleSystemNetworkChange`, `scheduleNetworkEnvironmentReconciliation`, `prepareForSystemSleep` / `resumeAfterSystemWake`, the one-minute core-monitor audits, `applyExhaustedArmedFailure` / `scheduleUnarmedReconnect`, and the DNS-audit pauses.
- Helper: `HelperPowerMonitor` / `PowerTransitionGate`, `secureForPowerTransition`, the `SocketServer` idle watchdog (core-down release, orphaned bootstrap), `ProtectedDNSManager.enable/restore`, and `SelectiveFailOpen`.

## Findings

| ID | Severity | Where (main 509ebde2) | Verdict | PR / issue |
|---|---|---|---|---|
| MAC-DNS-PAUSE-HOLDS-PF | P2 | `AppState+Connect.swift` `pauseIfProtectedDNSKeepsFailing` ~L2538, `holdProtectedDNSSupplementalConflict` ~L2565 | Confirmed (source path). After a network/DHCP change, the third broken DNS audit or a split-DNS conflict uses the preserve teardown and schedules no reconnect. A non-strict Mac is offline ~30 s with DNS on the dead `127.0.0.1` until the helper watchdog releases, and the UI still claims a block. Fixed: automatic release with the AI hold (decision 031). | #1285 (needs-hardware, no auto-merge) |
| MAC-PAUSED-OPEN-STATUS | P2 | `Views/MenuBarProtectionStatus.swift` ~L42 | Confirmed. After the third supervisor repair releases the network, the pause flag alone made the menu bar show "Protected Offline · retries paused". Fixed: that branch requires `isProtectionBlocked`. | #1286 (auto-merge) |
| MAC-PAUSE-WATCHDOG-STALE-BLOCK | P2 | `AppState+Connect.swift` ~L45-65, `AppState.swift` ~L859 and ~L985 | Confirmed (source path); decision item. The remaining PF-held pauses are released by the helper watchdog ~30 s later, and the app only re-reads on activation. | #1287 |

## Checked, no new defect
- **Sleep and wake.** The helper commits the emergency all-block and stops the Core at `WillSleep`, then reasserts at `WillPowerOn` and `HasPoweredOn`. A non-strict Mac whose app never reconnects is released by the core-down watchdog after ~30 s, with the AI hold. The wake connect failing while armed takes `applyExhaustedArmedFailure` (release). The app's wake loop exhausting its delays hands off to the protected loop, and each failed attempt there releases. No path keeps a non-strict Mac blocked indefinitely, apart from #1269 (app dead while connected, open decision) and #1287.
- **Wi-Fi switch, Ethernet unplug, interface gone.** `classify` returns `.inconclusive` when the uplink vanishes (tunnel kept, PF kept) and `.moved` on a concrete change (preserve teardown plus immediate protected reconnect). A move whose reconnect fails releases through the armed-failure path. LAN DNS to the new DHCP resolver stays blocked by PF during the window, so there is no leak. Same-IP, same-gateway roams read `.stay`. sing-box redials, which is acceptable.
- **Captive portal.** The armed connect fails, which releases with the AI hold, and then the unarmed TCP proof gates the next attempt. This is covered by earlier UnarmedBackoff work. PF is never loosened for the portal, by design (ROAM-M1).
- **DHCP DNS change while the helper owns DNS.** The helper writes the Setup `ServerAddresses` on the protected service, which overrides DHCP. Restore is keyed by stable service ID and sweeps every service, including disabled ones. Hotplug and supersede cases are already recorded (MAC-DNS-OWNED-SNAPSHOT and others).
- **AI hold across network changes.** The blackhole routes use the `127.0.0.1` / `::1` gateways, which are bound to `lo0`, so link changes do not flush them. The `/etc/resolver` files persist. Reboot loss is #829 (decision).

## Open risks
- Hardware is needed for #1285: DHCP or a corporate VPN pushing a split resolver while the app is connected.
- XCTest for #1285 and #1286 was not run locally. The "fails on old code" claims are from reading the code only.
- #1285 removes the PF hold on the split-DNS conflict. "End the session on split DNS" is still a provisional owner decision. The main session's Codex review should confirm that the change is consistent with decision 031.
- Helper untouched, so no protocol bump.
