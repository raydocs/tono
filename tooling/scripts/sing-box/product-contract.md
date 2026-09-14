# Shared sing-box product contract v2 (integration draft)

Supports SHIP_PLAN G1/G2; closes neither. Supersedes M0's blanket prohibition
on implementing DIRECT/home. M0 and #199/#200 remain frozen **offline** fixtures,
not product authorization. No platform lifecycle, installer, feed or protocol
is changed by this shared contract.

## Version and resources: one source of truth

`release.json` identifies the selected Tono-built binaries and separately records
official release archive evidence. On 2026-09-14 the shared owner queried the official
[releases API](https://api.github.com/repos/SagerNet/sing-box/releases?per_page=10)
including prereleases and independently resolved the
[tag](https://api.github.com/repos/SagerNet/sing-box/git/ref/tags/v1.15.0-alpha.3).
Windows owner independently obtained the same result (reported by Puck).
Latest was [v1.15.0-alpha.3](https://github.com/SagerNet/sing-box/releases/tag/v1.15.0-alpha.3),
published 2026-09-13T14:02:08Z, commit
[`93fff5954390367dd456cad3cbd79be54f8b941f`](https://github.com/SagerNet/sing-box/commit/93fff5954390367dd456cad3cbd79be54f8b941f).
This is a fresh check, not reuse of the M0 pin.

The official Go module minimum is **1.25.5**; downloaded upstream release binaries
were built with **go1.26.8**. The selected identity remains the already built
go1.27.1 / four tags / CGO=0 / amd64-v2 artifacts, per build-owner confirmation.
No source/module/tag change is needed for these JSON rules. Upstream binaries
are a DIFFERENT build identity: amd64-v1, Darwin CGO, broader tags. They are
inspection evidence only, not substitutes for selected Tono build hashes.

Release notes: omit TUN `stack` to select the new sing-tun stack; `stack` is
deprecated and scheduled for removal in 1.17.0. No runtime template/emitter may
restore `gvisor` by translating the old YAML value. v2 uses modern DNS servers,
`hijack-dns`/`reject` rule actions, and `detour` instead of `dialer-proxy`.

Only `sing-box` / `sing-box.exe` is needed for the admitted protocols. The
upstream Linux/Windows archive also contains libcronet; Naive is NOT admitted
and its external library is not part of the Tono resource set. Unsigned input
hashes cease to describe the bytes after platform signing: packaging must
record the signed hash and verify its designated requirement separately. Do
not claim upstream assets are Tono-signed or an authorized installer.

## Exact API and ownership

Rust: `tono_core::sing_box::build_runtime(RuntimeInput<'_>) ->
Result<OwnedSingBoxRuntime, SingBoxError>`. No YAML serialization or YAML runtime
intermediate. `runtime-template.json` is the shared non-runnable base JSON;
empty controller/interface/outbounds MUST be filled before staging.

`RuntimeInput` carries `nodes: &[ValidatedNode]`, `selected: &str`,
`controller_secret: &str`, `direct_plan: Option<&DirectPlan>`,
`routing: &CatalogRouting`, `platform: &str` (`macos-arm64` or `windows-amd64-v2`),
`ports: RuntimePorts`, `required_capabilities: &[String]`,
`home_process_names: &[String]`, `home_process_path_regexes: &[String]`,
`direct_process_names: &[String]`.
These are **owner-admitted inputs**, not a JSON trust API: current signed policy,
catalog identity/digest/revision, complete raw routing and derived requirements,
generation and native app signature discovery remain with the caller. Unknown
requirements reject. Do not filter unsupported nodes or erase a policy to make
the compiler succeed. Empty requirements mean the owner proved none, not that
verification was omitted. The compiler cannot prove freshness or native trust.
The compiler itself may omit an **unselected** DER-pinned HY2 candidate while
returning its full-catalog index in `unavailable_nodes() -> &[usize]`. The owner
must show it as unavailable. Selected/home-referenced DER nodes, or explicit
`hy2` requirements, reject. This explicit availability result supersedes M0's
whole-catalog refusal; it is not silent filtering or automatic fallback.

Result methods: `runtime_json() -> &str`, `runtime_sha256() -> &str`,
`redacted_json() -> String`, `dial_endpoints() -> &[DialEndpoint]`,
`direct_endpoints() -> &[DialEndpoint]`. `DialEndpoint` has `host: Ipv4Addr`,
`port: u16`, `transport: Transport` (`Tcp`/`Udp`). No return value means checked,
started, installed permits, or Connected. Controller is `127.0.0.1:<port>`;
local DNS is `127.0.0.1:53` TCP+UDP. Controller secret accepts exactly 32 bytes
encoded as standard base64 or 64 hex characters (unchanged bytes in JSON).
DoH is INSIDE `Tono-Exit`, never a physical
DNS permit. DIRECT exact tuples are separate from proxy dial tuples; address-free
ports/verified process identity must remain in the owner's DirectPlan and lease.

Swift has no generated FFI/type bridge in this PR. macOS owner owns the manual
Swift adapter and all `apps/macos/**`; map admitted ProxyNodes, OverlayConfig and
ManagedDirectRuntimePolicy to these same semantics. #199 stays synthetic;
adapt it explicitly for v2 rather than treating its draft as verified input.
Windows owner owns App/Service lifecycle and RuntimeBundle wire migration.
`config::build_owned_runtime_with_ports` keeps its old YAML meaning during
integration; callers atomically opt into the new API. **Never put JSON in
`RuntimeBundle.yaml`**. Use an explicit JSON field and protocol compatibility
gate that rejects old payloads. No YAML fallback. Delete legacy shared API only
after all platform callers have migrated; this PR does not break main callers.

## Runtime and capability mapping

| Capability | v2 mapping / invariant |
|---|---|
| Reality TCP | `vless`, TLS Reality + explicit uTLS chrome, optional vision; re-admit all nodes |
| HY2 without pin | upstream can parse CA-only TLS, but Tono admission requires DER pin; **not a product-supported path** |
| HY2 DER pin | **refuse** `TONO_SINGBOX_UNSUPPORTED_CERTIFICATE_PIN`; never map DER to SPKI |
| DIRECT exact | logical AND: network, domain, IP /32, port; concrete `direct` outbound with `bind_interface` |
| DIRECT native | signature-admitted anchored `process_path_regex` AND reviewed TCP ports; no name-only TCP escape |
| DIRECT UDP | exact public IP+port AND platform-reviewed process identity; all other Reality UDP rejected |
| DIRECT web | explicit admitted suffix+port; reject unsupported suffix instead of dropping it |
| pinned DNS | `hosts` DNS server, `predefined` map; matching A queries before fake-IP; no local DNS fallback |
| homeProxy | fixed home outbound selection before DIRECT; home endpoint joins proxy tuples |
| homeSocks5 | `socks` version 5, credentials, `detour: Tono-Exit`; home server NOT a physical permit |
| home precedence | SOCKS wins over homeProxy as existing catalog contract; domain/CIDR/process/path TCP rules precede DIRECT |
| DNS | AAAA empty NOERROR, pinned A, fake A, proxied DoH; single resolver, no redundancy claim |
| TUN | utun199/Tono; 198.18.0.1/30, DNS 198.18.0.2, fake 198.19.0.0/16; no `stack`; core DNS disabled |
| control | authenticated loopback Clash API for observation; no PUT configs success assumption or selector change |
| state | draft → bounded check → protected start → native receipts → Connected; reload is protected stop/start |

Fake-IP and pinned-host A rules are scoped to `inbound: [Tono-TUN, Tono-DNS,
Tono-Mixed]`. Internal `/dns/query` has no inbound and must reach real DoH, not
fake-IP or stale pins. `route.default_domain_resolver: Tono-DoH` is mandatory
when direct/domain outbounds exist; alpha.3 rejects missing resolver without a
deprecated-feature environment override. Do not set that override.

### macOS policy variant (Swift owner, not Windows DirectPlan)

macOS owner confirmed existing `ManagedDirectRuntimePolicy` includes native
reviewed bundle path regexes, built-in web suffix defaults with TCP/UDP 80/443,
and regional DoH `223.5.5.5` / `223.6.6.6` bound to the physical interface.
Do not force these through Windows's narrower `DirectPlan` or drop them. Swift
owns the explicit mapping of that already admitted policy:

- suffix AND network AND port routes to interface-bound DIRECT before the
  generic UDP rejection; no unnecessary domain+IP pin requirement for suffixes;
- reviewed `process_path_regex` routes retain the existing PF root/port lease;
- regional HTTPS DNS servers use the same interface-bound DIRECT detour, normal
  TLS verification, and separately reported physical DNS TCP/443 tuples;
- pinned hosts remain ahead of fake-IP; home precedence remains ahead of DIRECT.

This is an explicit platform capability difference. The portable Rust emitter's
current `DirectPlan` represents Windows policy and **does not implement these
macOS additions**. Swift equivalence and native permit proof belong to the macOS
PR. There is no claim that the base single proxied resolver is equivalent to
regional resolver redundancy. The base schema never authorizes direct DNS on
its own. Replacing two resolvers by one is an outstanding parity gap, not an
automatic fallback permission.

HY2 evidence: official [TLS documentation](https://sing-box.sagernet.org/configuration/shared/tls/#certificate_public_key_sha256)
defines base64 **public key** SHA256. At the pinned source,
[`common/tls/std_client.go`](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/common/tls/std_client.go)
sets `InsecureSkipVerify` and a SPKI verifier for that option. It cannot enforce
the catalog's SHA256 of leaf DER. PEM-as-root also changes the accepted certificate
set (same-key replacement/chain/name/time semantics); no PEM bytes exist in the
catalog. An equivalent solution requires a separately built DER verifier in the
actual QUIC TLS backend and same-key-leaf/name/time regression checks. Stock
binaries cannot consume an invented DER field. Thus pinned HY2 remains an
explicit implementation blocker, not a silently removed pin or converted hash.
`node::admit_hysteria2` requires `fingerprint` even for a CA-signed node, so no
CA-only Tono draft is permitted. The first hosted Rust run caught a synthetic
test that incorrectly assumed otherwise; the correction preserves admission
and tests that removing a pin rejects even an unselected node.

`required_capabilities` accepts `reality-tcp`, `hy2`, `direct`, `home`,
`dns-proxied`, `tun`, `clash-api`. `hy2` still validates each node's actual
authentication requirements. `dns-redundancy`, arbitrary sniff/remote rules,
IPv6 and unknown requirements refuse. Full migration is not complete until
pinned HY2, resolver redundancy and native PF/WFP/DNS/installer integration are
implemented and verified. No POST replay, automatic alternate node, direct
fallback, or policy-loss recovery is authorized.
