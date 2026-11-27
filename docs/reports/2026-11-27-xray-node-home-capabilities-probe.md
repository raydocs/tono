# Xray `v26.3.27` & `v26.11.9` Capabilities Probe (RFC PR 0)

- Date: 2026-11-27
- Gate: PR 0 of [Node-Side Residential SOCKS5 RFC](../proposals/node-side-residential-socks5.md) (§4.2, §4.4, §7.1, §8)
- Tooling: [probe_xray_capabilities.py](../../tooling/ops/node-home/probe_xray_capabilities.py) & [test_probe_xray_capabilities.py](../../tooling/ops/node-home/test_probe_xray_capabilities.py)
- Host environment: `Darwin arm64` local non-production loopback harness with `XRAY_LOCATION_ASSET` set to an empty directory (zero `geoip.dat` / `geosite.dat`). Linux `x86_64` canary re-verification occurs in PR 2 / PR 4 on `Los Angeles · Mesa`.

## Tested Binaries (Official `.dgst` SHA-256 Verified)

| Version | Release Asset | SHA-256 (`.dgst`) | Binary Output |
| :--- | :--- | :--- | :--- |
| `v26.3.27` | `Xray-macos-arm64-v8a.zip` | `2e93a67e8aa1936ecefb307e120830fcbd4c643ab9b1c46a2d0838d5f8409eaf` | `Xray 26.3.27 (Xray, Penetrates Everything.) d2758a0 (go1.26.1 darwin/arm64)` |
| `v26.11.9` | `Xray-macos-arm64-v8a.zip` | `233f0c66681cd0726f81a6b2b6ed6a5710869e312047b522e46ed53035bebd26` | `Xray 26.11.9 (Xray, Penetrates Everything.) 676eaf6 (go1.27.3 darwin/arm64)` |

## Side-by-Side Empirical Results

| Probe Gate | `v26.3.27` | `v26.11.9` | Observed Evidence |
| :--- | :--- | :--- | :--- |
| Static `-test` without `geoip.dat` | PASS | PASS | Unmodified prod-shape config (`direct` freedom + `home-blackhole` + 9 literal CIDRs + `regexp:^h:` rules) exited `0` (`Configuration OK.`) with empty `XRAY_LOCATION_ASSET`. |
| Static/legacy & `u:` clients intact (`Check A`) | PASS | PASS | `shared-legacy`, `user-42`, and API-added `u:1001:dev1:gen1` all echoed via `direct` (`DIRECT:HELLO_DIRECT`). See behavioral note below on `v26.11.9` `freedom.finalRules`. |
| Unbound `h:` catch-all fail-closed (`Check B`) | PASS | PASS | `h:2002:dev2:gen1` dialing `canary-home.invalid:443` and `198.51.100.10:8080` closed immediately on `home-blackhole`; `socks_hits: 0`. |
| Dynamic `ado` + `adrules` replace-all + `AsIs` (`Check C`) | PASS | PASS | `xray api adrules` (default `-append=false`) replaced rules atomically to `[tono-api-rule, tono-home-private-cidrs, tono-home-line1-gen1, tono-home-catchall]` while a live `u:` stream stayed open uninterrupted (`PRE_ADRULES` / `POST_ADRULES`). SOCKS5 mock received `ATYP=0x03` (`canary-home.invalid:443`) and `ATYP=0x01` (`198.51.100.10:8080`) with `user_a`; unbound `h:2002` stayed blocked. |
| 9 literal private/CGNAT/loopback/link-local CIDRs blocked (`Check D`) | PASS | PASS | `127.0.0.1:<direct_port>`, `10.0.0.1:80`, `172.16.0.1:80`, `192.168.1.1:80`, `169.254.169.254:80`, `100.64.0.1:80`, `[::1]:80`, `[fc00::1]:80`, `[fe80::1]:80` all closed via `home-blackhole` (`direct_hits_delta: 0`, `socks_hits_delta: 0`) and resolved to `home-blackhole` in `TestRoute`. |
| `rmu` + replace-all + `rmo` on live streams (`Check E`) | PASS (`rmo` does **not** cancel) | PASS (`rmo` does **not** cancel) | New dials with removed `h:1001:dev1:gen1` failed (`new_conn_rejected_after_rmu: true`); concurrent `u:1001` stream survived untouched (`u_stream_survived_unbind: true`). **Crucially**, on **both** versions `rmo home:line1:gen1` left the established TCP stream open (`upstream_socks_closed_on_rmo: false`, echoed `SOCKS5:canary-home.invalid:H_AFTER_RMO`, `rmo_cancels_established_stream: false`). |
| Unified `u:` + `h:` `statsquery` (`Check F`) | PASS | PASS | Both versions recorded independent non-zero counters (`u_uplink: 55`, `u_downlink: 90`, `h_uplink: 38`, `h_downlink: 140`). |
| `TestRoute` CLI vs HTTP/2 gRPC (`Check G`) | CLI `false` / gRPC `true` | CLI `false` / gRPC `true` | Neither binary exposes `xray api testroute` (23 CLI subcommands), whereas both serve `/xray.app.router.command.RoutingService/TestRoute` over h2c HTTP/2 gRPC (`home:line1:gen1` for bound `h:`, `home-blackhole` for unbound `h:` / private IP, empty default fallthrough for `u:`). |

## Critical `v26.11.9` Behavioral Delta (`freedom.finalRules` vs `socks`)

On `v26.11.9`, default `freedom` outbounds enforce built-in `finalRules` blocking loopback/private targets (`proxy/freedom: target blocked by a finalrule: tcp:127.0.0.1:..., blackholing connection for 32s`). Consequently, running our offline loopback-only mock echo server through `freedom` requires permitting `127.0.0.1/32` explicitly in the test-harness runtime config (`finalRules: [{"action": "allow", "ip": ["127.0.0.1/32"]}]` after `-test` passes on the unmodified production config). Crucially, `proxy/socks` does **not** inherit `freedom`'s `finalRules` and dialed `127.0.0.1:<socks_port>` -> `canary-home.invalid:443` directly — proving that the explicit `user: ["regexp:^h:"]` + 9 literal private CIDRs -> `home-blackhole` routing rule remains mandatory for SSRF isolation on both `v26.3.27` and `v26.11.9`.

## Decisions Locked for PR 1–PR 5

1. **Data-plane architecture is GO on both `v26.3.27` and `v26.11.9`**: Dynamic `ado` + full-table `adrules` replace-all (`-append=false`) + `domainStrategy: "AsIs"` + static literal-CIDR/catch-all `home-blackhole` guards + unified `u:`/`h:` `StatsService` counters work identically on both Xray versions without `geoip.dat` or restarts.
2. **RFC §7.1 drain rule triggered (`rmo_cancels_established_stream = false`)**: Because `rmo` does **not** close already-established outbound TCP connections on either `v26.3.27` or `v26.11.9`, PR 1–PR 5 MUST **not** fall back to restarting `tono-xray` (which drops unrelated `u:` users) and MUST **not** relax `migrations/0080_home_socks5_rotation_required.sql` password rotation on unbind. `home_exit_drain_acks` provides verified node teardown confirmation (`rmu` -> replace-all rules -> `rmo` blocking new connections) as an additional fail-closed guard alongside mandatory upstream password rotation until a verified per-tenant stream-cancellation primitive is available.
3. **PR 2 route verification path**: `exit-agent` (`services/exit-agent`) verifies live routing using deterministic `ruleTag` checks via `xray api lsrules` combined with a lightweight stdlib h2c `/xray.app.router.command.RoutingService/TestRoute` client (no external gRPC/protobuf runtime dependency needed).
