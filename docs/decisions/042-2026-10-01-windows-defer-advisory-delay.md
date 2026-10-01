## 2026-10-01 · When does the Windows advisory exit delay run?

- Status: provisional
- Chosen: after the data plane is proved, wait 1500 ms before `GET /proxies/Tono-Exit/delay`. If the connection generation moved during the wait, skip the probe. Rejected: turning `unified-delay` off, and rejected removing the sample.
- Why stricter: the Connected verdict is still the TUN data-plane check. The probe is not removed, so the UI still gets a warm RTT. Failure diagnostics and the health path still call the probe immediately. AI blocking is unchanged. This is the mihomo controller; the macOS sing-box deferral is a separate change.
- Applied in: `apps/windows/app/src-tauri/src/tono/connection/probes.rs`.
