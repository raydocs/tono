## 2026-10-01 · When does the macOS sing-box advisory exit delay run?

- Status: provisional
- Chosen: after the TUN data plane wins, wait 1500 ms before the advisory `/delay`. If the protection generation moved, skip the probe. Rejected: calling it immediately, and rejected removing the sample or turning off the warm-path delay.
- Why stricter: Connected is still the data-plane check. The failure path still awaits the probe at once, and the health monitor still starts it beside the TUN probe and cancels it when TUN wins. AI rules and the sing-box JSON contract are unchanged. `stack` stays omitted.
- Applied in: `apps/macos/Tono/Services/AppState.swift`, `apps/macos/Tono/Services/ProtectedConnectivity.swift`.
