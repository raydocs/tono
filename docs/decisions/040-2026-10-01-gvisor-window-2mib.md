## 2026-10-01 · What TCP window does the Windows mihomo gVisor stack advertise?

- Status: provisional
- Chosen: raise the send and receive maximum from 128 KiB to 2 MiB. Minimum stays 4 KiB, default stays 32 KiB, and receive-buffer moderation stays on. Rejected: leaving the 128 KiB cap, and rejected an unbounded or 4 MiB maximum.
- Why stricter: 2 MiB is a ceiling, not an idle allocation, and it matches the transmit ceiling of the macOS sing-box stack at the pinned sing-tun (`goTransmitCapacityMax = 2 << 20`). Routing, certificate checks, and AI rules are unchanged. The macOS emitter still omits `stack`.
- Applied in: `tooling/scripts/mihomo-adaptive/gvisor-adaptive-buffer.patch`, `apps/windows/app/src-tauri/core-identity.json`.
