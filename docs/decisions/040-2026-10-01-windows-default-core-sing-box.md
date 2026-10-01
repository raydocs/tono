## 2026-10-01 · Which core does Windows start by default?

- Status: provisional
- Chosen: sing-box, same shared JSON compiler contract as macOS. Mihomo stays bundled and runs only when this device's preference says `mihomo`, or when the sing-box image is missing or fails its own digest before WFP is armed. Rejected: keeping mihomo as the default, and rejected swapping to mihomo after WFP is armed or when the Service is older than protocol 18.
- Why stricter: a missing pin is not authentication. An armed machine does not change cores. HY2 without a published SPKI pin is unavailable on sing-box and is never filled in from the DER fingerprint. TUN omits `stack` (alpha.9 sing-tun: send 2 MiB, receive 4 MiB). Backup DoH stays lazy. The advisory delay waits until the data plane is proved, plus 1.5 s. AI blocking and selective fail-open are unchanged.
- Applied in: Windows connect selection, Service protocol 18, sing-box compiler.
