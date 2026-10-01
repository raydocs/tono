## 2026-10-01 · When does Windows mihomo query the backup DoH server?

- Status: provisional
- Chosen: `nameserver` carries only `https://1.1.1.1/dns-query#Tono-Exit`. The `8.8.8.8` URL moves to `fallback` with `fallback-lazy-query: true`. `proxy-server-nameserver` stays the primary, because exits are IPv4 and that resolver has no fallback. Rejected: racing both servers on `nameserver`, and rejected plaintext DNS.
- Why stricter: a healthy lookup no longer opens a second Reality handshake. The backup is still exit-pinned HTTPS, and it still answers when the primary is empty or an error. AI domain rules, fake-ip, and `prefer-h3: false` stay. macOS sing-box already evaluates the backup only after the primary is not NOERROR; this PR does not change that JSON.
- Applied in: `apps/windows/crates/tono-core/src/config.rs`, `apps/windows/service/src/core/runtime_generation/owned_config.rs`.
