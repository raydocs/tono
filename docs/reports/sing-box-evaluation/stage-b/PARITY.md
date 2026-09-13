# Functional workload parity passed; product replacement parity did not

**68/68 bounded checks passed** in `parity-05`, before `measure-01`.
[Raw checks](raw/parity.json) include request status, payload byte verification,
negative controls and interface identity. This gate covers the synthetic workload
below. It is **not** equivalence of the whole Tono signed-policy/DNS/lifecycle contract.

## What was actually exercised

| Contract | Executed evidence / scope |
|---|---|
| True TUN | Raw application sockets, no proxy environment/SOCKS option; kernel route to the origin resolves to `bench-tun`. Both protocols return exact owned 4096-byte payloads. |
| Same-instance mixed routing | While two owned origin responses were held, `/connections` contained `reality` → port 18080 and `hy2` → port 18081 simultaneously; both requests then passed. Measurement also retains actual request overlap intervals. |
| TLS/authentication | Owned CA + correct Hy2 SNI passes. Wrong CA and wrong SNI fail while Reality still works. Wrong Reality short ID fails while Hy2 still works. No `insecure`, `skip-cert-verify`, pin bypass or production identity. |
| DNS | DNS over UDP **and TCP** through TUN returns fake A records; connecting to those records reaches the owned origin. AAAA returns no address. Dedicated endpoint `172.19.0.2:53`, same owned resolver/targets for all candidates. |
| Rule priority | `blocked.bench.test` is rejected even on allowed Reality port 18080. Unmatched port 18082 is rejected. No implicit fallback. |
| Real reload | Port 18082 changes from rejected to exact payload success after the appropriate reload. This is the evidence, not HTTP 204. |
| Crash and cleanup | Exact owned core PID is killed; TUN disappears, listener set is empty, PID is reaped, and the origin is unreachable. Each following negative-control instance starts successfully. No claim of a product Linux kill switch: isolation/no external route provides containment. |
| Failure accounting | Owned 503 is classified FAIL; delayed response exceeds the whole-request deadline and is TIMEOUT. Corrupt body fails the separate harness regression. |

All external endpoint identities are literal local IPs; no bootstrap recursion or
third-party DNS is involved. Reality uses an owned ECDSA TLS 1.3 camouflage server.
Its X25519/short-ID authentication is not ordinary CA verification, so the report
does not describe it as such. Hy2 is ordinary CA + hostname verification here.

## Observed migration gaps and explicit adaptations

1. **Reload is not API-compatible.** Mihomo `PUT /configs?force=true` applies the
   valid new file. sing-box returns 204 but port 18082 remains rejected; SIGHUP
   then makes it succeed. Observed TUN ifindex: Mihomo 3→3, sing-box gVisor 7→8,
   sing-box Go 12→13. SIGHUP closes/recreates the instance. No claim that existing
   streams survive either engine's reload; that was not measured.
   Sources: [Mihomo configs.go](https://github.com/MetaCubeX/mihomo/blob/ac017cdd246ce8bd547653d927e7bf77d7ee73d5/hub/route/configs.go#L389-L460),
   [sing-box no-op](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/experimental/clashapi/configs.go#L69-L71),
   [real signal loop](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/cmd/sing-box/cmd_run.go#L187-L220).

2. **A mechanical DNS configuration translation failed.** In `parity-03`,
   sing-box allocated `198.18.0.2` as the first fake IP; the implicitly derived
   DNS address was also `.2`. TUN inbound treats the derived address as DNS
   regardless of application port, so the HTTP request timed out. Merely adding
   explicit `dns_address` removed that interception, but sending the DNS query
   itself into an unallocated fake-IP destination then failed in
   `prepareMatchMetadata` (`parity-04`). The common experiment profile now places
   its DNS endpoint **outside** the fake-IP pool and explicitly routes port 53.
   This configuration adaptation passes actual UDP/TCP/fake-IP checks on all three.
   Sources: [inbound address interception](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/protocol/tun/inbound.go#L346-L349),
   [JudgeFlow / DNS destination](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/protocol/tun/inbound.go#L563-L597),
   [fake-IP lookup before rules](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/route/route.go#L563-L578).

3. **DNS is not completely equivalent.** Observed fake A TTL is 1s in Mihomo,
   600s in sing-box; initial addresses differ (.4 vs .2). Cache persistence is off.
   DNS reload continuity, cache exhaustion, exclusion domains, resolver fallback,
   revoked policy/lease handling and IPv6 packet behavior are NOT_TESTED.
   Formal performance requests use the **same literal origin IP**, so TTL and
   fake-IP allocation do not enter the measured timings. Do not reuse these
   timings as a DNS-inclusive connection comparison or product DNS-parity proof.

4. **Test CA loading differs.** Mihomo's YAML custom trust pool was insufficient
   for the initial outbound TLS construction in `parity-01`; that handshake was
   correctly rejected. The harness now supplies the test CA through process-local
   `SSL_CERT_FILE` before startup; sing-box also uses explicit `certificate_path`.
   This changes no host trust store. Both wrong-CA and wrong-SNI controls fail.
   Mihomo production certificate fingerprinting (DER certificate hash) is not
   sing-box SPKI pinning; production pin translation remains PARITY_GAP.

5. **Lifecycle/security ownership remains outside the engine.** Manual routes in
   a sealed namespace are not PF/WFP, endpoint allowlist installation, signed
   catalog acceptance, DIRECT leases, protected DNS restoration, UI generation
   fencing or updater handoff. No product Linux fail-closed bypass was introduced.
   Selector interruption semantics and statistics compatibility still need a
   deliberate privileged-runtime adapter and native validation.

6. **Stack comparison includes its packet path.** Same B/C binary and all config
   fields identical except explicit stack. TUN multi-queue and proxy mux are off.
   Both log an unsupported UDP offload ioctl and continue successfully on this
   kernel. Go and gVisor can still batch/GSO/GRO differently; results are not a
   comparison of Go language vs gVisor independent of those implementations.

The run gate means **the isolated IP workload has a verified route, authentication
and actual TUN path**, not “all migration gaps resolved.” A versus B/C compares
whole cores and QUIC/TLS implementations. Only B versus C holds the sing-box
binary/dependencies constant while choosing a different TUN stack.
