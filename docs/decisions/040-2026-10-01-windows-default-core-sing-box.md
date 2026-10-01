## 2026-10-01 · Which core does Windows start by default?

- Status: provisional
- Chosen: sing-box, same shared JSON compiler contract as macOS. Mihomo stays bundled and runs only when this device's preference says `mihomo`, or when the sing-box image is missing or fails its own digest before WFP is armed. Rejected: keeping mihomo as the default, and rejected swapping to mihomo after WFP is armed or when the Service is older than protocol 18.
- Why stricter: a missing pin is not authentication. An armed machine does not change cores. HY2 without a published SPKI pin is unavailable on sing-box and is never filled in from the DER fingerprint. TUN omits `stack` (alpha.9 sing-tun: send 2 MiB, receive 4 MiB). Backup DoH stays lazy. The advisory delay waits until the data plane is proved, plus 1.5 s. AI blocking and selective fail-open are unchanged.
- Applied in: Windows connect selection, Service protocol 18, sing-box compiler.

### Amendment 2026-10-01 (#1197) · Protected Offline may fall back

- Status: provisional (AGENTS.md §3; no owner answer yet).
- "Armed" in this decision means a live, Service-proven core that a connect would replace (`active_runtime_resume`). Only then does a missing or digest-failed sing-box image refuse the fallback (`ArmedRefusesFallback`).
- A Protected Offline reconnect (WFP wanted or live, core exited) may start mihomo when the sing-box image is missing or fails its digest. An explicit `core: mihomo` record may likewise switch cores on any connect.
- Why: StartClash re-renders the tunnel permit for the new core before it starts, so no traffic leaves outside WFP. Refusing would leave the machine in Protected Offline with no way out, which breaks the owner rule that a failure never cuts the network.
- Still held: a core change happens only through StartClash under the Service lifecycle gate; the App never swaps a running core in place. A Service older than protocol 18 is still a refusal before arm. A failed version probe is now reported as retryable, not as an old Service.
