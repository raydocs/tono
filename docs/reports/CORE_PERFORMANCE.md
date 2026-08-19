# Tono Core performance

Baseline remains **Mihomo `v1.19.29-tono-gvisor-adaptive.1`**.
Protocol stack is not rewritten.

## What is already in the engine

| Item | Value |
| --- | --- |
| Upstream | Mihomo `v1.19.29` (`e26714a181ac0e2fa803453c0a8e9a9ce94e31cb`) |
| TUN | gVisor via `sing-tun v0.4.21` |
| TCP buffers | adaptive 4 KiB / 32 KiB / 128 KiB (stock was fixed 20 KiB) |
| Receive moderation | on |
| Build tags | `with_gvisor` only |
| Go | 1.26.5 |
| macOS sidecar | 41 MB, reports the adaptive version string |
| Windows sidecar | 45 MB PE |

`unified-delay` is off. `/delay` is a single measurement for UI only. Connection verdict is the three-origin TUN race.

## What this pass changed (no buffer guesswork)

- Production core log-level: `info` → `warning` (less disk I/O; App audit stays).
- `unified-delay` is off: `/delay` is a single measurement for UI only.
- `find-process-mode` is `off` on the full-tunnel critical path and becomes
  `strict` only when Home or optional DIRECT process rules are present.
- Connect no longer waits for controller `/delay` before the real TUN race.
- TUN origin race is staggered (0/100/200 ms) so a cold Reality path is not
  hit by three TLS handshakes in the same millisecond.
- macOS TUN probes use URLSession (no curl process). Controller bind and
  owned-utun wait overlap; loopback DNS preflight overlaps PF lock.
- Post-lock retry pause is 500 ms (was 1 s on Windows).
- Windows controller `/version` wait and WinTUN lock run together.
- macOS control-plane pin refresh runs after Connected, not on the commit path.
- First fake-IP / system-DNS attempt uses a short ceiling so a not-yet-switched
  resolver retries instead of sitting on a 5 s hang.
- macOS DNS preflight no longer launches `dig`; listener proof is UDP to
  127.0.0.1:53, system proof is `getaddrinfo`.
- Health checks run TUN first and cancel the advisory `/delay` if TUN
  already succeeded; later checks start from the last winning origin.
- Node switch proves the new exit before `closeAllConnections`, so a
  rollback does not drop every live TCP first.
- Runtime YAML is generated beside helper install / first PF arm.
- `/version` is polled during `/core/start`; loopback DNS starts as soon as
  the controller answers, overlapping the utun wait and second PF arm.
- Helper 3.13.0 writes protected DNS through System Configuration instead of
  forking `networksetup` on every connect; `networksetup` stays as fallback.
- Owned runtime still does not emit GEO rules. Windows payload no longer ships `Country.mmdb` / `geoip.dat` / `geosite.dat` (~28 MB).
- `core-identity.json` records version, upstream commit, patch, Go, tags, buffer range.
- `tooling/scripts/bench-tono-core.sh` writes the required RTT/loss/rate matrix as `not-run` unless impairment tools exist.

## What is not claimed

The 50/200/500/800 ms × 0–5% loss × 10/100/500 Mbps matrix has **not** been executed on this host (`tc`/`dnctl` not used). Therefore:

- gVisor 4/32/128 profile is **not** retuned
- Go PGO is **not** enabled
- Mihomo protocol compile-outs are **not** applied (upstream has no safe fine-grained exclude tags beyond `with_gvisor`)

Those stay blocked until the bench script has real numbers.
